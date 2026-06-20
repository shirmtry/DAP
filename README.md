# 🌾 AI Agent Tư Vấn Nông Nghiệp

Hệ thống AI Agent hỗ trợ nông dân tại Bình Định - Gia Lai đưa ra quyết định canh tác dựa trên dữ liệu thực tế về thị trường, thời tiết và tình trạng cây trồng.

## 🚀 Tính năng
- Nhận diện cây trồng từ ảnh (dùng Groq Vision) hoặc nhập tay.
- Cào giá nông sản từ nhabeagri.com.
- Lấy dữ liệu thời tiết từ OpenWeatherMap.
- Tổng hợp khuyến nghị bằng LLM (Groq).
- Gửi báo cáo qua Telegram (tùy chọn).
- Vòng lặp tự chủ: Act → Observe → Re-plan.

## 🛠️ Cài đặt
1. Tạo file `.env` từ `.env.example` và điền API key.
2. Cài dependencies: `pip install -r requirements.txt`
3. Chạy: `streamlit run app.py`

## 📄 Giấy phép
Dự án mã nguồn mở, phục vụ học tập.

## ✅ Hướng dẫn chạy

1. Cài đặt các thư viện:
   ```
   pip install -r requirements.txt
   ```

2. Tạo file `.env` và thêm các API key:
   - Lấy Groq API key tại https://console.groq.com/keys
   - Lấy OpenWeatherMap key tại https://openweathermap.org/api
   - (Tùy chọn) Tạo Telegram Bot và lấy token.

3. Chạy ứng dụng:
   ```bash
   streamlit run app.py
   ```

4. Mở trình duyệt tại `http://localhost:8501`, nhập tên cây hoặc tải ảnh, nhấn nút để Agent làm việc.

---

