// backend/db.js
// ============================================================
// ĐẦY ĐỦ + TỐI ƯU:
// - Indexes cho hiệu năng
// - Transaction cho atomic operations
// - Validation đầu vào
// - Migration tự động
// - Hàm mới cho báo cáo
// ============================================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ==================== INIT DB ====================
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'classroom.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('❌ DB connection error:', err.message);
    else console.log('✅ SQLite connected:', dbPath);
});

// ==================== HELPERS ====================
function getVietnamTime() {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vietnamTime.toISOString().replace('T', ' ').slice(0, 19);
}

// ==================== MIGRATION (tự động thêm cột nếu thiếu) ====================
function migrateDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Thêm cột mới cho bảng events nếu chưa có
            const migrations = [
                { table: 'events', column: 'age', type: 'INTEGER' },
                { table: 'events', column: 'gender', type: 'TEXT' },
                { table: 'students', column: 'gender', type: 'TEXT' },
                { table: 'students', column: 'age', type: 'INTEGER' },
                // Thêm cột `class` nếu sau này cần
                // { table: 'students', column: 'class', type: 'TEXT' },
            ];

            migrations.forEach(({ table, column, type }) => {
                db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.warn(`⚠️ Lỗi ALTER TABLE ${table} ADD ${column}: ${err.message}`);
                    } else if (!err) {
                        console.log(`✅ Đã thêm cột ${column} vào bảng ${table}`);
                    }
                });
            });

            // Tạo indexes cho hiệu năng (nếu chưa có)
            const indexes = [
                `CREATE INDEX IF NOT EXISTS idx_events_studentId ON events(studentId)`,
                `CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`,
                `CREATE INDEX IF NOT EXISTS idx_events_action ON events(action)`,
                `CREATE INDEX IF NOT EXISTS idx_attendance_session_date ON attendance(session_date)`,
                `CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id)`,
            ];
            indexes.forEach(sql => {
                db.run(sql, (err) => {
                    if (err) console.warn(`⚠️ Lỗi tạo index: ${err.message}`);
                });
            });

            resolve();
        });
    });
}

// ==================== CREATE TABLES ====================
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        studentId TEXT NOT NULL,
        studentName TEXT,
        action TEXT NOT NULL,
        details TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        age INTEGER,
        gender TEXT
    )`, (err) => {
        if (err) console.error('❌ Lỗi tạo bảng events:', err.message);
        else console.log('✅ Bảng events đã sẵn sàng');
    });

    db.run(`CREATE TABLE IF NOT EXISTS students (
        studentId TEXT PRIMARY KEY,
        studentName TEXT,
        registeredAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        gender TEXT,
        age INTEGER
    )`, (err) => {
        if (err) console.error('❌ Lỗi tạo bảng students:', err.message);
        else console.log('✅ Bảng students đã sẵn sàng');
    });

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        session_date TEXT,
        student_id TEXT,
        PRIMARY KEY (session_date, student_id)
    )`, (err) => {
        if (err) console.error('❌ Lỗi tạo bảng attendance:', err.message);
        else console.log('✅ Bảng attendance đã sẵn sàng');
    });

    // Chạy migration sau khi tạo bảng
    migrateDatabase().catch(err => console.error('Migration error:', err));
});

// ==================== TRANSACTION WRAPPER ====================
/**
 * Thực thi nhiều câu lệnh SQL trong một transaction
 * @param {Array<{sql: string, params: Array}>} queries
 * @returns {Promise<Array>} - Kết quả của từng câu lệnh
 */
function runTransaction(queries) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            try {
                const results = [];
                for (const { sql, params } of queries) {
                    const stmt = db.prepare(sql);
                    const result = stmt.run(params, function(err) {
                        if (err) throw err;
                    });
                    stmt.finalize();
                    results.push(result.changes);
                }
                db.run('COMMIT', (err) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            } catch (e) {
                db.run('ROLLBACK');
                reject(e);
            }
        });
    });
}

// ==================== VALIDATION ====================
function validateStudentId(id) {
    if (!id || typeof id !== 'string' || id.trim() === '') {
        throw new Error('Student ID is required and must be a non-empty string');
    }
    return id.trim();
}

function validateAction(action) {
    if (!action || typeof action !== 'string' || action.trim() === '') {
        throw new Error('Action is required and must be a non-empty string');
    }
    return action.trim();
}

// ==================== CORE FUNCTIONS ====================

