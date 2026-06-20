import os
import logging
from google import genai
from tools.vision_tool import analyze_crop_image
from tools.scraper_tool import fetch_market_price
from tools.weather_tool import get_current_weather
from tools.telegram_tool import send_telegram_message   # <-- import mới

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CropDecisionAgent:
    def __init__(self):
        self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        # Danh sách tools có sẵn
        self.tools = {
            "vision": analyze_crop_image,
            "scraper": fetch_market_price,
            "weather": get_current_weather,
            "telegram": send_telegram_message,   # <-- thêm tool telegram
        }

    def _generate_keyword(self, crop_name):
        """Tạo từ khóa tìm kiếm từ tên cây trồng (dùng khi nhập thủ công)"""
        mapping = {
            "lúa": "gao",
            "cà phê": "ca-phe",
            "tiêu": "tieu",
            "ngô": "ngo",
            "đậu": "dau",
            "mía": "mia",
            "ca cao": "cacao",
            "điều": "dieu"
        }
        crop_lower = crop_name.lower().strip()
        for key, val in mapping.items():
            if key in crop_lower:
                return val
        return crop_lower.replace(" ", "-")

    def run_workflow(self, image_bytes, location="Gia Lai", manual_crop=None, user_telegram_id=None):
        logs = []
        context = {
            "image_bytes": image_bytes,
            "location": location,
            "manual_crop": manual_crop,
            "user_telegram_id": user_telegram_id,
            "crop_name": None,
            "health": None,
            "symptoms": None,
            "urgency": None,
            "market_price": None,
            "weather": None,
        }

        # --- BƯỚC 1: Xác định thông tin cây trồng (Vision hoặc manual) ---
        if manual_crop:
            logs.append(f"📝 [Manual] Người dùng nhập tên cây: **{manual_crop}**")
            context["crop_name"] = manual_crop
            context["health"] = "Không rõ (do nhập thủ công)"
            context["symptoms"] = "Không có"
            context["urgency"] = "Low"
            keyword = self._generate_keyword(manual_crop)
        else:
            logs.append("🤖 [Act] Đang phân tích hình ảnh cây trồng...")
            try:
                vision_result = analyze_crop_image(image_bytes)
                if vision_result.get("error"):
                    error_msg = f"❌ [Lỗi Vision] {vision_result.get('message', 'Không thể nhận diện')}. Vui lòng nhập tên cây thủ công."
                    logs.append(error_msg)
                    context["crop_name"] = "Không xác định"
                    context["health"] = "Không rõ"
                    context["symptoms"] = "Không có"
                    context["urgency"] = "Low"
                    keyword = "nong-san"
                else:
                    context["crop_name"] = vision_result.get("crop_name", "Không xác định")
                    context["health"] = vision_result.get("health_status", "Không rõ")
                    context["symptoms"] = vision_result.get("symptoms", "Không có")
                    context["urgency"] = vision_result.get("urgency", "Low")
                    keyword = vision_result.get("search_keyword", "nong-san")
                    logs.append(f"🔍 [Observe] Phát hiện cây: **{context['crop_name']}** | Trạng thái: **{context['health']}**")
            except Exception as e:
                error_msg = f"❌ [Lỗi Vision] {str(e)}. Vui lòng nhập tên cây thủ công."
                logs.append(error_msg)
                logger.error(error_msg)
                context["crop_name"] = "Không xác định"
                context["health"] = "Không rõ"
                context["symptoms"] = "Không có"
                context["urgency"] = "Low"
                keyword = "nong-san"

        # --- BƯỚC 2: Gọi các Tool bổ trợ (scraper và weather) ---
        logs.append(f"🌐 [Act] Đang cào giá thị trường thực tế cho từ khóa '{keyword}'...")
        try:
            market_data = fetch_market_price(keyword)
            context["market_price"] = market_data
        except Exception as e:
            error_msg = f"⚠️ [Lỗi Scraper] {str(e)}. Agent tự quyết định sử dụng dữ liệu giá mặc định."
            logs.append(error_msg)
            logger.error(error_msg)
            market_data = "Giá thị trường hiện tại: 12,000 VND/kg (dữ liệu tham khảo)"
            context["market_price"] = market_data

        logs.append(f"🌤️ [Act] Đang kiểm tra thời tiết thực tế tại khu vực {location}...")
        try:
            weather_data = get_current_weather(location)
            context["weather"] = weather_data
        except Exception as e:
            error_msg = f"⚠️ [Lỗi Weather API] {str(e)}. Agent tự quyết định sử dụng dữ liệu thời tiết mặc định."
            logs.append(error_msg)
            logger.error(error_msg)
            weather_data = f"Thời tiết tại {location}: Nắng, Nhiệt độ: 32°C (dữ liệu tham khảo)"
            context["weather"] = weather_data

        # --- BƯỚC 3: RE-PLAN & DECISION (Tổng hợp) ---
        logs.append("🧠 [Re-plan & Brainstorm] Agent đang tổng hợp dữ liệu thực tế để ra quyết định...")
        
        final_prompt = f"""
        Bạn là một Chuyên gia Nông nghiệp AI Agent tại khu vực Miền Trung - Tây Nguyên.
        Hãy dựa trên các thông tin THỰC TẾ thu thập được dưới đây để đưa ra khuyến nghị hành động tối ưu nhất cho người nông dân:
        
        1. Thông tin cây trồng:
           - Loại cây: {context['crop_name']}
           - Sức khỏe: {context['health']}
           - Triệu chứng: {context['symptoms']}
           - Mức độ khẩn cấp: {context['urgency']}
           
        2. Dữ liệu thô từ thị trường vừa cào live: 
        {context['market_price']}
        
        3. Tình hình thời tiết hiện tại:
        {context['weather']}
        
        Yêu cầu cấu trúc phản hồi rõ ràng, bao gồm:
        - **Chẩn đoán tình trạng hiện tại**.
        - **Phân tích biến động giá** và **dự báo thời tiết** ảnh hưởng thế nào đến việc thu hoạch/bán nông sản này.
        - **Khuyến nghị hành động cụ thể** (Cần phun thuốc gì? Có nên bán ngay hay tích trữ? Biện pháp ứng phó thời tiết).
        """

        try:
            response = self.client.models.generate_content(
                model='gemini-2.5-flash',
                contents=final_prompt
            )
            final_decision = response.text
        except Exception as e:
            error_msg = f"❌ [Lỗi Gemini] Không thể tổng hợp khuyến nghị: {str(e)}"
            logs.append(error_msg)
            logger.error(error_msg)
            final_decision = "⚠️ Agent không thể đưa ra khuyến nghị do lỗi hệ thống. Vui lòng thử lại sau."

        # --- BƯỚC 4: HÀNH ĐỘNG – gửi báo cáo Telegram nếu có user_telegram_id ---
        if user_telegram_id:
            report_text = f"🌾 *Báo cáo nông nghiệp*\n\n{final_decision[:2000]}"
            send_result = send_telegram_message(user_telegram_id, report_text)
            logs.append(f"📨 {send_result}")

        return final_decision, logs