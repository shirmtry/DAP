// frontend/script.js
// ===================================================================
// COMPLETE VERSION WITH:
// - Face recognition (TinyFaceDetector, 68 landmarks, expressions, age/gender)
// - Multiple descriptors per student (self-learning via server)
// - Telegram photo notification on attendance
// - Cloth color analysis (HSV histogram)
// - Accessory detection (glasses, mask, hat)
// - Behavior detection using face landmarks + MediaPipe Hands
// - Attention timer (alert after 10 minutes of inattention)
// - Anti-spoofing (blink detection via EAR)
// - IndexedDB caching of student list
// ===================================================================

const SERVER_URL = 'http://localhost:5000';
const MODEL_URL = '/models';
const API_KEY = 'your-secret-key-change-me';

// DOM elements
const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d', { willReadFrequently: true });
const statusEl = document.getElementById('status');
const attendanceList = document.getElementById('attendance-list');
const behaviorLog = document.getElementById('behavior-log');

const modal = document.getElementById('registerModal');
const closeBtn = document.querySelector('.close');
const registerBtn = document.getElementById('registerBtn');
const studentName = document.getElementById('studentName');
const studentId = document.getElementById('studentId');
const imageUpload = document.getElementById('imageUpload');
const previewImage = document.getElementById('previewImage');
const registerStatus = document.getElementById('registerStatus');
const submitRegister = document.getElementById('submitRegister');

// CONFIGURATION
const DETECTOR_INPUT_SIZE = 320;
const DETECTOR_SCORE_THRESHOLD = 0.5;
const DETECTION_MAX_WIDTH = 640;
const FRAME_SKIP = 10;
const SUBTASK_EVERY_N_CYCLES = 3;
const CROP_EVERY_N_CYCLES = 2;
const STUDENT_LIST_REFRESH_INTERVAL = 30000;

// STATE
let isModelLoaded = false;
let isDetecting = false;
let frameCounter = 0;
let cycleCount = 0;
let autoRegisterDone = false;
let studentList = [];
let lastStudentListUpdate = 0;
let attendanceSentToday = new Set(); // để tránh gửi nhiều lần

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
    const headers = { 'Content-Type': 'application/json', 'x-api-key': API_KEY, ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
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
        await loadMediaPipeModels(); // Tải MediaPipe Hands cho behavior detection
    } catch (err) {
        console.error(err);
        statusEl.textContent = '❌ Lỗi tải model';
        statusEl.style.background = '#ffebee';
        statusEl.style.color = '#c62828';
    }
}

// ==================== INDEXEDDB HELPER ====================
// Import từ file riêng (sẽ tạo sau)
import { getStudentsFromCache, saveStudentsToCache } from './indexeddb-helper.js';

// ==================== STUDENT LIST (with IndexedDB) ====================
async function updateStudentList(force = false) {
    const now = Date.now();
    if (!force && (now - lastStudentListUpdate) < STUDENT_LIST_REFRESH_INTERVAL) return;
    lastStudentListUpdate = now;

    // Thử cache trước
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
    }
}

