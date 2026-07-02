// frontend/script.js
// ===================================================================
// ENHANCED VERSION WITH:
// - Face recognition (TinyFaceDetector, 68 landmarks, expressions, age/gender)
// - Multiple descriptors per student (self-learning via server)
// - Telegram photo notification on attendance
// - Cloth color analysis (HSV histogram) - THROTTLED + SMOOTHED
// - Accessory detection (glasses, mask, hat) - THROTTLED
// - Behavior detection using face landmarks (drowsiness, distraction)
// - MediaPipe Hands fallback (if blocked, skip hand detection)
// - IndexedDB caching of student list
// - Dynamic SERVER_URL using window.location.origin
// - SMOOTHED emotion + cloth color (no jumping)
// - REMOVED spoof/blink warnings
// - IMPROVED: detection accuracy, camera reconnect, confidence score
// - ALIGNED with new backend (db.js + server.js)
// ===================================================================

// Use dynamic server URL (works on any host/port)
const SERVER_URL = window.location.origin;
const MODEL_URL = '/models';
const API_KEY = 'your-secret-key-change-me';

// DOM elements
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d', { willReadFrequently: true });
const statusEl = document.getElementById('status');
const attendanceList = document.getElementById('attendance-list');
const behaviorLog = document.getElementById('behavior-log');
const loadingIndicator = document.getElementById('loading-indicator') || null;

const modal = document.getElementById('registerModal');
const closeBtn = document.querySelector('.close');
const registerBtn = document.getElementById('registerBtn');
const studentName = document.getElementById('studentName');
const studentId = document.getElementById('studentId');
const imageUpload = document.getElementById('imageUpload');
const previewImage = document.getElementById('previewImage');
const registerStatus = document.getElementById('registerStatus');
const submitRegister = document.getElementById('submitRegister');

// ==================== CONFIGURATION ====================
const CONFIG = {
    DETECTOR_INPUT_SIZE: 512, // tăng từ 320 lên 512 để cải thiện độ chính xác
    DETECTOR_SCORE_THRESHOLD: 0.5,
    DETECTION_MAX_WIDTH: 640,
    FRAME_SKIP: 8, // giảm từ 10 để tăng tốc độ phản hồi (vẫn đảm bảo hiệu năng)
    SUBTASK_EVERY_N_CYCLES: 3,
    CROP_EVERY_N_CYCLES: 2,
    STUDENT_LIST_REFRESH_INTERVAL: 30000,
    SMOOTHING_WINDOW_MS: 3000,
    HANDS_FRAME_SKIP: 6, // chạy hand detection ít thường xuyên hơn
    MAX_DESCRIPTORS_PER_REQUEST: 20,
};

// ==================== STATE ====================
let isModelLoaded = false;
let isDetecting = false;
let frameCounter = 0;
let cycleCount = 0;
let handFrameCounter = 0;
let autoRegisterDone = false;
let studentList = [];
let lastStudentListUpdate = 0;
let attendanceSentToday = new Set();
let cameraActive = false;

// Smoothed state per student
const studentState = {};

const negativeEmotionCount = {};
const NEGATIVE_EMOTION_THRESHOLD = 5;
const NEGATIVE_EMOTIONS = ['angry', 'sad', 'fearful', 'disgusted'];

// CHECK faceapi
if (typeof faceapi === 'undefined') {
    console.error('❌ face-api.js chưa được load!');
    statusEl.textContent = '❌ Lỗi: face-api.js chưa load';
    statusEl.style.background = '#ffebee';
    statusEl.style.color = '#c62828';
}

// ==================== HELPER: fetchWithAuth ====================
async function fetchWithAuth(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        ...(options.headers || {})
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 429) {
        throw new Error('Rate limit exceeded. Vui lòng thử lại sau.');
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response;
}

function captureFrameFromVideo(videoElement, quality = 0.8) {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
}

function parseStudentInfoFromFilename(filename) {
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    const parts = nameWithoutExt.split('_');
    const mssv = parts[parts.length - 1];
    const nameParts = parts.slice(0, parts.length - 1);
    let studentName = nameParts.join(' ').trim();
    if (!studentName) studentName = nameWithoutExt;
    return { studentId: mssv, name: studentName, raw: nameWithoutExt };
}

// ==================== TF.JS BACKEND ====================
async function forceWebGLBackend() {
    if (typeof faceapi === 'undefined' || !faceapi.tf) return;
    try {
        await faceapi.tf.setBackend('webgl');
        await faceapi.tf.ready();
        console.log('✅ TF.js backend:', faceapi.tf.getBackend());
    } catch (e) {
        console.warn('⚠️ WebGL backend failed, falling back to CPU/WASM:', e.message);
    }
}

