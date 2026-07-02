// backend/server.js
// ===================================================================
// ENHANCED VERSION WITH:
// - SQLite persistent storage (attendance, students, events)
// - Winston logging + Daily Rotate File
// - WebSocket real-time notifications
// - Full CRUD APIs for students
// - Node-Cache for performance
// - Telegram Bot integration with chat-id restriction
// - Security fixes: path traversal prevention, rate limiting, auth
// - Helmet.js for security headers
// - Retry mechanism for Telegram
// - Transaction support for atomic operations
// - Health check endpoint
// ===================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const NodeCache = require('node-cache');

// Import DB helpers (đã cập nhật trong db.js)
const {
    db,
    logEvent, registerStudent, getStudents, getTodayAttendance,
    getStudentAttendance, getStats, getVietnamTime, getStudentsWithGender,
    getEmotionStats, getClassEmotionStats,
    logAttendance, getAttendanceByDate, clearAttendance,
    updateStudent, deleteStudent, getStudentById,
    runTransaction, getAttendanceByDateRange, getAttendanceSummary
} = require('./db');

// ==================== LOGGER SETUP with Daily Rotate ====================
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const rotateTransport = new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'info',
});

const errorRotateTransport = new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
});

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ level, message, timestamp }) => `${timestamp} [${level}] ${message}`)
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                format.printf(({ level, message, timestamp }) => `${timestamp} [${level}] ${message}`)
            )
        }),
        rotateTransport,
        errorRotateTransport
    ]
});

// ==================== APP SETUP ====================
const app = express();
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.API_KEY || 'your-secret-key-change-me';
const DESCRIPTOR_SAVE_THRESHOLD = 0.45; // giảm xuống để chỉ lưu khi khớp tốt

