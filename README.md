# 🏫 Hệ thống giám sát lớp học thông minh

Hệ thống sử dụng **Face‑API.js** để nhận diện khuôn mặt, điểm danh tự động, gửi báo cáo qua Telegram và hỗ trợ giáo viên giám sát lớp học từ xa.

---

## 📌 Giới thiệu

Dự án này được xây dựng nhằm tự động hóa việc điểm danh, theo dõi cảm xúc và cảnh báo hành vi trong lớp học. Thay vì điểm danh thủ công, camera sẽ nhận diện khuôn mặt học sinh, ghi nhận thời gian có mặt, gửi báo cáo định kỳ qua Telegram và lưu lịch sử dữ liệu để phân tích sau.

---

## 🛠️ Công nghệ sử dụng

| Thành phần | Công nghệ |
|------------|-----------|
| Frontend (trình duyệt) | HTML5, CSS3, JavaScript (vanilla) |
| Nhận diện khuôn mặt | [face-api.js](https://github.com/justadudewhohacks/face-api.js) (SSD Mobilenet v1, TinyFaceDetector, FaceLandmark68, FaceRecognitionNet, FaceExpressionNet) |
| Backend | Node.js + Express |
| Cơ sở dữ liệu | SQLite (lưu log điểm danh, cảm xúc, hành vi) |
| Lưu trữ descriptor | JSON (hỗ trợ nhiều descriptor cho mỗi học sinh) |
| Thông báo | Telegram Bot API (node-telegram-bot-api) |
| Xử lý ảnh | Canvas (crop, resize, encode base64) |
| Môi trường | dotenv (quản lý biến môi trường) |

---

## ✨ Tính năng chính

- ✅ **Tự động đăng ký học sinh** từ ảnh mẫu (đọc ảnh trong thư mục `database/`)
- ✅ **Nhận diện đa khuôn mặt** từ camera (hỗ trợ khoảng cách xa nhờ TinyFaceDetector)
- ✅ **Trích xuất và lưu ảnh crop** của từng học sinh để huấn luyện bổ sung
- ✅ **Nhận diện cảm xúc** (7 trạng thái: happy, sad, angry, ...)
- ✅ **Điểm danh tự động** theo ca học (với khung giờ cấu hình)
- ✅ **Gửi báo cáo qua Telegram** theo lịch (phút 5 & 25 mỗi giờ) hoặc thủ công
- ✅ **Dashboard trên Telegram** (các lệnh `/today`, `/stats`, `/student <id>`, `/report`)
- ✅ **Cảnh báo hành vi** (API sẵn sàng, chờ tích hợp frontend)
- ✅ **Lưu lịch sử hành động** (điểm danh, cảm xúc, hành vi) vào SQLite
- ✅ **Tự động xóa ảnh crop cũ** (chỉ giữ 10 ảnh gần nhất mỗi học sinh)
- ✅ **Hỗ trợ nhiều descriptor** mỗi học sinh (cải thiện độ chính xác)

---

## ⚙️ Yêu cầu hệ thống

- Node.js 16.x trở lên
- npm hoặc yarn
- Camera web (hoặc video source)
- Tài khoản Telegram Bot (lấy token từ BotFather)

---

## 🚀 Cài đặt và chạy

### 1. Clone dự án

```bash
git clone https://github.com/shirmtry/DAP.git
cd DAP
```

### 2. Cài đặt backend

```bash
cd backend
npm install
```

### 3. Cấu hình biến môi trường

Tạo file `.env` trong thư mục `backend/` với nội dung:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
PORT=5000
```

> **Lưu ý:** Không đẩy file `.env` lên Git (đã có trong `.gitignore`).

### 4. Chuẩn bị ảnh mẫu

Đặt ảnh khuôn mặt học sinh (tên file trùng với tên học sinh, ví dụ `Bao.jpg`) vào thư mục `backend/database/`. Hệ thống sẽ tự động crop và đăng ký khi chạy lần đầu.

### 5. Chạy server

```bash
npm start
# hoặc dùng nodemon để tự động reload
npm run dev
```

Server chạy tại `http://localhost:5000`.

### 6. Mở trình duyệt

- Frontend: `http://localhost:5000`
- Báo cáo thủ công: `http://localhost:5000/api/send-report`
- Debug số học sinh: `http://localhost:5000/api/debug/students`

---

## 📁 Cấu trúc thư mục

```
classroom-monitor/
├── backend/
│   ├── database/
│   │   ├── Bao.jpg              # ảnh mẫu
│   │   ├── student_data/        # thư mục chứa ảnh crop & descriptor của từng HS
│   │   ├── descriptors.json     # tổng hợp descriptor (dùng fallback)
│   │   └── classroom.db         # SQLite database
│   ├── models/                  # face-api.js models
│   ├── db.js                    # kết nối và truy vấn SQLite
│   ├── server.js                # main server
│   ├── package.json
│   └── .env
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── script.js                # logic nhận diện trên trình duyệt
│   └── face-api.min.js
├── telegram-bot/
│   └── bot.js                   # (có thể bỏ, server đã tích hợp bot)
├── .gitignore
└── README.md
```

---

## 📋 Checklist hoàn thiện

| Mục | Trạng thái | Ghi chú |
|-----|------------|---------|
| **Tự động đăng ký từ ảnh mẫu** | ✅ Hoàn thành | Tự động khi chưa có học sinh |
| **Nhận diện xa (TinyFaceDetector)** | ✅ Hoàn thành | `inputSize=608`, lọc mặt > 60px |
| **Trích xuất và lưu ảnh crop** | ✅ Hoàn thành | Mỗi HS chỉ giữ 10 ảnh mới nhất |
| **Lưu nhiều descriptor mỗi HS** | ✅ Hoàn thành | Tự động học bổ sung |
| **Nhận diện cảm xúc** | ✅ Hoàn thành | 7 trạng thái |
| **Điểm danh theo ca học** | ✅ Hoàn thành | Cấu hình trong `STUDY_SESSIONS` |
| **Gửi báo cáo qua Telegram** | ✅ Hoàn thành | Tự động (phút 5 & 25) và thủ công |
| **Lệnh Telegram dashboard** | ✅ Hoàn thành | `/today`, `/stats`, `/student`, `/report` |
| **Gửi ảnh kèm báo cáo** | ✅ Hoàn thành | Ảnh của học sinh đầu tiên có mặt |
| **Cảnh báo hành vi** | ⚠️ Chưa tích hợp tự động | API đã có, cần frontend phát hiện (MediaPipe Hands / COCO-SSD) |
| **Phân biệt giới tính** | ❌ Chưa có | Có thể tích hợp age-gender model của face-api |
| **Hiển thị thời gian Việt Nam (UTC+7)** | ✅ Hoàn thành | Hàm `getVietnamTime()` trong `db.js` |
| **Giới hạn số ảnh crop lưu** | ✅ Hoàn thành | Tối đa 10 ảnh / học sinh |
| **Log khoảng cách (distance)** | ✅ Hoàn thành | In ra console để debug |
| **Xóa file không cần thiết khỏi Git** | ⚠️ Nên làm | Đã có `.gitignore` nhưng cần thêm `*.db`, `student_data/`, `descriptors.json` |

---

## 🐛 Bug hiện tại và hướng khắc phục

| Bug | Nguyên nhân | Cách khắc phục |
|-----|-------------|----------------|
| **Nhận diện nhầm người (Phú ra Huy)** | Ngưỡng threshold=0.65 quá cao, cho phép sai số lớn | Giảm threshold về 0.6 (đã sửa) hoặc tăng số descriptor |
| **Lưu quá nhiều ảnh crop (hàng trăm)** | Chưa có cơ chế giới hạn | Đã thêm hàm `limitCroppedImages()` giữ tối đa 10 ảnh |
| **Không gửi ảnh báo cáo khi có mặt** | Đường dẫn ảnh crop bị lỗi hoặc thư mục trống | Đã thêm kiểm tra `fs.existsSync` và log lỗi |
| **Thời gian log sai (UTC)** | SQLite lưu theo giờ UTC | Đã thêm hàm `getVietnamTime()` để lưu UTC+7 |
| **Cảnh báo hành vi chưa tự động** | Chưa có frontend phát hiện hành vi | Cần tích hợp MediaPipe Hands hoặc COCO-SSD |
| **File `.db` và ảnh crop bị đẩy lên Git** | `.gitignore` chưa có đầy đủ | Cập nhật `.gitignore` và dùng `git rm --cached` |

---

## 🔮 Hướng phát triển

- 🧠 Tích hợp phát hiện giơ tay (MediaPipe Hands)
- 📱 Phát hiện sử dụng điện thoại (COCO‑SSD)
- 🧑‍🏫 Giao diện quản lý giáo viên (React/Vue)
- 📊 Biểu đồ thống kê chuyên cần và cảm xúc
- 🗣️ Điểm danh bằng giọng nói (Web Speech API)
- 🔒 Xác thực và phân quyền cho nhiều giáo viên

---

## 🤝 Đóng góp

Mọi ý kiến đóng góp, báo lỗi xin vui lòng tạo Issue hoặc Pull Request trên GitHub.  
Dự án đang trong giai đoạn phát triển, rất mong nhận được sự hỗ trợ từ cộng đồng.

---

## ✍️ Tác giả

**ShirmTry** – *HUYTKING* – [GitHub](https://github.com/shirmtry)