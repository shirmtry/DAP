import os
import json
import re
import time
import logging
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted, ServiceUnavailable, GoogleAPIError

logger = logging.getLogger(__name__)

def parse_gemini_response(response_text):
    """Trích xuất JSON từ phản hồi của Gemini."""
    try:
        clean_text = re.sub(r'```json\s*|```\s*', '', response_text).strip()
        match = re.search(r'\{.*\}', clean_text, re.DOTALL)
        if match:
            json_str = match.group().replace("'", '"')
            return json.loads(json_str)
    except Exception as e:
        logger.error(f"Parse JSON lỗi: {e}")
    return None

def analyze_crop_image(image_bytes, max_retries=3):
    """
    Phân tích ảnh cây trồng bằng Gemini (có retry khi lỗi).
    Trả về dict với các trường: crop_name, search_keyword, health_status, symptoms, urgency
    hoặc {'error': True, 'message': '...'} nếu thất bại.
    """
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    
    # Danh sách model thử (ưu tiên flash vì nhanh và rẻ)
    models_to_try = ['gemini-1.5-flash', 'gemini-2.0-flash-exp']
    prompt = """
    Phân tích hình ảnh nông nghiệp này và trả về một JSON object duy nhất (không có markdown hay text thừa) với cấu trúc sau:
    {
        "crop_name": "Tên loại cây trồng nhận diện được (Tiếng Việt, có dấu)",
        "search_keyword": "Từ khóa ngắn gọn để tìm giá thị trường (ví dụ: gao, ca-phe, tieu)",
        "health_status": "Tình trạng sức khỏe: 'Khỏe mạnh' hoặc tên bệnh cụ thể",
        "symptoms": "Mô tả ngắn gọn triệu chứng nhìn thấy trên lá/thân/quả",
        "urgency": "'High', 'Medium', hoặc 'Low'"
    }
    """

    for attempt in range(max_retries):
        for model_name in models_to_try:
            try:
                logger.info(f"Gọi Gemini với model {model_name}, lần {attempt+1}")
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(
                    contents=[prompt, image_bytes],
                    generation_config={"temperature": 0.2}
                )
                # Kiểm tra response có hợp lệ không
                if not response.candidates:
                    logger.warning(f"Model {model_name} không trả về candidate, thử model khác...")
                    continue
                result = parse_gemini_response(response.text)
                if result:
                    logger.info(f"Phân tích thành công với {model_name}")
                    return result
                else:
                    logger.warning(f"Response từ {model_name} không parse được")
            except (ResourceExhausted, ServiceUnavailable) as e:
                logger.warning(f"Lỗi tạm thời: {e}, chờ {2**attempt}s rồi thử lại...")
                time.sleep(2 ** attempt)
                break  # thoát vòng lặp model để retry toàn bộ
            except GoogleAPIError as e:
                logger.error(f"Lỗi Google API: {e}")
                if "FAILED_PRECONDITION" in str(e):
                    logger.error("FAILED_PRECONDITION – thử model khác...")
                    continue  # thử model tiếp theo trong danh sách
                else:
                    # Lỗi khác không retry được
                    break
            except Exception as e:
                logger.error(f"Lỗi không xác định: {e}")
                continue
        # Nếu đã thử hết model mà vẫn fail, nghỉ trước khi retry lần tiếp
        if attempt < max_retries - 1:
            time.sleep(2 ** attempt)

    # Fallback cuối cùng
    logger.error("Không thể nhận diện ảnh sau nhiều lần thử.")
    return {
        "error": True,
        "message": "Không thể nhận diện cây trồng từ ảnh. Vui lòng thử lại hoặc nhập tên cây thủ công."
    }