function monitorTfMemory() {
    setInterval(() => {
        if (!faceapi?.tf) return;
        const mem = faceapi.tf.memory();
        console.log(`🧠 Tensors: ${mem.numTensors}, ${(mem.numBytes / 1024 / 1024).toFixed(1)}MB`);
        if (mem.numTensors > 500) console.warn('⚠️ Tensor count high – possible leak');
    }, 30000);
}

// ==================== LOAD MODELS ====================
async function loadModels() {
    statusEl.textContent = '⏳ Đang tải mô hình...';
    try {
        await forceWebGLBackend();
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        ]);
        try {
            await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
            console.log('✅ Age/Gender model loaded');
        } catch (e) {
            console.warn('⚠️ Không tải được ageGenderNet:', e.message);
        }
        isModelLoaded = true;
        statusEl.textContent = '✅ Sẵn sàng';
        statusEl.style.background = '#e8f5e9';
        statusEl.style.color = '#2e7d32';
        console.log('✅ Face models loaded');
        monitorTfMemory();
        await updateStudentList(true);
        await autoRegisterFromSamples();
        await startVideo();
        await loadMediaPipeModels();
    } catch (err) {
        console.error(err);
        statusEl.textContent = '❌ Lỗi tải model';
        statusEl.style.background = '#ffebee';
        statusEl.style.color = '#c62828';
    }
}

// ==================== INDEXEDDB HELPER ====================
import { getStudentsFromCache, saveStudentsToCache } from './indexeddb-helper.js';

// ==================== STUDENT LIST ====================
async function updateStudentList(force = false) {
    const now = Date.now();
    if (!force && (now - lastStudentListUpdate) < CONFIG.STUDENT_LIST_REFRESH_INTERVAL) return;
    lastStudentListUpdate = now;

    if (!force) {
        const cached = await getStudentsFromCache();
        if (cached && cached.length > 0) {
            studentList = cached;
            console.log(`📋 Loaded ${studentList.length} students from IndexedDB`);
            return;
        }
    }

    try {
        const res = await fetch(`${SERVER_URL}/api/students`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        studentList = data;
        await saveStudentsToCache(data);
        console.log(`📋 Loaded ${studentList.length} students from server and cached`);
        if (studentList.length === 0 && !autoRegisterDone) {
            console.log('⚠️ Danh sách rỗng, sẽ tự động đăng ký từ ảnh mẫu.');
            await autoRegisterFromSamples();
        }
    } catch (err) {
        console.error('Lỗi lấy danh sách học sinh:', err);
        const fallback = await getStudentsFromCache();
        if (fallback && fallback.length > 0) {
            studentList = fallback;
            console.log('⚠️ Using cached student list (server unavailable)');
        } else {
            studentList = [];
        }
    }
}

// ==================== CAMERA + DETECTION LOOP ====================
async function startVideo() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'environment' }
        });
        video.srcObject = stream;
        await video.play();
        cameraActive = true;
        console.log('📷 Camera started');
        overlay.width = video.videoWidth || 1280;
        overlay.height = video.videoHeight || 720;
        requestAnimationFrame(detectionLoop);
        updateAttendanceUI();
        console.log('ℹ️ Pose detection disabled (using face + hands)');
        statusEl.textContent = '✅ Sẵn sàng';
    } catch (err) {
        console.error(err);
        statusEl.textContent = '❌ Không thể mở camera';
        statusEl.style.background = '#ffebee';
        statusEl.style.color = '#c62828';
        cameraActive = false;
        // Thử reconnect sau 5 giây
        setTimeout(startVideo, 5000);
    }
}

// Hàm reconnect camera khi mất kết nối
video.addEventListener('error', async (e) => {
    console.warn('Camera lost, reconnecting...');
    cameraActive = false;
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    setTimeout(startVideo, 3000);
});

function detectionLoop() {
    frameCounter++;
    if (frameCounter % CONFIG.FRAME_SKIP === 0 && !isDetecting &&
        !video.paused && !video.ended && video.readyState >= 2 && cameraActive) {
        isDetecting = true;
        detectAndRecognize()
            .catch(err => console.error('detectAndRecognize error:', err))
            .finally(() => { isDetecting = false; });
    }
    requestAnimationFrame(detectionLoop);
}

// ==================== PREPROCESS & CROP ====================
function preprocessImage(imageSource) {
    const srcW = imageSource.videoWidth || imageSource.width || 1280;
    const srcH = imageSource.videoHeight || imageSource.height || 720;
    const scale = Math.min(1, CONFIG.DETECTION_MAX_WIDTH / srcW);
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const c = canvas.getContext('2d', { willReadFrequently: false });
    // Tăng cường chất lượng ảnh: sáng, tương phản, sharpen nhẹ
    c.filter = 'brightness(1.1) contrast(1.3)';
    c.drawImage(imageSource, 0, 0, outW, outH);
    c.filter = 'none';
    return { canvas, scale };
}

