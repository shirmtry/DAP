# REFLECTION.md - TÀI LIỆU PHẢN TƯ KỸ THUẬT (TECHNICAL REFLECTION)

* **Dự án:** AIDEV - AI Agent Trợ Lý Nông Nghiệp
* **Repository:** [github.com/shirmtry/AIDEV](https://github.com/shirmtry/AIDEV)
* **Sự kiện:** Chung kết Hackathon AIDEV Summer 2026
* **Nguyên tắc cốt lõi:** Chu trình tự chủ khép kín (*Act → Observe → Re-plan*) & Khẳng định tuyệt đối: *Real Data is King* (Không sử dụng dữ liệu giả lập).

---

## 1. THÁCH THỨC KỸ THUẬT LỚN NHẤT & GIẢI PHÁP TRONG 8 GIỜ SPRINT

Trong 8 tiếng bứt tốc, rào cản nghiêm trọng nhất của nhóm là hiện tượng **Vòng lặp vô hạn (Infinite Loop)** và **Ảo giác hành động (Action Hallucination)** của Agent. Do hệ thống bắt buộc phải lấy dữ liệu thời gian thực (Real-time Data) phục vụ nông dân, các Custom Tools cào dữ liệu (được viết bằng *Playwright* và *BeautifulSoup*) thường xuyên phải đối mặt với tình trạng nhiễu tín hiệu: thay đổi cấu trúc DOM đột xuất từ trang nguồn (nhabeagri.com), lỗi nghẽn mạng cục bộ hoặc OpenWeather API bị quá tải timeout.

Khi một công cụ trả về kết quả rác hoặc Exception thô, Agent (sử dụng Groq Llama-3.3 70B) bị mất phương hướng. Nó liên tục gọi lại chính công cụ đó với hy vọng nhận được kết quả đúng (Infinite Loop) hoặc tự bịa ra một tham số không tồn tại để cố chấp thực thi (Action Hallucination), gây cạn kiệt tài nguyên Token và treo hệ thống.

**Giải pháp khắc phục thực chiến:**

1. **Cấu hình Ngắt Ngưỡng Cứng (Hard Limit):** Thiết lập tham số cấu hình nghiêm ngặt `max_iterations=5` cho Agent Executor, ép buộc hệ thống phải dừng suy nghĩ và trả quyền kiểm soát về nếu vượt quá giới hạn bước chạy mà không hội tụ được kết quả.

2. **Xây dựng Ngữ nghĩa hóa Ngoại lệ (Semantic Error Wrapper):** Nhóm đã triển khai một hàm bọc (wrapper) trung gian cho toàn bộ các Custom Tools. Thay vì ném ra một Exception hệ thống thô (ví dụ: `TimeoutError`), hàm wrapper sẽ bắt ngoại lệ và chuẩn hóa thành một chuỗi văn bản thuần túy có cấu trúc ngữ nghĩa cao:

```json
{
  "status": "error",
  "source": "Market_Price_Scraper",
  "reason": "DOM_STRUCTURE_CHANGED_OR_NETWORK_TIMEOUT",
  "suggestion": "The target website is temporarily unreachable. Do NOT retry this tool. Pivot immediately to Local_DB_Cache to get the latest offline data."
}
```

Nhờ cấu trúc văn bản giàu ngữ nghĩa này, ở bước **Observe**, Agent đọc hiểu hoàn toàn bản chất sự cố và thực hiện bước **Re-plan** chuẩn xác: Chuyển hướng luồng tư duy sang gọi Tool truy vấn `Local_DB_Cache` thay vì tiếp tục cào lại, giúp hệ thống tự chữa lành (**Self-healing**) thành công mà không bị crash.

---

## 2. LỘ TRÌNH NÂNG CẤP HẠ TẦNG KỸ THUẬT TRONG 1 TUẦN (SCALE-UP ROADMAP)

Nếu có thêm 1 tuần để tối ưu hóa và đưa dự án ra thực địa, nhóm sẽ tập trung giải quyết bài toán chịu tải và tối ưu hóa trải nghiệm thông qua 3 hạ tầng cốt lõi:

**Tích hợp Bộ nhớ dài hạn (Long-term Memory) qua Vector Database:** Hiện tại, hệ thống mới chỉ sử dụng bộ nhớ ngắn hạn dạng cửa sổ trượt (Memory Buffer), khiến thông tin về hồ sơ nông trại, lịch sử dịch bệnh của người dùng bị xóa sạch sau phiên chạy. Nhóm sẽ tích hợp ChromaDB (hoặc Pinecone) để lưu trữ toàn bộ lịch sử tương tác dưới dạng Vector Embeddings. Hệ thống sẽ truy vấn ngữ cảnh cũ dựa trên ID người dùng, cung cấp giải pháp cá nhân hóa sâu sắc theo từng mùa vụ mà không làm phình to cửa sổ Token Context.

**Chuyển đổi sang Kiến trúc Bất đồng bộ (AsyncIO) & Container hóa (Docker):** Toàn bộ pipeline hiện tại đang chạy đồng bộ (Synchronous), tạo ra nút thắt cổ chai lớn khi Agent phải chờ đợi Scraper phản hồi. Việc tái cấu trúc sang mã nguồn bất đồng bộ (`asyncio` phối hợp với `playwright.async_api` và `httpx`) sẽ cho phép Agent xử lý song song nhiều luồng dữ liệu (vừa kiểm tra giá, vừa phân tích ảnh Vision dịch bệnh). Đồng thời, đóng gói toàn bộ hệ thống bằng Docker để sẵn sàng triển khai scale-up tự động trên Kubernetes khi lượng truy cập từ nông dân Gia Lai và Bình Định tăng cao.

**Phát triển Trang giám sát suy nghĩ thời gian thực (Agent Thought Dashboard):** Nâng cao tính minh bạch (Explainable AI) bằng cách xây dựng một Dashboard bằng Streamlit/React, trực quan hóa cây quyết định và luồng suy nghĩ của Agent dựa trên đồ thị động. Ban giám khảo hoặc kỹ thuật viên có thể nhìn thấy trực tiếp Agent đang ở bước nào trong chu trình *Act → Observe → Re-plan*, công cụ nào đang được gọi và phân tích logic tại chỗ của LLM.

---

## 3. BÀI HỌC KỸ THUẬT LỚN NHẤT RÚT RA TỪ SPRINT

**Tầm quan trọng của Kiểm thử Độc lập (Modular Isolation Testing):** Bài học xương máu của nhóm là không bao giờ được ráp một Custom Tool chưa qua kiểm thử vào Pipeline của Agent. Ở những tiếng đầu tiên, việc debug cực kỳ hỗn loạn vì không thể phân biệt được Agent chạy sai là do cấu trúc Prompt định hướng kém hay do logic Code bên trong Tool bị lỗi. Việc thiết lập các kịch bản Unit Test độc lập, ép chuẩn đầu ra 100% cho từng Tool trước khi bàn giao cho Agent là nguyên tắc bắt buộc để cô lập lỗi.

**Triết lý "Real Data is King":** Việc lựa chọn đối đầu trực diện với dữ liệu thực tế đầy biến động ngay từ vạch xuất phát – thay vì né tránh bằng cách sử dụng Mock Data sạch sẽ – chính là bước ngoặt. Dữ liệu nhiễu đã ép nhóm phải từ bỏ tư duy lập trình lý thuyết để chuyển sang **Lập trình phòng thủ (Defensive Programming)**. Sự bền bỉ của một AI Agent thực chiến không nằm ở việc cấu hình Prompt phức tạp, mà nằm ở khả năng xử lý ngoại lệ chặt chẽ khi va chạm với thế giới thực. Đây chính là yếu tố cốt lõi tạo nên khoảng cách xa giữa sản phẩm của AIDEV và các đồ án lý thuyết thuần túy.