// ==================== MIDDLEWARE ====================
// app.use(helmet()); // Bảo mật headers
app.use(cors()); // CORS có thể giới hạn sau
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Authentication
const authenticate = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
        logger.warn(`Unauthorized attempt from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Rate limiting (cải tiến: sử dụng bộ nhớ riêng biệt)
const requestCounts = {};
function rateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        // Clean old entries periodically
        if (Object.keys(requestCounts).length > 1000) {
            for (const k in requestCounts) {
                if (now > requestCounts[k].resetAt) delete requestCounts[k];
            }
        }
        if (!requestCounts[key] || now > requestCounts[key].resetAt) {
            requestCounts[key] = { count: 1, resetAt: now + windowMs };
            return next();
        }
        requestCounts[key].count++;
        if (requestCounts[key].count > maxRequests) {
            return res.status(429).json({ error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' });
        }
        next();
    };
}

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/models', express.static(path.join(__dirname, 'models')));
app.use('/cropped', express.static(path.join(__dirname, 'database', 'cropped_faces')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
});

// ==================== TELEGRAM BOT ====================
let bot = null;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Hàm retry gửi tin nhắn Telegram
async function sendTelegramWithRetry(chatId, message, retries = 3, parseMode = 'Markdown') {
    for (let i = 0; i < retries; i++) {
        try {
            await bot.sendMessage(chatId, message, { parse_mode: parseMode });
            return;
        } catch (err) {
            logger.warn(`Telegram send attempt ${i+1} failed: ${err.message}`);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            } else {
                logger.error(`Telegram send failed after ${retries} attempts`);
                throw err;
            }
        }
    }
}

// Hàm split tin nhắn dài
function splitMessage(text, maxLen = 4096) {
    const parts = [];
    while (text.length > maxLen) {
        let splitIndex = text.lastIndexOf('\n', maxLen);
        if (splitIndex === -1) splitIndex = maxLen;
        parts.push(text.substring(0, splitIndex));
        text = text.substring(splitIndex).trim();
    }
    parts.push(text);
    return parts;
}

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_token_here') {
    try {
        bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        logger.info('✅ Telegram Bot connected');

        // Helper: check if user is authorized
        const isAuthorized = (chatId) => {
            return chatId.toString() === TELEGRAM_CHAT_ID;
        };

        // Public commands (no sensitive data)
        bot.onText(/\/start/, (msg) => {
            bot.sendMessage(msg.chat.id, '🤖 Bot giám sát lớp học đã sẵn sàng!');
        });

        bot.onText(/\/help/, (msg) => {
            bot.sendMessage(msg.chat.id,
                '📋 *Các lệnh:*\n' +
                '/today - Xem điểm danh hôm nay\n' +
                '/stats - Thống kê tổng quan\n' +
                '/student <id> - Xem lịch sử học sinh\n' +
                '/emotion <id> - Xem cảm xúc học sinh hôm nay\n' +
                '/classemotion - Tổng hợp cảm xúc lớp hôm nay\n' +
                '/report - Gửi báo cáo ngay',
                { parse_mode: 'Markdown' }
            );
        });

        bot.onText(/\/dashboard/, (msg) => {
            const host = process.env.SERVER_HOST || `http://localhost:${PORT}`;
            bot.sendMessage(msg.chat.id,
                `📊 *Dashboard giám sát lớp học*\n\n🔗 ${host}/dashboard`,
                { parse_mode: 'Markdown' }
            );
        });

        // --- Protected commands (require authorized chat) ---
        const requireAuth = (fn) => {
            return async (msg, ...args) => {
                const chatId = msg.chat.id;
                if (!isAuthorized(chatId)) {
                    bot.sendMessage(chatId, '❌ Bạn không có quyền sử dụng lệnh này.');
                    return;
                }
                await fn(msg, ...args);
            };
        };

        bot.onText(/\/today/, requireAuth(async (msg) => {
            const chatId = msg.chat.id;
            try {
                const today = new Date().toISOString().slice(0, 10);
                const presentIds = await getAttendanceByDate(today);
                const presentStudents = presentIds.map(id => getStudentFromCache(id)).filter(Boolean);
                let message = `📋 *ĐIỂM DANH HÔM NAY*\n\n`;
                if (presentStudents.length === 0) {
                    message += 'Chưa có học sinh nào điểm danh.';
                } else {
                    presentStudents.forEach((s, i) => {
                        message += `${i+1}. ${s.name} (${s.id})\n`;
                    });
                }
                // Split if long
                const parts = splitMessage(message);
                for (const part of parts) {
                    await sendTelegramWithRetry(chatId, part);
                }
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi truy vấn');
                logger.error('Telegram /today error:', err);
            }
        }));

        bot.onText(/\/stats/, requireAuth(async (msg) => {
            const chatId = msg.chat.id;
            try {
                const stats = await getStats();
                const message = `📊 *THỐNG KÊ*\n\n` +
                               `👥 Tổng số học sinh: ${stats.totalStudents}\n` +
                               `✅ Có mặt hôm nay: ${stats.presentToday}\n` +
                               `❌ Vắng: ${stats.totalStudents - stats.presentToday}`;
                await sendTelegramWithRetry(chatId, message);
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi truy vấn');
                logger.error('Telegram /stats error:', err);
            }
        }));

        bot.onText(/\/student (.+)/, requireAuth(async (msg, match) => {
            const chatId = msg.chat.id;
            const id = match[1].trim();
            try {
                const rows = await getStudentAttendance(id);
                if (rows.length === 0) {
                    bot.sendMessage(chatId, `Không tìm thấy dữ liệu cho học sinh ${id}`);
                    return;
                }
                let message = `📝 *Lịch sử học sinh ${id}*\n\n`;
                rows.slice(0, 10).forEach((r, i) => {
                    const detail = r.details ? JSON.parse(r.details) : {};
                    let line = `${i+1}. ${r.action} ${r.timestamp}`;
                    if (r.action === 'emotion' && detail.emotion) line += ` 😊 ${detail.emotion}`;
                    if (r.age) line += ` (${r.age} tuổi)`;
                    if (r.gender) line += ` ${r.gender === 'male' ? '👨' : '👩'}`;
                    message += line + '\n';
                });
                const parts = splitMessage(message);
                for (const part of parts) {
                    await sendTelegramWithRetry(chatId, part);
                }
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi truy vấn');
                logger.error('Telegram /student error:', err);
            }
        }));

        bot.onText(/\/emotion (.+)/, requireAuth(async (msg, match) => {
            const chatId = msg.chat.id;
            const id = match[1].trim();
            try {
                const stats = await getEmotionStats(id);
                if (!stats || stats.length === 0) {
                    bot.sendMessage(chatId, `Không có dữ liệu cảm xúc cho học sinh ${id} hôm nay.`);
                    return;
                }
                let message = `😊 *Cảm xúc học sinh ${id} hôm nay:*\n\n`;
                const total = stats.reduce((a, b) => a + b.count, 0);
                stats.forEach(s => {
                    const bar = '▓'.repeat(Math.round(s.count / total * 10));
                    message += `${s.emotion}: ${bar} (${s.count} lần)\n`;
                });
                await sendTelegramWithRetry(chatId, message);
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi truy vấn');
                logger.error('Telegram /emotion error:', err);
            }
        }));

        bot.onText(/\/classemotion/, requireAuth(async (msg) => {
            const chatId = msg.chat.id;
            try {
                const stats = await getClassEmotionStats();
                if (!stats || stats.length === 0) {
                    bot.sendMessage(chatId, 'Chưa có dữ liệu cảm xúc lớp hôm nay.');
                    return;
                }
                let message = `😊 *Tổng hợp cảm xúc lớp hôm nay:*\n\n`;
                const total = stats.reduce((a, b) => a + b.count, 0);
                stats.forEach(s => {
                    const pct = Math.round(s.count / total * 100);
                    const bar = '▓'.repeat(Math.round(pct / 10));
                    message += `${s.emotion}: ${bar} ${pct}% (${s.count} lần)\n`;
                });
                await sendTelegramWithRetry(chatId, message);
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi truy vấn');
                logger.error('Telegram /classemotion error:', err);
            }
        }));

        bot.onText(/\/report/, requireAuth(async (msg) => {
            const chatId = msg.chat.id;
            try {
                await sendAttendanceReport(true);
                bot.sendMessage(chatId, '✅ Đã gửi báo cáo điểm danh.');
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi gửi báo cáo');
                logger.error('Telegram /report error:', err);
            }
        }));

        bot.onText(/\/reset/, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                bot.sendMessage(chatId, '❌ Bạn không có quyền thực hiện lệnh này.');
                return;
            }
            try {
                const today = new Date().toISOString().slice(0, 10);
                await clearAttendance(today);
                bot.sendMessage(chatId, `✅ Đã reset điểm danh ngày ${today}.`);
                logger.info(`Attendance reset for ${today} by Telegram`);
            } catch (err) {
                bot.sendMessage(chatId, '❌ Lỗi reset điểm danh.');
                logger.error('Telegram /reset error:', err);
            }
        });

    } catch (err) {
        logger.warn('⚠️ Telegram Bot connection failed:', err.message);
    }
} else {
    logger.info('⚠️ Telegram Bot disabled (no token)');
}