function cropFace(processedCanvas, box) {
    const x = Math.max(0, box.x);
    const y = Math.max(0, box.y);
    const width = Math.min(box.width, processedCanvas.width - x);
    const height = Math.min(box.height, processedCanvas.height - y);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropCtx.drawImage(processedCanvas, x, y, width, height, 0, 0, width, height);
    return cropCanvas.toDataURL('image/jpeg', 0.85);
}

// ==================== CLOTH COLOR ANALYSIS (HSV) - THROTTLED + SMOOTHED ====================
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
        h = 0;
    } else {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, v: v * 100 };
}

function getDominantColorName(hue) {
    if (hue < 15 || hue >= 345) return 'red';
    if (hue < 45) return 'orange';
    if (hue < 75) return 'yellow';
    if (hue < 165) return 'green';
    if (hue < 195) return 'cyan';
    if (hue < 255) return 'blue';
    if (hue < 315) return 'purple';
    return 'pink';
}

async function analyzeClothColor(fullImageDataUrl, faceBox) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = fullImageDataUrl;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const w = img.width, h = img.height;
            const yStart = Math.floor(faceBox.y + faceBox.height * 0.6);
            const yEnd = Math.min(h, Math.floor(faceBox.y + faceBox.height * 1.8));
            const xStart = Math.max(0, faceBox.x - faceBox.width * 0.2);
            const xEnd = Math.min(w, faceBox.x + faceBox.width * 1.2);
            const cropW = xEnd - xStart, cropH = yEnd - yStart;
            if (cropW <= 0 || cropH <= 0) { resolve({ color: 'unknown' }); return; }
            canvas.width = cropW; canvas.height = cropH;
            ctx.drawImage(img, xStart, yStart, cropW, cropH, 0, 0, cropW, cropH);
            const imageData = ctx.getImageData(0, 0, cropW, cropH);
            const data = imageData.data;
            const hist = new Array(10 * 5).fill(0);
            let totalPixels = 0;
            for (let i = 0; i < data.length; i += 4) {
                const [r, g, b] = [data[i], data[i+1], data[i+2]];
                const hsv = rgbToHsv(r, g, b);
                if (hsv.s < 15 || hsv.v < 20) continue;
                const hBin = Math.floor(hsv.h / 36);
                const sBin = Math.floor(hsv.s / 20);
                if (hBin >= 0 && hBin < 10 && sBin >= 0 && sBin < 5) {
                    hist[hBin * 5 + sBin]++;
                    totalPixels++;
                }
            }
            if (totalPixels === 0) { resolve({ color: 'unknown' }); return; }
            let maxIdx = 0;
            for (let i = 1; i < hist.length; i++) {
                if (hist[i] > hist[maxIdx]) maxIdx = i;
            }
            const hueCenter = (Math.floor(maxIdx / 5) * 36 + 18) % 360;
            const colorName = getDominantColorName(hueCenter);
            resolve({ color: colorName });
        };
        img.onerror = () => resolve({ color: 'unknown' });
    });
}

// ==================== ACCESSORY DETECTION - THROTTLED ====================
function detectAccessories(landmarks, faceBox) {
    if (!landmarks || !landmarks.positions) {
        return { hasMask: false, hasGlasses: false, hasHat: false };
    }
    const pts = landmarks.positions;
    const result = { hasMask: false, hasGlasses: false, hasHat: false };

    const upperLip = pts[51];
    const lowerLip = pts[57];
    const mouthDist = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);
    const eyeDist = Math.hypot(pts[36].x - pts[45].x, pts[36].y - pts[45].y);
    if (mouthDist / eyeDist < 0.25) result.hasMask = true;

    const leftEye = pts[36];
    const rightEye = pts[45];
    const brow = pts[21];
    const browDist = Math.hypot(brow.x - leftEye.x, brow.y - leftEye.y);
    const faceHeight = Math.abs(pts[8].y - pts[27].y);
    if (browDist / faceHeight < 0.08) result.hasGlasses = true;

    const topLandmark = pts[8];
    const topBox = faceBox.top;
    if (Math.abs(topLandmark.y - topBox) / faceBox.height < 0.05) result.hasHat = true;

    return result;
}

// ==================== BEHAVIOR DETECTION ====================
let handsModel = null;
let handsInitialized = false;