// Log sự kiện (có validation)
function logEvent(studentId, studentName, action, details, age = null, gender = null) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
            action = validateAction(action);
        } catch (e) {
            reject(e);
            return;
        }
        const stmt = db.prepare(
            `INSERT INTO events (studentId, studentName, action, details, timestamp, age, gender)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const timestamp = getVietnamTime();
        stmt.run(studentId, studentName, action, JSON.stringify(details || {}), timestamp, age, gender, function(err) {
            stmt.finalize();
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });
}

// Đăng ký / cập nhật học sinh
function registerStudent(studentId, studentName, gender = null, age = null) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        const stmt = db.prepare(
            `INSERT OR REPLACE INTO students (studentId, studentName, gender, age) VALUES (?, ?, ?, ?)`
        );
        stmt.run(studentId, studentName, gender, age, function(err) {
            stmt.finalize();
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Lấy danh sách học sinh
function getStudents() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT studentId, studentName, gender, age FROM students ORDER BY studentName`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Lấy thông tin một học sinh
function getStudentById(studentId) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        db.get(`SELECT studentId, studentName, gender, age FROM students WHERE studentId = ?`, [studentId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Lấy điểm danh hôm nay (từ bảng events)
function getTodayAttendance() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);
        db.all(`
            SELECT studentId, studentName, timestamp, age, gender
            FROM events
            WHERE date(timestamp) = ? AND action = 'attendance'
            ORDER BY timestamp
        `, [today], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Lấy danh sách student_id đã điểm danh theo ngày (từ bảng attendance)
function getAttendanceByDate(date) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT student_id FROM attendance WHERE session_date = ?`,
            [date],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.student_id));
            }
        );
    });
}

// Lấy điểm danh theo khoảng ngày (cho báo cáo)
function getAttendanceByDateRange(startDate, endDate) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT session_date, student_id FROM attendance 
             WHERE session_date BETWEEN ? AND ? 
             ORDER BY session_date, student_id`,
            [startDate, endDate],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

// Lấy tổng hợp điểm danh theo ngày (số lượng có mặt, vắng)
function getAttendanceSummary(date) {
    return new Promise((resolve, reject) => {
        // Lấy tổng số học sinh
        db.get(`SELECT COUNT(*) as total FROM students`, (err, totalRow) => {
            if (err) reject(err);
            const total = totalRow ? totalRow.total : 0;
            // Lấy số đã điểm danh
            db.get(
                `SELECT COUNT(DISTINCT student_id) as present FROM attendance WHERE session_date = ?`,
                [date],
                (err2, presentRow) => {
                    if (err2) reject(err2);
                    const present = presentRow ? presentRow.present : 0;
                    resolve({
                        date,
                        total,
                        present,
                        absent: Math.max(0, total - present)
                    });
                }
            );
        });
    });
}

// Ghi nhận điểm danh (thêm vào bảng attendance)
function logAttendance(studentId, studentName, date = null) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        const sessionDate = date || new Date().toISOString().slice(0, 10);
        const stmt = db.prepare(
            `INSERT OR IGNORE INTO attendance (session_date, student_id) VALUES (?, ?)`
        );
        stmt.run(sessionDate, studentId, function(err) {
            stmt.finalize();
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Xóa điểm danh của một ngày
function clearAttendance(date) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM attendance WHERE session_date = ?`,
            [date],
            function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// Cập nhật thông tin học sinh
function updateStudent(studentId, name, oldName, gender, age) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        const sql = `
            UPDATE students 
            SET studentName = COALESCE(?, studentName),
                gender = COALESCE(?, gender),
                age = COALESCE(?, age)
            WHERE studentId = ?
        `;
        db.run(sql, [name, gender, age, studentId], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// Xóa học sinh (và toàn bộ dữ liệu liên quan)
function deleteStudent(studentId) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        // Sử dụng transaction để đảm bảo xóa sạch
        const queries = [
            { sql: `DELETE FROM students WHERE studentId = ?`, params: [studentId] },
            { sql: `DELETE FROM events WHERE studentId = ?`, params: [studentId] },
            { sql: `DELETE FROM attendance WHERE student_id = ?`, params: [studentId] }
        ];
        runTransaction(queries)
            .then(results => resolve(results[0])) // trả về số dòng bị xóa trong bảng students
            .catch(reject);
    });
}

// Lấy lịch sử hoạt động của học sinh
function getStudentAttendance(studentId) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        db.all(`
            SELECT action, details, timestamp, age, gender
            FROM events
            WHERE studentId = ?
            ORDER BY timestamp DESC
        `, [studentId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Thống kê tổng quan
function getStats() {
    return new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(DISTINCT studentId) as totalStudents FROM students`, (err, totalRow) => {
            if (err) reject(err);
            db.get(`
                SELECT COUNT(DISTINCT studentId) as presentToday
                FROM events
                WHERE date(timestamp) = date('now') AND action = 'attendance'
            `, (err2, presentRow) => {
                if (err2) reject(err2);
                resolve({
                    totalStudents: totalRow ? totalRow.totalStudents : 0,
                    presentToday: presentRow ? presentRow.presentToday : 0
                });
            });
        });
    });
}

// Lấy học sinh kèm giới tính
function getStudentsWithGender() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT studentId, studentName, gender FROM students`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Thống kê cảm xúc của một học sinh trong ngày
function getEmotionStats(studentId) {
    return new Promise((resolve, reject) => {
        try {
            studentId = validateStudentId(studentId);
        } catch (e) {
            reject(e);
            return;
        }
        const today = new Date().toISOString().slice(0, 10);
        db.all(`
            SELECT json_extract(details, '$.emotion') as emotion, COUNT(*) as count
            FROM events
            WHERE studentId = ? AND action = 'emotion' AND date(timestamp) = ?
            GROUP BY emotion
            ORDER BY count DESC
        `, [studentId, today], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Thống kê cảm xúc toàn lớp trong ngày
function getClassEmotionStats() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().slice(0, 10);
        db.all(`
            SELECT json_extract(details, '$.emotion') as emotion, COUNT(*) as count
            FROM events
            WHERE action = 'emotion' AND date(timestamp) = ?
            GROUP BY emotion
            ORDER BY count DESC
        `, [today], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Lấy số lượng sự kiện theo loại trong ngày
function getEventStatsByDate(date) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT action, COUNT(*) as count
            FROM events
            WHERE date(timestamp) = ?
            GROUP BY action
        `, [date], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Đóng kết nối DB
function closeDb() {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// ==================== EXPORT ====================
module.exports = {
    db,
    logEvent,
    registerStudent,
    getStudents,
    getStudentById,
    getTodayAttendance,
    getAttendanceByDate,
    getAttendanceByDateRange,
    getAttendanceSummary,
    logAttendance,
    clearAttendance,
    updateStudent,
    deleteStudent,
    getStudentAttendance,
    getStats,
    getVietnamTime,
    getStudentsWithGender,
    getEmotionStats,
    getClassEmotionStats,
    getEventStatsByDate,
    runTransaction,
    closeDb
};