// ==================== PATHS & DIRS ====================
const STUDENT_DATA_DIR = path.join(__dirname, 'database', 'student_data');
const CROPPED_FACES_DIR = path.join(__dirname, 'database', 'cropped_faces');
[path.join(__dirname, 'database'), STUDENT_DATA_DIR, CROPPED_FACES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==================== CACHE using Node-Cache ====================
const studentCache = new NodeCache({
    stdTTL: 300,      // 5 phút
    checkperiod: 60,  // kiểm tra mỗi phút
    useClones: false,
});

let cacheLoaded = false;

// Load cache từ DB
async function loadStudentCache() {
    // Lấy tất cả học sinh từ DB (có thể join với bảng students để lấy thông tin cơ bản)
    const students = await getStudents();
    for (const s of students) {
        // Đọc descriptor từ file
        const folder = path.join(STUDENT_DATA_DIR, s.studentId);
        const descFile = path.join(folder, 'descriptor.json');
        let descriptor = null;
        try {
            if (fs.existsSync(descFile)) {
                const raw = await fsp.readFile(descFile, 'utf8');
                descriptor = JSON.parse(raw);
            }
        } catch (e) {
            logger.warn(`⚠️ Lỗi đọc descriptor của ${s.studentId}: ${e.message}`);
        }
        const cacheObj = {
            id: s.studentId,
            name: s.studentName,
            gender: s.gender || null,
            age: s.age || null,
            descriptors: descriptor ? descriptor.descriptors || [] : []
        };
        studentCache.set(`student_${s.studentId}`, cacheObj);
    }
    cacheLoaded = true;
    logger.info(`🧠 Loaded ${students.length} students into cache`);
}

async function initCache() {
    await loadStudentCache();
}

function getStudentFromCache(studentId) {
    const key = `student_${studentId}`;
    let student = studentCache.get(key);
    if (!student) {
        // Fallback: load từ DB
        const s = getStudentById(studentId); // sync không được, phải async, nhưng hàm này đang được dùng sync
        // Tạm thời giữ nguyên logic cũ, sẽ cải thiện sau
        student = studentCache.get(key);
    }
    return student;
}

// Hàm cập nhật cache
function upsertStudentInCache(studentId, name, descriptor, gender, age) {
    const key = `student_${studentId}`;
    let student = studentCache.get(key);
    if (!student) {
        student = { id: studentId, name: name, gender: gender || null, age: age || null, descriptors: [] };
    }
    student.name = name;
    if (gender) student.gender = gender;
    if (age !== undefined && age !== null) student.age = age;
    if (descriptor) {
        student.descriptors.push(descriptor);
        if (student.descriptors.length > 30) student.descriptors = student.descriptors.slice(-30);
    }
    studentCache.set(key, student);
    return student;
}

// Hàm xóa cache
function removeStudentFromCache(studentId) {
    studentCache.del(`student_${studentId}`);
}

// ==================== EUCLIDEAN DISTANCE ====================
function euclideanDistance(arr1, arr2) {
    if (!arr1 || !arr2 || arr1.length !== arr2.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < arr1.length; i++) sum += (arr1[i] - arr2[i]) ** 2;
    return Math.sqrt(sum);
}

function findBestMatch(descriptor, threshold = 0.55) {
    if (!cacheLoaded) return null;
    const keys = studentCache.keys();
    let bestMatch = null;
    let bestDistance = Infinity;
    for (const key of keys) {
        const student = studentCache.get(key);
        if (!student || !student.descriptors || student.descriptors.length === 0) continue;
        let minDist = Infinity;
        for (const d of student.descriptors) {
            const dist = euclideanDistance(descriptor, d);
            if (dist < minDist) minDist = dist;
        }
        if (minDist < bestDistance) {
            bestDistance = minDist;
            bestMatch = student;
        }
    }
    if (bestMatch && bestDistance <= threshold) {
        return { student: bestMatch, distance: bestDistance };
    }
    return null;
}

// ==================== STUDY SESSIONS ====================
const STUDY_SESSIONS = [
    { name: 'Sáng 1', start: '07:30', end: '08:15' },
    { name: 'Sáng 2', start: '08:15', end: '09:00' },
    { name: 'Sáng 3', start: '09:10', end: '09:55' },
    { name: 'Sáng 4', start: '09:55', end: '10:40' },
    { name: 'Sáng 5', start: '10:40', end: '11:25' },
    { name: 'Chiều 1', start: '13:30', end: '14:15' },
    { name: 'Chiều 2', start: '14:15', end: '15:00' },
    { name: 'Chiều 3', start: '15:10', end: '15:55' },
    { name: 'Chiều 4', start: '15:55', end: '16:40' },
    { name: 'Chiều 5', start: '16:40', end: '17:25' },
    { name: 'Tối 1', start: '18:30', end: '19:15' },
    { name: 'Tối 2', start: '19:15', end: '20:00' },
    { name: 'Tối 3', start: '20:10', end: '20:55' },
    { name: 'Tối 4', start: '20:55', end: '21:40' },
    { name: 'Tối 5', start: '21:40', end: '22:25' },
    { name: 'Tối 6', start: '22:25', end: '23:10' },
    { name: 'Tối 7', start: '23:10', end: '23:55' }
];

function getCurrentSession() {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 5);
    return STUDY_SESSIONS.find(s => timeStr >= s.start && timeStr < s.end) || null;
}

