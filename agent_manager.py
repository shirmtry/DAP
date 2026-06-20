import os
import logging
import google.generativeai as genai
from tools.vision_tool import analyze_crop_image
from tools.scraper_tool import fetch_market_price
from tools.weather_tool import get_current_weather
from tools.telegram_tool import send_telegram_message

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CropDecisionAgent:
    def __init__(self):
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        self.model = genai.GenerativeModel('gemini-1.5-flash')  # dùng chung cho tổng hợp
        self.tools = {
            "vision": analyze_crop_image,
            "scraper": fetch_market_price,
            "weather": get_current_weather,
            "telegram": send_telegram_message,
        }

    def _generate_keyword(self, crop_name):
        """Tạo từ khóa tìm kiếm từ tên cây trồng (dùng khi nhập thủ công)."""
        mapping = {
            "lúa": "gao", "cà phê": "ca-phe", "tiêu": "tieu",
            "ngô": "ngo", "đậu": "dau", "mía": "mia",
            "ca cao": "cacao", "điều": "dieu"
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
            "urgency": "Low",
            "market_price": None,
            "weather": None,
        }

        # ----- Bước 1: Xác định cây trồng (Vision hoặc thủ công) -----
        if manual_crop:
            logs.append(f"📝 [Manual] Người dùng nhập tên cây: **{manual_crop}**")
            context["crop_name"] = manual_crop
            context["search_keyword"] = self._generate_keyword(manual_crop)
            context["health"] = "Không rõ (do nhập thủ công)"
            context["symptoms"] = "Không có"
            context["urgency"] = "Low"
        else:
            logs.append("🤖 [Act] Đang phân tích hình ảnh cây trồng...")
            try:
                vision_result = analyze_crop_image(image_bytes)
                if vision_result.get("error"):
                    logs.append(f"❌ [Lỗi Vision] {vision_result.get('message')}. Vui lòng nhập tên cây thủ công.")
                    # Không có dữ liệu, nhưng vẫn tiếp tục với thông tin mặc định
                    context["crop_name"] = "Không xác định"
                    context["search_keyword"] = "nong-san"
                    context["health"] = "Không rõ"
                    context["symptoms"] = "Không có"
                    context["urgency"] = "Low"
                else:
                    context["crop_name"] = vision_result.get("crop_name", "Không xác định")
                    context["search_keyword"] = vision_result.get("search_keyword", "nong-san")
                    context["health"] = vision_result.get("health_status", "Không rõ")
                    context["symptoms"] = vision_result.get("symptoms", "Không có")
                    context["urgency"] = vision_result.get("urgency", "Low")
                    logs.append(f"🔍 [Observe] Phát hiện cây: **{context['crop_name']}** | Trạng thái: **{context['health']}**")
            except Exception as e:
                logs.append(f"❌ [Lỗi Vision] {str(e)}. Vui lòng nhập tên cây thủ công.")
                context["crop_name"] = "Không xác định"
                context["search_keyword"] = "nong-san"
                context["health"] = "Không rõ"
                context["symptoms"] = "Không có"
                context["urgency"] = "Low"

        # ----- Bước 2: Gọi các tool hỗ trợ (Scraper, Weather) -----
        # Tool 1: Scraper
        keyword = context.get("search_keyword", "nong-san")
        logs.append(f"🌐 [Act] Đang cào giá thị trường thực tế cho từ khóa '{keyword}'...")
        try:
            market_data = fetch_market_price(keyword)
            context["market_price"] = market_data
        except Exception as e:
            logs.append(f"⚠️ [Lỗi Scraper] {str(e)}. Agent dùng dữ liệu giá mặc định.")
            context["market_price"] = "Giá thị trường hiện tại: 12,000 VND/kg (dữ liệu tham khảo)"

        # Tool 2: Weather
        logs.append(f"🌤️ [Act] Đang kiểm tra thời tiết thực tế tại khu vực {location}...")
        try:
            weather_data = get_current_weather(location)
            context["weather"] = weather_data
        except Exception as e:
            logs.append(f"⚠️ [Lỗi Weather API] {str(e)}. Agent dùng dữ liệu thời tiết mặc định.")
            context["weather"] = f"Thời tiết tại {location}: Nắng, Nhiệt độ: 32°C (dữ liệu tham khảo)"

        # ----- Bước 3: Tổng hợp và đưa ra khuyến nghị (Re-plan) -----
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
            response = self.model.generate_content(final_prompt)
            if response.candidates:
                final_decision = response.text
            else:
                final_decision = "⚠️ Agent không thể đưa ra khuyến nghị do lỗi từ mô hình. Vui lòng thử lại."
        except Exception as e:
            logs.append(f"❌ [Lỗi Gemini] {str(e)}")
            final_decision = "⚠️ Agent không thể đưa ra khuyến nghị do lỗi hệ thống. Vui lòng thử lại sau."

        # ----- Bước 4: Gửi báo cáo qua Telegram nếu có chat_id -----
        if user_telegram_id:
            report = f"🌾 *Báo cáo nông nghiệp*\n\n{final_decision[:2000]}"
            send_result = send_telegram_message(user_telegram_id, report)
            logs.append(f"📨 {send_result}")

        return final_decision, logs