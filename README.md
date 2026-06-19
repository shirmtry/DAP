# 🌾 MÙA VÀNG AGENT

> **Hệ thống Multi‑Agent cảnh báo sâu bệnh cà phê Tây Nguyên**  
> *Hackathon AI for Agriculture* – Powered by **Groq (Text + Vision)** + OpenWeatherMap

---

## 📌 Giới thiệu

MÙA VÀNG AGENT là một ứng dụng Streamlit sử dụng hai tác nhân AI (Agent) để phân tích dữ liệu thời tiết, dự báo nguy cơ bệnh hại trên cây cà phê và đưa ra khuyến cáo kinh tế. Ngoài ra, hệ thống còn hỗ trợ **nhận diện bệnh từ ảnh lá/cây** thông qua mô hình Vision của Groq – tất cả chỉ cần một API key duy nhất.

---

## 🚀 Chạy trong 5 phút

### 1. Clone và cài đặt

```bash
# Clone hoặc giải nén dự án
cd mua-vang-agent

# Tạo môi trường ảo (khuyến nghị)
python -m venv venv
source venv/bin/activate          # Linux / macOS
# hoặc: venv\Scripts\activate     # Windows

# Cài đặt thư viện
pip install -r requirements.txt
```

### 2. Cấu hình API keys

```bash
cp .env.example .env
```

Mở file `.env` và điền các thông số sau:

| Key                     | Mô tả                                                                  | Lấy tại                                                                 |
|-------------------------|------------------------------------------------------------------------|-------------------------------------------------------------------------|
| `GROQ_API_KEY`          | **BẮT BUỘC** – dùng cho cả văn bản (Llama 3) và hình ảnh (Vision)      | [console.groq.com](https://console.groq.com/keys)                      |
| `OPENWEATHER_API_KEY`   | (Không bắt buộc) – thời tiết thực tế. Nếu thiếu, hệ thống dùng dữ liệu mô phỏng | [openweathermap.org](https://openweathermap.org/api) |

> **Lưu ý:** Chỉ cần `GROQ_API_KEY` là đủ để vận hành toàn bộ hệ thống (text + vision).  
> Không còn phụ thuộc vào Anthropic / Claude Vision.

### 3. Khởi động ứng dụng

```bash
streamlit run app.py
```

Mở trình duyệt tại `http://localhost:8501`.

---

## 🤖 Kiến trúc Multi‑Agent (đã cập nhật)

```
┌─────────────────────────────────────────────────────────┐
│                   STREAMLIT FRONTEND                     │
│   • Upload ảnh (Groq Vision)                           │
│   • Nhập vị trí & câu hỏi                              │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────▼─────────────┐
         │   OpenWeatherMap API      │
         │   (Thời tiết thực tế)     │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │   Knowledge Base          │
         │   (diseases.json)         │
         │   6 bệnh phổ biến TN     │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │    DUAL-AGENT SYSTEM      │
         │  (Groq Llama 3)           │
         │                           │
         │ Agent 1: Weather & Disease│
         │ Agent 2: Economics        │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │  llama3-70b-8192 (Groq)   │
         │  + Vision Model           │
         │  (miễn phí, siêu nhanh)   │
         └─────────────┬─────────────┘
                       │
         ┌─────────────▼─────────────┐
         │       KẾT QUẢ             │
         │  • Cảnh báo bệnh hại      │
         │  • Dự báo kinh tế         │
         │  • Nhận diện ảnh          │
         │  • Mô phỏng Zalo Alert    │
         └───────────────────────────┘
```

---

## 📁 Cấu trúc dự án

```
mua-vang-agent/
├── app.py                  # Ứng dụng Streamlit chính (tích hợp Groq Vision)
├── diseases.json           # Knowledge base (6 bệnh cà phê Tây Nguyên)
├── requirements.txt        # Danh sách thư viện Python
├── .env.example            # Mẫu cấu hình môi trường
└── README.md               # Tài liệu này
```

> **Lưu ý:** Dự án hiện tại không sử dụng CrewAI hay các framework agent phức tạp. Thay vào đó là 2 agent đơn giản chạy tuần tự qua Groq API.

---

## 🌿 Knowledge Base: Bệnh hại Cà phê Tây Nguyên

Hệ thống tích hợp sẵn 6 bệnh phổ biến, được định nghĩa trong `diseases.json`:

| Bệnh                             | Loại          | Mức độ    | Thiệt hại năng suất |
|----------------------------------|---------------|-----------|----------------------|
| Gỉ sắt (Coffee Leaf Rust)        | Nấm           | Cao       | 30–60%               |
| Vàng lá (Chlorosis)              | Sinh lý       | Trung bình| 15–30%               |
| Đốm mắt cua (Brown Eye Spot)     | Nấm           | Trung bình| 10–25%               |
| Nấm hồng (Pink Disease)          | Nấm           | Cao       | 20–50%               |
| Đốm nâu lá (Cercospora)          | Nấm           | Thấp      | 5–15%                |
| Khô cành/Chết ngọn (Dieback)     | Nấm/Côn trùng | Cao       | 20–40%               |

Mỗi bệnh bao gồm: điều kiện bùng phát (nhiệt độ, độ ẩm, mưa), triệu chứng, khuyến cáo xử lý và tác động kinh tế.

---

## ⚙️ Yêu cầu hệ thống

- Python 3.10 trở lên
- RAM: 2 GB trở lên
- Kết nối Internet (để gọi API Groq)

---

## 🔑 API Keys – miễn phí

| Dịch vụ                   | URL                                | Giới hạn miễn phí |
|---------------------------|------------------------------------|-------------------|
| Groq (Llama 3 + Vision)   | [console.groq.com](https://console.groq.com/keys) | 1000 requests/phút |
| OpenWeatherMap            | [openweathermap.org](https://openweathermap.org/api) | 60 requests/phút (không bắt buộc) |

> 💡 **Không có OpenWeatherMap key?** App tự động chuyển sang dữ liệu mô phỏng.

---

## 🛠️ Xử lý sự cố

### Lỗi `use_container_width` khi chạy Streamlit

- Nâng cấp Streamlit: `pip install streamlit --upgrade`
- Hoặc sửa tham số thành `use_column_width=True` trong `app.py`.

### Groq API trả về 429 (quá hạn mức)

- Chờ 1–2 phút rồi thử lại.
- Hệ thống tự động chuyển sang chế độ fallback (không cần key) nếu không có key.

### Lỗi nhận diện ảnh

- Đảm bảo `GROQ_API_KEY` có quyền sử dụng model `llama-3.2-90b-vision-preview`.
- Kiểm tra định dạng ảnh (JPG, PNG, WEBP) và dung lượng < 10 MB.

---

## 📊 Tính năng nổi bật

- **Phân tích thời tiết thực tế** (hoặc mô phỏng)
- **Đánh giá nguy cơ bệnh hại** dựa trên Knowledge Base
- **Tư vấn kinh tế** – thiệt hại năng suất, chi phí xử lý, ROI
- **Nhận diện bệnh từ ảnh** bằng Groq Vision
- **Mô phỏng Zalo Alert** – tin nhắn cảnh báo trực quan

---

## 🧩 Mở rộng

Bạn có thể dễ dàng mở rộng ứng dụng:

- Thêm nhiều bệnh hơn vào `diseases.json`
- Tích hợp dữ liệu vệ tinh hoặc cảm biến IoT
- Kết nối với hệ thống khuyến nông thực tế
- Chuyển đổi sang giao diện di động

---

*🌾 MÙA VÀNG AGENT – Hackathon AI for Agriculture – Vì một nền nông nghiệp Tây Nguyên thịnh vượng*