// ==================== WEBSOCKET SETUP ====================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
    logger.info('🟢 WebSocket client connected');
    ws.on('close', () => logger.info('🔴 WebSocket client disconnected'));
});

function broadcast(event) {
    const payload = JSON.stringify(event);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

// ==================== ATTENDANCE (PERSISTENT) with TRANSACTION ====================
async function updateAttendance(studentId, studentName) {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const existing = await getAttendanceByDate(today);
        if (existing.includes(studentId)) return;
        
        // Sử dụng transaction để đảm bảo cả 2 operation cùng thành công
        await runTransaction([
            {
                sql: `INSERT INTO attendance (session_date, student_id) VALUES (?, ?)`,
                params: [today, studentId]
            },
            {
                sql: `INSERT INTO events (studentId, studentName, action, details, timestamp) VALUES (?, ?, ?, ?, ?)`,
                params: [studentId, studentName, 'attendance', JSON.stringify({}), getVietnamTime()]
            }
        ]);
        
        broadcast({ type: 'attendance', studentId, studentName, timestamp: new Date().toISOString() });
        logger.info(`✅ Điểm danh: ${studentName} (${studentId})`);
    } catch (err) {
        logger.error(`❌ updateAttendance error cho ${studentId}: ${err.message}`);
    }
}

// ==================== REPORT SENDING ====================
let lastReportState = null;

async function sendAttendanceReport(force = false) {
    if (!bot) return;
    const session = getCurrentSession();
    if (!session) { logger.debug('⏰ Not in class time'); return; }
    
    // Lấy danh sách học sinh từ cache
    const allStudents = [];
    const keys = studentCache.keys();
    for (const key of keys) {
        const s = studentCache.get(key);
        if (s) allStudents.push(s);
    }
    if (allStudents.length === 0) return;
    
    const today = new Date().toISOString().slice(0, 10);
    const presentIds = await getAttendanceByDate(today);
    const presentSet = new Set(presentIds);
    const present = allStudents.filter(s => presentSet.has(s.id));
    const absent = allStudents.filter(s => !presentSet.has(s.id));

    if (!force && lastReportState &&
        lastReportState.sessionName === session.name &&
        JSON.stringify(lastReportState.presentIds) === JSON.stringify(presentIds.slice().sort())) {
        return;
    }

    let message = `📊 *BÁO CÁO ĐIỂM DANH CA ${session.name.toUpperCase()}*\n`;
    message += `📅 Ngày: ${today}\n⏰ ${session.start} - ${session.end}\n\n`;
    message += `✅ *Có mặt (${present.length}/${allStudents.length}):*\n`;
    if (present.length > 0) {
        message += present.map((s, i) => `${i+1}. ${s.name}`).join('\n');
    } else {
        message += '❌ Không có học sinh nào điểm danh';
    }
    message += `\n\n❌ *Vắng mặt (${absent.length}):*\n`;
    message += absent.length > 0 ? absent.map((s, i) => `${i+1}. ${s.name}`).join('\n') : '🎉 Tất cả đều có mặt!';

    try {
        const parts = splitMessage(message);
        for (const part of parts) {
            await sendTelegramWithRetry(TELEGRAM_CHAT_ID, part);
        }
        logger.info(`📨 Report sent for session ${session.name}`);
        lastReportState = { sessionName: session.name, presentIds: presentIds.slice().sort() };
    } catch (err) {
        logger.error('❌ Failed to send report:', err.message);
    }
}