async function loadMediaPipeModels() {
    if (handsInitialized) return;
    try {
        if (typeof Hands === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.5.3/hands.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        handsModel = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.5.3/${file}`,
            maxHands: 2
        });
        handsModel.setOptions({
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        handsInitialized = true;
        console.log('✅ MediaPipe Hands loaded');
    } catch (err) {
        console.warn('⚠️ Không tải được MediaPipe Hands (có thể bị Tracking Prevention chặn), sẽ bỏ qua phát hiện giơ tay/che mặt:', err.message);
        handsInitialized = false;
        statusEl.textContent = '⚠️ MediaPipe Hands không khả dụng (chặn tracking)';
        statusEl.style.background = '#fff3e0';
        statusEl.style.color = '#e65100';
        setTimeout(() => {
            statusEl.textContent = '✅ Sẵn sàng (không có hand detection)';
            statusEl.style.background = '#e8f5e9';
            statusEl.style.color = '#2e7d32';
        }, 3000);
    }
}

const attentionTracker = {
    isDrowsy: false,
    isDistracted: false,
    isFacingCovered: false,
    handRaised: false,
    drowsyStart: null,
    distractedStart: null,
    coveredStart: null,
    handRaisedStart: null,
    lastAlertTime: 0
};

function calculateEAR(landmarks) {
    if (!landmarks || !landmarks.positions) return 0;
    const pts = landmarks.positions;
    const leftEye = [pts[36], pts[37], pts[38], pts[39], pts[40], pts[41]];
    const rightEye = [pts[42], pts[43], pts[44], pts[45], pts[46], pts[47]];
    function ear(points) {
        const v1 = Math.hypot(points[1].x - points[5].x, points[1].y - points[5].y);
        const v2 = Math.hypot(points[2].x - points[4].x, points[2].y - points[4].y);
        const v3 = Math.hypot(points[0].x - points[3].x, points[0].y - points[3].y);
        return (v1 + v2) / (2 * v3);
    }
    return (ear(leftEye) + ear(rightEye)) / 2;
}

function getHeadOrientation(landmarks) {
    if (!landmarks || !landmarks.positions) {
        return { pitch: 0, yawRatio: 1 };
    }
    const pts = landmarks.positions;
    const nose = pts[30];
    const leftEyeAvg = pts[36];
    const rightEyeAvg = pts[45];
    const eyeCenterX = (leftEyeAvg.x + rightEyeAvg.x) / 2;
    const eyeCenterY = (leftEyeAvg.y + rightEyeAvg.y) / 2;
    const pitch = Math.atan2(nose.y - eyeCenterY, nose.x - eyeCenterX) * 180 / Math.PI;
    const leftDist = Math.hypot(nose.x - leftEyeAvg.x, nose.y - leftEyeAvg.y);
    const rightDist = Math.hypot(nose.x - rightEyeAvg.x, nose.y - rightEyeAvg.y);
    const yawRatio = leftDist / rightDist;
    return { pitch, yawRatio };
}

async function detectBehavior(faceLandmarks, faceBox, studentId, studentName) {
    const { pitch, yawRatio } = getHeadOrientation(faceLandmarks);
    const ear = calculateEAR(faceLandmarks);

    // Drowsiness
    const isDrowsy = (pitch > 20 && ear < 0.25);
    if (isDrowsy) {
        if (!attentionTracker.isDrowsy) {
            attentionTracker.isDrowsy = true;
            attentionTracker.drowsyStart = Date.now();
        }
        const duration = (Date.now() - attentionTracker.drowsyStart) / 1000;
        if (duration > 1.5) {
            await sendBehaviorAlert(studentId, 'Buồn ngủ / cúi đầu lâu');
            attentionTracker.drowsyStart = Date.now();
        }
    } else {
        attentionTracker.isDrowsy = false;
        attentionTracker.drowsyStart = null;
    }

    // Distracted
    const isDistracted = (yawRatio < 0.6 || yawRatio > 1.4);
    if (isDistracted) {
        if (!attentionTracker.isDistracted) {
            attentionTracker.isDistracted = true;
            attentionTracker.distractedStart = Date.now();
        }
        const duration = (Date.now() - attentionTracker.distractedStart) / 1000;
        if (duration > 2) {
            await sendBehaviorAlert(studentId, 'Quay ngang / mất tập trung');
            attentionTracker.distractedStart = Date.now();
        }
    } else {
        attentionTracker.isDistracted = false;
        attentionTracker.distractedStart = null;
    }

    // Hand detection only if MediaPipe initialized and frame count allows
    if (!handsInitialized || !handsModel) return;
    handFrameCounter++;
    if (handFrameCounter % CONFIG.HANDS_FRAME_SKIP !== 0) return;

    try {
        const handsResult = await new Promise((resolve) => {
            handsModel.onResults((results) => resolve(results));
            handsModel.send({ image: video });
        });
        if (handsResult && handsResult.multiHandLandmarks && handsResult.multiHandLandmarks.length > 0) {
            const hand = handsResult.multiHandLandmarks[0];
            const wrist = hand[0];
            const faceCenter = {
                x: faceBox.x + faceBox.width/2,
                y: faceBox.y + faceBox.height/2
            };
            const distToFace = Math.hypot(wrist.x - faceCenter.x, wrist.y - faceCenter.y);
            const faceSize = Math.max(faceBox.width, faceBox.height);
            if (distToFace < faceSize * 0.2) {
                await sendBehaviorAlert(studentId, 'Che mặt');
            }

            const indexTip = hand[8];
            const pinkyTip = hand[20];
            const spread = Math.hypot(indexTip.x - pinkyTip.x, indexTip.y - pinkyTip.y);
            const handIsRaised = (wrist.y < faceBox.top * 0.95) && (spread > 0.05);

            if (handIsRaised) {
                if (!attentionTracker.handRaised) {
                    attentionTracker.handRaised = true;
                    attentionTracker.handRaisedStart = Date.now();
                }
                const duration = (Date.now() - attentionTracker.handRaisedStart) / 1000;
                if (duration > 1) {
                    await sendBehaviorAlert(studentId, 'Giơ tay phát biểu');
                    attentionTracker.handRaisedStart = Date.now();
                }
            } else {
                attentionTracker.handRaised = false;
                attentionTracker.handRaisedStart = null;
            }
        } else {
            attentionTracker.handRaised = false;
            attentionTracker.handRaisedStart = null;
        }
    } catch (err) {
        // ignore
    }
}

async function sendBehaviorAlert(studentId, behavior) {
    try {
        const response = await fetchWithAuth(`${SERVER_URL}/api/behavior`, {
            method: 'POST',
            body: JSON.stringify({ studentId, behavior })
        });
        const data = await response.json();
        if (data.success) {
            console.log(`⚠️ Đã gửi cảnh báo hành vi cho ${studentId}: ${behavior}`);
            const logEntry = document.createElement('div');
            logEntry.style.color = '#f44336';
            logEntry.textContent = `🚨 ${new Date().toLocaleTimeString()} - ${studentId}: ${behavior}`;
            behaviorLog.prepend(logEntry);
            while (behaviorLog.children.length > 20) behaviorLog.removeChild(behaviorLog.lastChild);
        }
    } catch (err) {
        console.error('Lỗi gửi cảnh báo hành vi:', err);
    }
}

// ==================== FACE DETECTION & RECOGNITION ====================
// Helper: smoothed value
function getSmoothedState(studentId, key, newValue, timestamp) {
    if (!studentState[studentId]) {
        studentState[studentId] = {};
    }
    const state = studentState[studentId];
    if (!state[key] || (timestamp - state[key].timestamp) > CONFIG.SMOOTHING_WINDOW_MS) {
        state[key] = { value: newValue, timestamp: timestamp };
    }
    return state[key].value;
}

async function detectAndRecognize() {
    if (!isModelLoaded) return;
    cycleCount++;
    const runSubtasks = (cycleCount % CONFIG.SUBTASK_EVERY_N_CYCLES === 0);
    const runCrop = (cycleCount % CONFIG.CROP_EVERY_N_CYCLES === 0);

    const { canvas: processedCanvas, scale } = preprocessImage(video);
    let query = faceapi.detectAllFaces(processedCanvas, new faceapi.TinyFaceDetectorOptions({
        inputSize: CONFIG.DETECTOR_INPUT_SIZE,
        scoreThreshold: CONFIG.DETECTOR_SCORE_THRESHOLD
    })).withFaceLandmarks().withFaceDescriptors();

    if (runSubtasks) query = query.withFaceExpressions().withAgeAndGender();
    const detections = await query;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (detections.length === 0) {
        for (const key in negativeEmotionCount) negativeEmotionCount[key] = 0;
        return;
    }

    const validDetections = detections.filter(d => {
        const box = d.detection.box;
        return (box.width / scale) > 40 && (box.height / scale) > 40;
    });
    if (validDetections.length === 0) {
        for (const key in negativeEmotionCount) negativeEmotionCount[key] = 0;
        return;
    }

    // Giới hạn số lượng khuôn mặt gửi lên server (tối đa 20)
    const limitedDetections = validDetections.slice(0, CONFIG.MAX_DESCRIPTORS_PER_REQUEST);

    const scaledBoxes = limitedDetections.map(d => ({
        x: d.detection.box.x / scale,
        y: d.detection.box.y / scale,
        width: d.detection.box.width / scale,
        height: d.detection.box.height / scale
    }));

    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    scaledBoxes.forEach(b => ctx.strokeRect(b.x, b.y, b.width, b.height));

    const descriptors = limitedDetections.map(d => Array.from(d.descriptor));
    const emotions = limitedDetections.map(d => {
        if (!runSubtasks || !d.expressions) return null;
        const exp = d.expressions;
        let maxScore = 0, dominant = 'neutral';
        for (const [key, val] of Object.entries(exp)) {
            if (val > maxScore) { maxScore = val; dominant = key; }
        }
        return dominant;
    });

    // Crop images for Telegram
    const croppedImages = limitedDetections.map((d, i) => {
        if (!runCrop) return null;
        const fullResCanvas = document.createElement('canvas');
        fullResCanvas.width = video.videoWidth;
        fullResCanvas.height = video.videoHeight;
        const fctx = fullResCanvas.getContext('2d');
        fctx.drawImage(video, 0, 0);
        return cropFace(fullResCanvas, scaledBoxes[i]);
    });

    const ageGenders = limitedDetections.map(d => runSubtasks
        ? { age: d.age ? Math.round(d.age) : null, gender: d.gender || null }
        : { age: null, gender: null }
    );

    // --- Cloth & Accessory: ONLY when runSubtasks is true (throttled) ---
    let clothColors = [];
    let accessories = [];
    let fullFrameDataUrl = null;

    if (runSubtasks) {
        fullFrameDataUrl = captureFrameFromVideo(video);
        for (let i = 0; i < limitedDetections.length; i++) {
            const box = scaledBoxes[i];
            const cloth = await analyzeClothColor(fullFrameDataUrl, box);
            clothColors.push(cloth.color);
            const acc = detectAccessories(limitedDetections[i].landmarks, box);
            accessories.push(acc);
        }
    } else {
        clothColors = limitedDetections.map(() => '...');
        accessories = limitedDetections.map(() => ({ hasMask: false, hasGlasses: false, hasHat: false }));
    }

    try {
        const response = await fetchWithAuth(`${SERVER_URL}/api/recognize-multiple`, {
            method: 'POST',
            body: JSON.stringify({
                descriptors,
                emotions,
                croppedImages,
                ageGenders,
                clothColors,
                accessories
            })
        });
        const data = await response.json();
        if (data.success) {
            const now = Date.now();
            for (let idx = 0; idx < data.results.length; idx++) {
                const result = data.results[idx];
                const box = scaledBoxes[idx];
                const ag = ageGenders[idx] || {};
                const croppedImg = croppedImages[idx];
                const rawCloth = clothColors[idx] || 'unknown';
                const acc = accessories[idx] || { hasMask: false, hasGlasses: false, hasHat: false };

                if (result.studentId) {
                    const studentId = result.studentId;

                    // --- SMOOTHED EMOTION ---
                    const rawEmotion = result.emotion || 'neutral';
                    const smoothedEmotion = getSmoothedState(studentId, 'emotion', rawEmotion, now);
                    // --- SMOOTHED CLOTH COLOR ---
                    const smoothedCloth = getSmoothedState(studentId, 'cloth', rawCloth, now);

                    // Draw info
                    ctx.fillStyle = '#4caf50';
                    ctx.font = 'bold 18px Arial';
                    ctx.fillText(`✅ ${result.studentName}`, box.x, box.y - 28);
                    if (ag.age !== null || ag.gender) {
                        const genderIcon = ag.gender === 'male' ? '👨' : ag.gender === 'female' ? '👩' : '';
                        ctx.font = '13px Arial';
                        ctx.fillStyle = '#00bcd4';
                        ctx.fillText(`${genderIcon} ${ag.gender || ''} ${ag.age ? ag.age + 't' : ''}`, box.x, box.y - 10);
                    }
                    ctx.font = '14px Arial';
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(`😊 ${smoothedEmotion}`, box.x, box.y + box.height + 20);
                    // Show cloth & accessories
                    ctx.font = '12px Arial';
                    ctx.fillStyle = '#ffd700';
                    let extra = `Áo: ${smoothedCloth}`;
                    if (acc.hasMask) extra += ', 😷';
                    if (acc.hasGlasses) extra += ', 👓';
                    if (acc.hasHat) extra += ', 🎩';
                    ctx.fillText(extra, box.x, box.y + box.height + 40);

                    // Hiển thị confidence score (từ distance)
                    if (result.distance !== null) {
                        const confidence = Math.round((1 - result.distance) * 100);
                        ctx.fillStyle = '#00bcd4';
                        ctx.font = '12px Arial';
                        ctx.fillText(`Độ tin cậy: ${confidence}%`, box.x, box.y + box.height + 60);
                    }

                    // Send attendance photo to Telegram (first time today)
                    if (!attendanceSentToday.has(studentId) && croppedImg) {
                        attendanceSentToday.add(studentId);
                        try {
                            await fetchWithAuth(`${SERVER_URL}/api/attendance-notify`, {
                                method: 'POST',
                                body: JSON.stringify({
                                    studentId: result.studentId,
                                    studentName: result.studentName,
                                    image: croppedImg
                                })
                            });
                            console.log(`📸 Đã gửi ảnh điểm danh cho ${result.studentName}`);
                        } catch (err) {
                            console.error('Lỗi gửi ảnh điểm danh:', err);
                        }
                    }

                    // Negative emotion alert (using raw emotion to trigger alerts)
                    if (NEGATIVE_EMOTIONS.includes(rawEmotion)) {
                        if (!negativeEmotionCount[studentId]) negativeEmotionCount[studentId] = 0;
                        negativeEmotionCount[studentId]++;
                        if (negativeEmotionCount[studentId] >= NEGATIVE_EMOTION_THRESHOLD) {
                            sendBehaviorAlert(studentId, `Cảm xúc tiêu cực kéo dài (${rawEmotion})`);
                            negativeEmotionCount[studentId] = 0;
                        }
                    } else {
                        negativeEmotionCount[studentId] = 0;
                    }

                    // Behavior detection (face + hands) - only when runSubtasks
                    if (runSubtasks) {
                        await detectBehavior(limitedDetections[idx].landmarks, box, studentId, result.studentName);
                    }

                    // ============================================================
                    // BLINK DETECTION - REMOVED (no spoof warnings)
                    // ============================================================

                } else {
                    ctx.fillStyle = '#ff9800';
                    ctx.font = '18px Arial';
                    ctx.fillText('❓ Unknown', box.x, box.y - 10);
                }
            }
            updateAttendanceUI();
            updateStudentList(false);
        }
    } catch (err) {
        console.error('Lỗi gửi descriptor:', err);
        // Hiển thị thông báo lỗi trên UI (nếu có element)
        if (statusEl) {
            statusEl.textContent = '⚠️ Lỗi kết nối server';
            statusEl.style.background = '#fff3e0';
            statusEl.style.color = '#e65100';
            setTimeout(() => {
                if (isModelLoaded) {
                    statusEl.textContent = '✅ Sẵn sàng';
                    statusEl.style.background = '#e8f5e9';
                    statusEl.style.color = '#2e7d32';
                }
            }, 3000);
        }
    }
}

// ==================== AUTO REGISTER ====================
async function autoRegisterFromSamples() {
    if (autoRegisterDone) return;
    try {
        if (studentList.length > 0) {
            console.log(`✅ Đã có ${studentList.length} học sinh. Bỏ qua auto-register.`);
            autoRegisterDone = true;
            return;
        }
        console.log('🔄 Chưa có học sinh, tự động đăng ký từ ảnh mẫu...');
        const imagesRes = await fetch(`${SERVER_URL}/api/sample-images`);
        const data = await imagesRes.json();
        if (!data.success || data.images.length === 0) {
            console.log('⚠️ Không có ảnh mẫu trong thư mục database/');
            return;
        }
        let registeredCount = 0;
        for (const fileName of data.images) {
            const { studentId, name } = parseStudentInfoFromFilename(fileName);
            console.log(`📸 Đang xử lý: ${fileName} → ID: ${studentId}, Tên: ${name}`);
            const imgRes = await fetch(`${SERVER_URL}/api/sample-image/${fileName}`);
            const imgData = await imgRes.json();
            if (!imgData.success) { console.error(`❌ Không lấy được ảnh ${fileName}`); continue; }
            const img = new Image();
            img.src = `data:image/jpeg;base64,${imgData.base64}`;
            await img.decode();
            if (!img.complete || !img.naturalWidth) {
                console.warn(`⚠️ Ảnh ${fileName} không load được`);
                continue;
            }
            const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({
                inputSize: CONFIG.DETECTOR_INPUT_SIZE,
                scoreThreshold: CONFIG.DETECTOR_SCORE_THRESHOLD
            }))
            .withFaceLandmarks()
            .withFaceDescriptor()
            .withAgeAndGender();

            if (!detection) {
                console.warn(`⚠️ Không tìm thấy khuôn mặt trong ${fileName}`);
                continue;
            }
            const descriptor = Array.from(detection.descriptor);
            const gender = detection.gender || null;
            const age = detection.age ? Math.round(detection.age) : null;
            const box = detection.detection.box;
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = box.width;
            cropCanvas.height = box.height;
            const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
            cropCtx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
            const croppedImage = cropCanvas.toDataURL('image/jpeg', 0.9);
            const registerRes = await fetchWithAuth(`${SERVER_URL}/api/register`, {
                method: 'POST',
                body: JSON.stringify({ studentId, name, descriptor, croppedImage, gender, age })
            });
            const result = await registerRes.json();
            if (result.success) {
                console.log(`✅ Đã đăng ký ${name} (${studentId})`);
                registeredCount++;
            } else {
                console.error(`❌ Lỗi đăng ký ${name}: ${result.error}`);
            }
        }
        console.log(`🎉 Hoàn tất tự động đăng ký! Đã đăng ký ${registeredCount} học sinh.`);
        autoRegisterDone = true;
        await updateStudentList(true);
        updateAttendanceUI();
    } catch (err) {
        console.error('Lỗi auto-register:', err);
    }
}

// ==================== UPDATE UI ====================
async function updateAttendanceUI() {
    try {
        const res = await fetch(`${SERVER_URL}/api/attendance`);
        const data = await res.json();
        let html = '';
        if (data.students.length === 0) {
            html = '❌ Chưa có học sinh nào được điểm danh';
        } else {
            data.students.forEach(s => {
                html += `<div class="student-item"><span class="name">${s.name}</span><span class="status">✅ Có mặt</span></div>`;
            });
        }
        attendanceList.innerHTML = html;
    } catch (err) {
        console.error('Lỗi lấy điểm danh:', err);
        attendanceList.innerHTML = '❌ Không thể tải điểm danh';
    }
}

// ==================== UI EVENTS ====================
document.getElementById('captureBtn').addEventListener('click', async () => {
    await detectAndRecognize();
});
document.getElementById('attendanceBtn').addEventListener('click', async () => {
    await updateAttendanceUI();
    await updateStudentList(true);
});

registerBtn.onclick = function() {
    modal.style.display = 'block';
    studentName.value = '';
    studentId.value = '';
    previewImage.style.display = 'none';
    registerStatus.textContent = '';
};
closeBtn.onclick = function() { modal.style.display = 'none'; };
window.onclick = function(event) {
    if (event.target == modal) modal.style.display = 'none';
};

imageUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(ev) {
            previewImage.src = ev.target.result;
            previewImage.style.display = 'block';
            registerStatus.textContent = '📸 Ảnh đã tải, đang trích xuất khuôn mặt...';
        };
        reader.readAsDataURL(file);
    }
});

submitRegister.addEventListener('click', async function() {
    const name = studentName.value.trim();
    const id = studentId.value.trim();
    const file = imageUpload.files[0];
    if (!name || !id) { registerStatus.textContent = '❌ Vui lòng nhập đầy đủ họ tên và mã số.'; return; }
    if (!file) { registerStatus.textContent = '❌ Vui lòng chọn ảnh khuôn mặt.'; return; }

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({
        inputSize: CONFIG.DETECTOR_INPUT_SIZE,
        scoreThreshold: CONFIG.DETECTOR_SCORE_THRESHOLD
    }))
    .withFaceLandmarks()
    .withFaceDescriptor()
    .withAgeAndGender();

    if (!detection) {
        registerStatus.textContent = '❌ Không tìm thấy khuôn mặt trong ảnh. Vui lòng chọn ảnh khác.';
        return;
    }
    const descriptor = Array.from(detection.descriptor);
    const gender = detection.gender || null;
    const age = detection.age ? Math.round(detection.age) : null;
    const box = detection.detection.box;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = box.width;
    cropCanvas.height = box.height;
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropCtx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const croppedImage = cropCanvas.toDataURL('image/jpeg', 0.9);

    try {
        const response = await fetchWithAuth(`${SERVER_URL}/api/register`, {
            method: 'POST',
            body: JSON.stringify({ studentId: id, name, descriptor, croppedImage, gender, age })
        });
        const data = await response.json();
        if (data.success) {
            registerStatus.textContent = `✅ Đăng ký thành công học sinh ${name} (${id})`;
            setTimeout(() => { modal.style.display = 'none'; }, 2000);
            await updateStudentList(true);
            updateAttendanceUI();
        } else {
            registerStatus.textContent = `❌ Lỗi: ${data.error || 'Không xác định'}`;
        }
    } catch (err) {
        console.error(err);
        registerStatus.textContent = '❌ Lỗi kết nối server.';
    }
});

// ==================== START ====================
loadModels();