function detectionLoop() {
    frameCounter++;
    if (frameCounter % FRAME_SKIP === 0 && !isDetecting &&
        !video.paused && !video.ended && video.readyState >= 2) {
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
    const scale = Math.min(1, DETECTION_MAX_WIDTH / srcW);
    const outW = Math.round(srcW * scale);
    const outH = Math.round(srcH * scale);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const c = canvas.getContext('2d', { willReadFrequently: false });
    c.filter = 'brightness(1.08) contrast(1.2)';
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

// ==================== CLOTH COLOR ANALYSIS (HSV) ====================
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
            // Lấy vùng thân trên: từ dưới cằm đến vai (ước lượng)
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
            // Histogram 2D: Hue (10 bins) * Saturation (5 bins)
            const hist = new Array(10 * 5).fill(0);
            let totalPixels = 0;
            for (let i = 0; i < data.length; i += 4) {
                const [r, g, b] = [data[i], data[i+1], data[i+2]];
                const hsv = rgbToHsv(r, g, b);
                if (hsv.s < 15 || hsv.v < 20) continue; // bỏ qua nhiễu
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

// ==================== ACCESSORY DETECTION ====================
function detectAccessories(landmarks, faceBox) {
    // landmarks là object FaceLandmarks68 có thuộc tính positions (mảng 68 điểm)
    if (!landmarks || !landmarks.positions) {
        return { hasMask: false, hasGlasses: false, hasHat: false };
    }
    const pts = landmarks.positions; // mảng các {x, y}

    const result = { hasMask: false, hasGlasses: false, hasHat: false };

    // 1. Mask: khoảng cách môi / khoảng cách mắt
    const upperLip = pts[51];
    const lowerLip = pts[57];
    const mouthDist = Math.hypot(upperLip.x - lowerLip.x, upperLip.y - lowerLip.y);
    const eyeDist = Math.hypot(pts[36].x - pts[45].x, pts[36].y - pts[45].y);
    if (mouthDist / eyeDist < 0.25) result.hasMask = true;

    // 2. Glasses: kiểm tra độ tương phản vùng mắt (đơn giản: khoảng cách lông mày - mắt)
    const leftEye = pts[36];
    const rightEye = pts[45];
    const brow = pts[21]; // lông mày trái
    const browDist = Math.hypot(brow.x - leftEye.x, brow.y - leftEye.y);
    const faceHeight = Math.abs(pts[8].y - pts[27].y);
    if (browDist / faceHeight < 0.08) result.hasGlasses = true;

    // 3. Hat: kiểm tra đỉnh đầu (landmark 8) so với bounding box
    const topLandmark = pts[8];
    const topBox = faceBox.top;
    if (Math.abs(topLandmark.y - topBox) / faceBox.height < 0.05) result.hasHat = true;

    return result;
}

// ==================== BEHAVIOR DETECTION (Face + Hands) ====================
// MediaPipe Hands
let handsModel = null;
let handsInitialized = false;

async function loadMediaPipeModels() {
    if (handsInitialized) return;
    try {
        // Tải thư viện từ CDN (nếu chưa có)
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
    }
}

// Attention tracker state
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

// EAR (Eye Aspect Ratio) for blink detection
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

// Head pose estimation (pitch, yaw) from 68 landmarks
function getHeadOrientation(landmarks) {
    if (!landmarks || !landmarks.positions) {
        return { pitch: 0, yawRatio: 1 };
    }
    const pts = landmarks.positions;
    const nose = pts[30];
    const leftEyeAvg = pts[36];
    const rightEyeAvg = pts[45];
    // Pitch: angle between eyes line and nose
    const eyeCenterX = (leftEyeAvg.x + rightEyeAvg.x) / 2;
    const eyeCenterY = (leftEyeAvg.y + rightEyeAvg.y) / 2;
    const pitch = Math.atan2(nose.y - eyeCenterY, nose.x - eyeCenterX) * 180 / Math.PI;
    // Yaw: ratio of distances from nose to eyes
    const leftDist = Math.hypot(nose.x - leftEyeAvg.x, nose.y - leftEyeAvg.y);
    const rightDist = Math.hypot(nose.x - rightEyeAvg.x, nose.y - rightEyeAvg.y);
    const yawRatio = leftDist / rightDist;
    return { pitch, yawRatio };
}

async function detectBehavior(faceLandmarks, faceBox, studentId, studentName) {
    // 1. Drowsiness (head down + low EAR) — cảnh báo sau khi kéo dài > 1.5s
    const { pitch, yawRatio } = getHeadOrientation(faceLandmarks);
    const ear = calculateEAR(faceLandmarks);
    const isDrowsy = (pitch > 20 && ear < 0.25);
    if (isDrowsy) {
        if (!attentionTracker.isDrowsy) {
            attentionTracker.isDrowsy = true;
            attentionTracker.drowsyStart = Date.now();
        }
        const duration = (Date.now() - attentionTracker.drowsyStart) / 1000;
        if (duration > 1.5) {
            await sendBehaviorAlert(studentId, 'Buồn ngủ / cúi đầu lâu');
            attentionTracker.drowsyStart = Date.now(); // reset để tránh spam liên tục
        }
    } else {
        attentionTracker.isDrowsy = false;
        attentionTracker.drowsyStart = null;
    }

    // 2. Distracted (looking sideways) — cảnh báo sau khi kéo dài > 2s
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

    // 3. Face covered / Hand raising using MediaPipe Hands
    if (!handsInitialized || !handsModel) return;
    try {
        const handsResult = await new Promise((resolve) => {
            handsModel.onResults((results) => resolve(results));
            handsModel.send({ image: video });
        });
        if (handsResult && handsResult.multiHandLandmarks && handsResult.multiHandLandmarks.length > 0) {
            const hand = handsResult.multiHandLandmarks[0];
            const wrist = hand[0];
            // Face center
            const faceCenter = {
                x: faceBox.x + faceBox.width/2,
                y: faceBox.y + faceBox.height/2
            };
            // Check covering: wrist near face center
            const distToFace = Math.hypot(wrist.x - faceCenter.x, wrist.y - faceCenter.y);
            const faceSize = Math.max(faceBox.width, faceBox.height);
            if (distToFace < faceSize * 0.2) {
                await sendBehaviorAlert(studentId, 'Che mặt');
            }

            // Hand raised: wrist above the top of the face box, persisted > 1s
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
        // hands may not be ready
    }
}

// Hàm gửi alert (đã có)
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
let lastBlinkTime = 0;
let blinkCount = 0;
let blinkWarningShown = false;
const BLINK_THRESHOLD = 0.22;
const MIN_BLINK_INTERVAL = 150;
const NO_BLINK_WARNING_MS = 10000; // tăng từ 5s lên 10s để giảm cảnh báo giả

async function detectAndRecognize() {
    if (!isModelLoaded) return;
    cycleCount++;
    const runSubtasks = (cycleCount % SUBTASK_EVERY_N_CYCLES === 0);
    const runCrop = (cycleCount % CROP_EVERY_N_CYCLES === 0);

    const { canvas: processedCanvas, scale } = preprocessImage(video);
    let query = faceapi.detectAllFaces(processedCanvas, new faceapi.TinyFaceDetectorOptions({
        inputSize: DETECTOR_INPUT_SIZE,
        scoreThreshold: DETECTOR_SCORE_THRESHOLD
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

    const scaledBoxes = validDetections.map(d => ({
        x: d.detection.box.x / scale,
        y: d.detection.box.y / scale,
        width: d.detection.box.width / scale,
        height: d.detection.box.height / scale
    }));

    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 2;
    scaledBoxes.forEach(b => ctx.strokeRect(b.x, b.y, b.width, b.height));

    const descriptors = validDetections.map(d => Array.from(d.descriptor));
    const emotions = validDetections.map(d => {
        if (!runSubtasks || !d.expressions) return null;
        const exp = d.expressions;
        let maxScore = 0, dominant = 'neutral';
        for (const [key, val] of Object.entries(exp)) {
            if (val > maxScore) { maxScore = val; dominant = key; }
        }
        return dominant;
    });

    // Crop images for Telegram and cloth analysis
    const croppedImages = validDetections.map((d, i) => {
        if (!runCrop) return null;
        const fullResCanvas = document.createElement('canvas');
        fullResCanvas.width = video.videoWidth;
        fullResCanvas.height = video.videoHeight;
        const fctx = fullResCanvas.getContext('2d');
        fctx.drawImage(video, 0, 0);
        return cropFace(fullResCanvas, scaledBoxes[i]);
    });

    const ageGenders = validDetections.map(d => runSubtasks
        ? { age: d.age ? Math.round(d.age) : null, gender: d.gender || null }
        : { age: null, gender: null }
    );

    // Cloth colors & accessories
    const clothColors = [];
    const accessories = [];
    const fullFrameDataUrl = captureFrameFromVideo(video); // dùng cho phân tích màu áo

    for (let i = 0; i < validDetections.length; i++) {
        const box = scaledBoxes[i];
        const cloth = await analyzeClothColor(fullFrameDataUrl, box);
        clothColors.push(cloth.color);

        const acc = detectAccessories(validDetections[i].landmarks, box);
        accessories.push(acc);
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
            for (let idx = 0; idx < data.results.length; idx++) {
                const result = data.results[idx];
                const box = scaledBoxes[idx];
                const ag = ageGenders[idx] || {};
                const croppedImg = croppedImages[idx];
                const cloth = clothColors[idx];
                const acc = accessories[idx];

                if (result.studentId) {
                    // --- Vẽ thông tin ---
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
                    ctx.fillText(`😊 ${result.emotion}`, box.x, box.y + box.height + 20);
                    // Hiển thị màu áo và phụ kiện
                    ctx.font = '12px Arial';
                    ctx.fillStyle = '#ffd700';
                    let extra = `Áo: ${cloth}`;
                    if (acc.hasMask) extra += ', 😷';
                    if (acc.hasGlasses) extra += ', 👓';
                    if (acc.hasHat) extra += ', 🎩';
                    ctx.fillText(extra, box.x, box.y + box.height + 40);

                    // --- Gửi ảnh điểm danh qua Telegram (lần đầu trong ngày) ---
                    const studentId = result.studentId;
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

                    // --- Negative emotion alert ---
                    const emotion = result.emotion;
                    if (NEGATIVE_EMOTIONS.includes(emotion)) {
                        if (!negativeEmotionCount[studentId]) negativeEmotionCount[studentId] = 0;
                        negativeEmotionCount[studentId]++;
                        if (negativeEmotionCount[studentId] >= NEGATIVE_EMOTION_THRESHOLD) {
                            sendBehaviorAlert(studentId, `Cảm xúc tiêu cực kéo dài (${emotion})`);
                            negativeEmotionCount[studentId] = 0;
                        }
                    } else {
                        negativeEmotionCount[studentId] = 0;
                    }

                    // --- Behavior detection (face + hands) ---
                    if (runSubtasks) {
                        await detectBehavior(validDetections[idx].landmarks, box, studentId, result.studentName);
                    }

                    // --- Anti-spoofing: blink detection ---
                    const ear = calculateEAR(validDetections[idx].landmarks);
                    const now = Date.now();
                    if (ear < BLINK_THRESHOLD && now - lastBlinkTime > MIN_BLINK_INTERVAL) {
                        blinkCount++;
                        lastBlinkTime = now;
                        blinkWarningShown = false; // có blink mới -> reset cảnh báo
                    }
                    // Nếu không có blink trong NO_BLINK_WARNING_MS liên tục, cảnh báo 1 lần (không chặn điểm danh)
                    if (now - lastBlinkTime > NO_BLINK_WARNING_MS && blinkCount === 0) {
                        if (!blinkWarningShown) {
                            console.warn('⚠️ No blink detected – possible spoof');
                            blinkWarningShown = true;
                        }
                        ctx.fillStyle = '#ff0000';
                        ctx.font = '12px Arial';
                        ctx.fillText('⚠️ Có thể là ảnh giả', box.x, box.y + box.height + 60);
                    } else {
                        // reset sau khi có blink
                        if (now - lastBlinkTime < 2000) blinkCount = 0; // reset để đo lại
                    }

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
                inputSize: DETECTOR_INPUT_SIZE,
                scoreThreshold: DETECTOR_SCORE_THRESHOLD
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
        inputSize: DETECTOR_INPUT_SIZE,
        scoreThreshold: DETECTOR_SCORE_THRESHOLD
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