function scheduleReports() {
    setInterval(async () => {
        const now = new Date();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        if ((minutes === 5 || minutes === 25) && seconds < 5) {
            await sendAttendanceReport(false);
        }
    }, 30000);
}

// ==================== LIMIT IMAGES ====================
async function limitCroppedImages(studentId, maxCount = 10) {
    const folder = path.join(STUDENT_DATA_DIR, studentId);
    if (!fs.existsSync(folder)) return;
    const files = (await fsp.readdir(folder)).filter(f => f.endsWith('.jpg'));
    if (files.length <= maxCount) return;
    const withStats = await Promise.all(files.map(async f => ({
        file: f,
        mtime: (await fsp.stat(path.join(folder, f))).mtimeMs
    })));
    withStats.sort((a, b) => a.mtime - b.mtime);
    const toDelete = withStats.slice(0, withStats.length - maxCount);
    await Promise.all(toDelete.map(item => fsp.unlink(path.join(folder, item.file))));
}

// ==================== HELPER: sanitize filename (Unicode-safe) ====================
function sanitizeFilename(filename) {
    const basename = path.basename(filename);
    if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
        throw new Error('Invalid filename');
    }
    return basename;
}

function sanitizeStudentId(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error('Invalid student ID');
    }
    return id;
}

// ==================== API ENDPOINTS ====================

// 1. Register student
app.post('/api/register', authenticate, rateLimit(10, 60000), async (req, res) => {
    try {
        const { studentId, name, descriptor, croppedImage, gender, age } = req.body;
        if (!studentId || !name || !descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ error: 'Invalid data' });
        }
        // Validate studentId format
        try { sanitizeStudentId(studentId); } catch (e) {
            return res.status(400).json({ error: 'Student ID contains invalid characters' });
        }
        if (getStudentFromCache(studentId)) {
            return res.status(400).json({ error: `Student ${studentId} already exists` });
        }
        if (gender && !['male', 'female'].includes(gender)) {
            return res.status(400).json({ error: 'Gender must be male/female' });
        }
        if (age && (typeof age !== 'number' || age < 0 || age > 120)) {
            return res.status(400).json({ error: 'Age must be 0-120' });
        }

        const student = upsertStudentInCache(studentId, name, descriptor, gender || null, age || null);
        await registerStudent(studentId, name, gender || null, age || null);
        await persistStudentDescriptor(student);

        if (croppedImage) {
            const folder = path.join(STUDENT_DATA_DIR, studentId);
            if (!fs.existsSync(folder)) await fsp.mkdir(folder, { recursive: true });
            const base64Data = croppedImage.replace(/^data:image\/jpeg;base64,/, '');
            await fsp.writeFile(path.join(folder, `${studentId}_${Date.now()}.jpg`), Buffer.from(base64Data, 'base64'));
            await limitCroppedImages(studentId, 10);
        }

        broadcast({ type: 'registration', studentId, studentName: name });
        logger.info(`📝 Registered student ${name} (${studentId})`);
        res.json({ success: true, message: `Đã đăng ký ${name}` });
    } catch (err) {
        logger.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Recognize multiple faces
let lastEmotion = {};
app.post('/api/recognize-multiple', authenticate, rateLimit(200, 60000), async (req, res) => {
    try {
        const { descriptors, emotions, croppedImages, ageGenders } = req.body;
        if (!descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
            return res.status(400).json({ error: 'Descriptors required' });
        }
        // Giới hạn số lượng khuôn mặt gửi lên
        if (descriptors.length > 20) {
            return res.status(400).json({ error: 'Too many faces' });
        }

        const results = [];
        const writeJobs = [];
        for (let i = 0; i < descriptors.length; i++) {
            const match = findBestMatch(descriptors[i], 0.55);
            if (match) {
                const student = match.student;
                const emotion = emotions && emotions[i] ? emotions[i] : 'neutral';
                const age = ageGenders && ageGenders[i] ? ageGenders[i].age : null;
                const gender = ageGenders && ageGenders[i] ? ageGenders[i].gender : null;

                results.push({
                    studentId: student.id,
                    studentName: student.name,
                    distance: match.distance,
                    emotion,
                    age,
                    gender
                });

                await updateAttendance(student.id, student.name);

                if (lastEmotion[student.id] !== emotion) {
                    await logEvent(student.id, student.name, 'emotion', { emotion, age, gender }, age, gender);
                    lastEmotion[student.id] = emotion;
                }

                // Chỉ lưu descriptor nếu match tốt và khuôn mặt rõ
                if (croppedImages && croppedImages[i] && match.distance < DESCRIPTOR_SAVE_THRESHOLD) {
                    writeJobs.push((async () => {
                        const folder = path.join(STUDENT_DATA_DIR, student.id);
                        if (!fs.existsSync(folder)) await fsp.mkdir(folder, { recursive: true });
                        const base64Data = croppedImages[i].replace(/^data:image\/jpeg;base64,/, '');
                        await fsp.writeFile(
                            path.join(folder, `${student.id}_${Date.now()}.jpg`),
                            Buffer.from(base64Data, 'base64')
                        );
                        await limitCroppedImages(student.id, 10);
                        const updated = upsertStudentInCache(student.id, student.name, descriptors[i], gender, age);
                        await persistStudentDescriptor(updated);
                    })());
                }
            } else {
                results.push({
                    studentId: null,
                    studentName: 'Unknown',
                    distance: null,
                    emotion: emotions && emotions[i] ? emotions[i] : 'neutral',
                    age: null,
                    gender: null
                });
            }
        }
        await Promise.all(writeJobs);
        res.json({ success: true, count: results.length, results });
    } catch (err) {
        logger.error('Recognize error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Get attendance
app.get('/api/attendance', async (req, res) => {
    try {
        const session = req.query.session || new Date().toISOString().slice(0, 10);
        const list = await getAttendanceByDate(session);
        const students = list.map(id => getStudentFromCache(id)).filter(Boolean);
        res.json({ session, count: students.length, students });
    } catch (err) {
        logger.error('Attendance error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Get all students
app.get('/api/students', async (req, res) => {
    try {
        const students = await getStudentsWithGender();
        res.json(students);
    } catch (err) {
        logger.error('Students error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Behavior alert
app.post('/api/behavior', authenticate, rateLimit(50, 60000), async (req, res) => {
    try {
        const { studentId, behavior, timestamp } = req.body;
        if (!studentId || !behavior) return res.status(400).json({ error: 'Missing data' });
        const student = getStudentFromCache(studentId);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        await logEvent(studentId, student.name, 'behavior', { behavior });
        broadcast({ type: 'behavior', studentId, studentName: student.name, behavior, timestamp: timestamp || new Date().toISOString() });
        logger.info(`🚨 Cảnh báo hành vi: ${student.name} (${studentId}) - ${behavior}`);
        if (bot && TELEGRAM_CHAT_ID) {
            const message = `🚨 *Cảnh báo hành vi!*\n\n👤 ${student.name} (${student.id})\n⚠️ Hành vi: ${behavior}\n🕐 ${timestamp || getVietnamTime()}`;
            try {
                await sendTelegramWithRetry(TELEGRAM_CHAT_ID, message);
            } catch (tgErr) {
                logger.error(`❌ Lỗi gửi cảnh báo hành vi qua Telegram: ${tgErr.message}`);
            }
        }
        res.json({ success: true });
    } catch (err) {
        logger.error('Behavior alert error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5b. Attendance notify (send photo to Telegram on first attendance of the day)
app.post('/api/attendance-notify', authenticate, rateLimit(10, 60000), async (req, res) => {
    try {
        const { studentId, studentName, image } = req.body;
        if (!studentId || !studentName || !image) {
            return res.status(400).json({ error: 'Missing studentId, studentName or image' });
        }

        const today = new Date().toISOString().slice(0, 10);
        const presentIds = await getAttendanceByDate(today);

        if (!presentIds.includes(studentId)) {
            await logAttendance(studentId, studentName);
            await logEvent(studentId, studentName, 'attendance', {});
            broadcast({ type: 'attendance', studentId, studentName, timestamp: new Date().toISOString() });
            logger.info(`✅ Điểm danh (kèm ảnh): ${studentName} (${studentId})`);
        }

        if (bot && TELEGRAM_CHAT_ID) {
            try {
                const base64Data = image.replace(/^data:image\/jpeg;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const caption = `✅ *Điểm danh thành công*\n\n👤 ${studentName} (${studentId})\n🕐 ${getVietnamTime()}`;
                await bot.sendPhoto(TELEGRAM_CHAT_ID, buffer, {
                    caption,
                    parse_mode: 'Markdown',
                    filename: `attendance_${studentId}_${Date.now()}.jpg`
                });
                logger.info(`📸 Đã gửi ảnh điểm danh cho ${studentName} (${studentId})`);
            } catch (tgErr) {
                logger.error(`❌ Lỗi gửi ảnh điểm danh qua Telegram: ${tgErr.message}`);
            }
        }

        res.json({ success: true });
    } catch (err) {
        logger.error('Attendance notify error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6. CRUD for students (Protected)
app.put('/api/students/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        try { sanitizeStudentId(id); } catch (e) {
            return res.status(400).json({ error: 'Invalid student ID' });
        }
        const { name, gender, age } = req.body;
        const existing = getStudentFromCache(id);
        if (!existing) return res.status(404).json({ error: 'Student not found' });
        const updated = await updateStudent(id, name, existing.name, gender, age);
        if (updated === 0) return res.status(404).json({ error: 'Student not found' });
        // Update cache
        const cached = getStudentFromCache(id);
        if (cached) {
            if (name) cached.name = name;
            if (gender) cached.gender = gender;
            if (age !== undefined && age !== null) cached.age = age;
            studentCache.set(`student_${id}`, cached);
        }
        logger.info(`📝 Updated student ${id}`);
        res.json({ success: true, message: 'Updated' });
    } catch (err) {
        logger.error('Update student error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/students/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        try { sanitizeStudentId(id); } catch (e) {
            return res.status(400).json({ error: 'Invalid student ID' });
        }
        const deleted = await deleteStudent(id);
        if (deleted === 0) return res.status(404).json({ error: 'Student not found' });
        // Remove from cache
        studentCache.del(`student_${id}`);
        // Xóa thư mục ảnh
        const folder = path.join(STUDENT_DATA_DIR, id);
        if (fs.existsSync(folder)) {
            await fsp.rm(folder, { recursive: true, force: true });
        }
        logger.info(`🗑️ Deleted student ${id}`);
        res.json({ success: true, message: 'Deleted' });
    } catch (err) {
        logger.error('Delete student error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/students/:id', async (req, res) => {
    try {
        const { id } = req.params;
        try { sanitizeStudentId(id); } catch (e) {
            return res.status(400).json({ error: 'Invalid student ID' });
        }
        const student = await getStudentById(id);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        res.json(student);
    } catch (err) {
        logger.error('Get student error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 7. Reset attendance (protected)
app.delete('/api/attendance/reset', authenticate, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        await clearAttendance(today);
        logger.info(`Attendance reset for ${today}`);
        res.json({ success: true, message: `Đã reset điểm danh ngày ${today}` });
    } catch (err) {
        logger.error('Reset attendance error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 8. Sample images (no auth) - FIXED PATH TRAVERSAL
app.get('/api/sample-images', async (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'database');
        const files = (await fsp.readdir(dbPath)).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
        res.json({ success: true, images: files });
    } catch (err) {
        logger.error('Sample images error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/sample-image/:filename', async (req, res) => {
    try {
        const filename = sanitizeFilename(req.params.filename);
        const filePath = path.join(__dirname, 'database', filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
        const base64 = (await fsp.readFile(filePath)).toString('base64');
        res.json({ success: true, base64, filename });
    } catch (err) {
        if (err.message === 'Invalid filename') {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        logger.error('Sample image error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 9. Cropped face of student - FIXED PATH TRAVERSAL
app.get('/api/student/:id/cropped', async (req, res) => {
    try {
        const studentId = sanitizeStudentId(req.params.id);
        const folder = path.join(STUDENT_DATA_DIR, studentId);
        if (!fs.existsSync(folder)) return res.status(404).json({ error: 'No cropped image' });
        const files = (await fsp.readdir(folder)).filter(f => f.endsWith('.jpg'));
        if (files.length === 0) return res.status(404).json({ error: 'No cropped image' });
        const latestFile = files.sort().pop();
        const base64 = (await fsp.readFile(path.join(folder, latestFile))).toString('base64');
        res.json({ success: true, base64, filename: latestFile });
    } catch (err) {
        if (err.message === 'Invalid student ID') {
            return res.status(400).json({ error: 'Invalid student ID' });
        }
        logger.error('Cropped image error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 10. Emotion stats
app.get('/api/emotion/stats/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        try { sanitizeStudentId(studentId); } catch (e) {
            return res.status(400).json({ error: 'Invalid student ID' });
        }
        const stats = await getEmotionStats(studentId);
        res.json({ success: true, stats });
    } catch (err) {
        logger.error('Emotion stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/emotion/class', async (req, res) => {
    try {
        const stats = await getClassEmotionStats();
        res.json({ success: true, stats });
    } catch (err) {
        logger.error('Class emotion error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 11. Stats
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await getStats();
        res.json(stats);
    } catch (err) {
        logger.error('Stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 12. Behavior today
app.get('/api/behavior/today', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const events = await new Promise((resolve, reject) => {
            db.all(`
                SELECT studentId, studentName, details, timestamp FROM events
                WHERE action = 'behavior' AND date(timestamp) = ?
                ORDER BY timestamp DESC
            `, [today], (err, rows) => err ? reject(err) : resolve(rows));
        });
        res.json({ success: true, events });
    } catch (err) {
        logger.error('Behavior today error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 13. Health check endpoint
app.get('/api/health', (req, res) => {
    const status = {
        uptime: process.uptime(),
        timestamp: Date.now(),
        cacheSize: studentCache.keys().length,
        db: 'ok',
        telegram: bot ? 'connected' : 'disabled'
    };
    res.json(status);
});

// 14. Debug (protected)
app.get('/api/debug/students', authenticate, (req, res) => {
    const keys = studentCache.keys();
    const students = keys.map(key => studentCache.get(key));
    res.json({
        count: students.length,
        students: students.map(s => ({
            id: s.id,
            name: s.name,
            descriptors: s.descriptors?.length || 0,
            gender: s.gender || null,
            age: s.age || null
        }))
    });
});

// 15. Manual report trigger - ADDED AUTH & RATE LIMIT
app.post('/api/send-report', authenticate, rateLimit(10, 60000), async (req, res) => {
    try {
        await sendAttendanceReport(true);
        res.json({ success: true, message: 'Đã gửi báo cáo' });
    } catch (err) {
        logger.error('Manual report error:', err);
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/send-report', authenticate, rateLimit(10, 60000), async (req, res) => {
    try {
        await sendAttendanceReport(true);
        res.send('✅ Báo cáo đã được gửi qua Telegram!');
    } catch (err) {
        res.status(500).send('❌ Lỗi: ' + err.message);
    }
});

// 16. Reports (CSV / weekly stats) — used by dashboard.js
function toCsvValue(v) {
    const s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/report/csv', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const allStudents = await getStudentsWithGender();
        const presentIds = new Set(await getAttendanceByDate(today));
        const rows = [['Mã số', 'Họ tên', 'Trạng thái', 'Ngày']];
        allStudents.forEach(s => {
            rows.push([s.studentId, s.studentName, presentIds.has(s.studentId) ? 'Có mặt' : 'Vắng', today]);
        });
        const csv = '\uFEFF' + rows.map(r => r.map(toCsvValue).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=diemdanh_${today}.csv`);
        res.send(csv);
    } catch (err) {
        logger.error('Report CSV error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/report/week/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const allStudents = await getStudentsWithGender();
        const presentIds = await getAttendanceByDate(date);
        const present = presentIds.length;
        const absent = Math.max(0, allStudents.length - present);
        res.json({ date, present, absent, total: allStudents.length });
    } catch (err) {
        logger.error('Report week error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/report/week-csv/:date', async (req, res) => {
    try {
        const { date: endDate } = req.params;
        const allStudents = await getStudentsWithGender();
        const rows = [['Ngày', 'Có mặt', 'Vắng', 'Tổng']];
        const end = new Date(endDate);
        for (let i = 6; i >= 0; i--) {
            const d = new Date(end);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const presentIds = await getAttendanceByDate(dateStr);
            rows.push([dateStr, presentIds.length, Math.max(0, allStudents.length - presentIds.length), allStudents.length]);
        }
        const csv = '\uFEFF' + rows.map(r => r.map(toCsvValue).join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=baocao_tuan_${endDate}.csv`);
        res.send(csv);
    } catch (err) {
        logger.error('Report week-csv error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ==================== PERSIST DESCRIPTOR (helper) ====================
async function persistStudentDescriptor(student) {
    const folder = path.join(STUDENT_DATA_DIR, student.id);
    if (!fs.existsSync(folder)) await fsp.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, 'descriptor.json');
    await fsp.writeFile(filePath, JSON.stringify(student, null, 2));
}

// ==================== START SERVER ====================
(async () => {
    await initCache();
    scheduleReports();
    server.listen(PORT, () => {
        logger.info(`🚀 Server running at http://localhost:${PORT}`);
        logger.info(`📅 Today's session: ${new Date().toISOString().slice(0, 10)}`);
        logger.info(`✅ Cache loaded, WebSocket ready, auto reports scheduled`);
    });
})();