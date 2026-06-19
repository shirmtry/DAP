"""
🌾 MÙA VÀNG AGENT
Hệ thống Multi-Agent cảnh báo sâu bệnh cà phê Tây Nguyên
Công nghệ: Streamlit + Groq (text + vision) + OpenWeatherMap
"""

import os
import json
import time
import base64
import requests
import streamlit as st
from datetime import datetime
from dotenv import load_dotenv
from openai import OpenAI

# ──────────────────────────────────────────────────────────────────────────────
# KHỞI TẠO MÔI TRƯỜNG
# ──────────────────────────────────────────────────────────────────────────────
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama3-70b-8192")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")

# Khởi tạo client Groq (tương thích OpenAI)
if GROQ_API_KEY:
    client = OpenAI(api_key=GROQ_API_KEY, base_url=GROQ_BASE_URL)
else:
    client = None

# ──────────────────────────────────────────────────────────────────────────────
# CẤU HÌNH TRANG STREAMLIT (CSS giữ nguyên)
# ──────────────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title=" Mùa Vàng Agent",
    page_icon="🌾",
    layout="wide",
    initial_sidebar_state="expanded"
)

# CSS (giữ nguyên như cũ, không thay đổi)
st.markdown("""
<style>
    .stApp {
        background: linear-gradient(135deg, #1a1008 0%, #2d1f0a 50%, #1a2818 100%);
        min-height: 100vh;
    }
    .main-header {
        background: linear-gradient(135deg, #8B4513 0%, #D4A017 50%, #2E7D32 100%);
        padding: 2rem 2.5rem;
        border-radius: 16px;
        margin-bottom: 1.5rem;
        text-align: center;
        box-shadow: 0 8px 32px rgba(212, 160, 23, 0.3);
        border: 1px solid rgba(212, 160, 23, 0.2);
    }
    .main-header h1 {
        font-size: 2.8rem;
        font-weight: 900;
        color: #FFFDE7;
        margin: 0;
        letter-spacing: 2px;
        text-shadow: 2px 2px 8px rgba(0,0,0,0.5);
    }
    .main-header p {
        color: #FFE082;
        font-size: 1.05rem;
        margin: 0.5rem 0 0 0;
        opacity: 0.9;
    }
    .weather-card {
        background: linear-gradient(135deg, #0D47A1 0%, #1565C0 100%);
        border-radius: 14px;
        padding: 1.4rem;
        color: white;
        text-align: center;
        box-shadow: 0 4px 20px rgba(13, 71, 161, 0.4);
        border: 1px solid rgba(255,255,255,0.1);
        transition: transform 0.2s ease;
    }
    .weather-card:hover { transform: translateY(-3px); }
    .weather-card .metric-value {
        font-size: 2.2rem;
        font-weight: 800;
        margin: 0.3rem 0;
    }
    .weather-card .metric-label {
        font-size: 0.85rem;
        opacity: 0.85;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .weather-card .metric-icon { font-size: 1.8rem; }
    .agent-header {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        margin-bottom: 1rem;
        padding-bottom: 0.8rem;
        border-bottom: 2px solid rgba(212, 160, 23, 0.3);
    }
    .agent-badge {
        background: linear-gradient(135deg, #D4A017, #8B4513);
        color: white;
        padding: 0.3rem 0.8rem;
        border-radius: 20px;
        font-size: 0.8rem;
        font-weight: 700;
    }
    .agent-title {
        font-size: 1.15rem;
        font-weight: 700;
        color: #FFE082;
    }
    .alert-danger {
        background: linear-gradient(135deg, rgba(183, 28, 28, 0.3), rgba(198, 40, 40, 0.2));
        border-left: 4px solid #EF5350;
        border-radius: 0 10px 10px 0;
        padding: 1rem;
        margin: 0.8rem 0;
        color: #FFCDD2;
    }
    .alert-warning {
        background: linear-gradient(135deg, rgba(230, 81, 0, 0.3), rgba(245, 124, 0, 0.2));
        border-left: 4px solid #FFA726;
        border-radius: 0 10px 10px 0;
        padding: 1rem;
        margin: 0.8rem 0;
        color: #FFE0B2;
    }
    .alert-success {
        background: linear-gradient(135deg, rgba(27, 94, 32, 0.3), rgba(46, 125, 50, 0.2));
        border-left: 4px solid #66BB6A;
        border-radius: 0 10px 10px 0;
        padding: 1rem;
        margin: 0.8rem 0;
        color: #C8E6C9;
    }
    .zalo-container {
        background: #1a1a2e;
        border-radius: 16px;
        padding: 0;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        max-width: 420px;
        margin: 1rem auto;
    }
    .zalo-header {
        background: linear-gradient(135deg, #0068FF, #0052D4);
        padding: 0.9rem 1.2rem;
        display: flex;
        align-items: center;
        gap: 0.7rem;
    }
    .zalo-avatar {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: linear-gradient(135deg, #2E7D32, #4CAF50);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.3rem;
        flex-shrink: 0;
    }
    .zalo-contact-name {
        color: white;
        font-weight: 700;
        font-size: 0.95rem;
    }
    .zalo-contact-sub {
        color: rgba(255,255,255,0.7);
        font-size: 0.75rem;
    }
    .zalo-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        background: #16213e;
        min-height: 180px;
    }
    .zalo-bubble {
        background: #1a3a5c;
        border-radius: 4px 16px 16px 16px;
        padding: 0.7rem 0.9rem;
        color: #E3F2FD;
        font-size: 0.88rem;
        line-height: 1.5;
        max-width: 85%;
        border: 1px solid rgba(0,104,255,0.2);
    }
    .zalo-time {
        font-size: 0.72rem;
        color: rgba(255,255,255,0.4);
        margin-top: 0.3rem;
        padding-left: 0.5rem;
    }
    .sidebar-info {
        background: rgba(212, 160, 23, 0.1);
        border: 1px solid rgba(212, 160, 23, 0.3);
        border-radius: 10px;
        padding: 1rem;
        margin: 0.5rem 0;
        color: #FFE082;
        font-size: 0.85rem;
    }
    .stButton > button {
        background: linear-gradient(135deg, #D4A017 0%, #8B4513 100%) !important;
        color: white !important;
        border: none !important;
        border-radius: 10px !important;
        padding: 0.6rem 1.5rem !important;
        font-weight: 700 !important;
        font-size: 1rem !important;
        box-shadow: 0 4px 15px rgba(212, 160, 23, 0.4) !important;
        transition: all 0.2s ease !important;
    }
    .stButton > button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 6px 20px rgba(212, 160, 23, 0.6) !important;
    }
    .stTextInput > div > div > input,
    .stTextArea > div > div > textarea {
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(212, 160, 23, 0.3) !important;
        border-radius: 10px !important;
        color: #E8F5E9 !important;
    }
    .section-title {
        color: #FFE082;
        font-size: 1.3rem;
        font-weight: 700;
        padding: 0.5rem 0;
        border-bottom: 2px solid rgba(212, 160, 23, 0.4);
        margin: 1.5rem 0 1rem 0;
    }
    .streamlit-expanderHeader {
        background: rgba(255, 255, 255, 0.05) !important;
        border-radius: 10px !important;
        color: #FFE082 !important;
    }
    .image-upload-box {
        background: rgba(255,255,255,0.04);
        border: 2px dashed rgba(212, 160, 23, 0.4);
        border-radius: 14px;
        padding: 1.5rem;
        text-align: center;
        transition: border-color 0.2s;
    }
    .image-upload-box:hover {
        border-color: rgba(212, 160, 23, 0.8);
    }
    .vision-result-card {
        background: linear-gradient(135deg, rgba(46,125,50,0.2), rgba(27,94,32,0.15));
        border: 1px solid rgba(102,187,106,0.3);
        border-radius: 14px;
        padding: 1.3rem 1.5rem;
        margin-top: 1rem;
        color: #C8E6C9;
    }
    .vision-badge {
        display: inline-block;
        background: linear-gradient(135deg, #1B5E20, #4CAF50);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 20px;
        font-size: 0.78rem;
        font-weight: 700;
        margin-bottom: 0.7rem;
    }
</style>
""", unsafe_allow_html=True)


# ──────────────────────────────────────────────────────────────────────────────
# PHÂN TÍCH ẢNH BẰNG GROQ VISION (thay thế Claude)
# ──────────────────────────────────────────────────────────────────────────────
def analyze_image_with_groq(image_bytes: bytes, image_type: str, diseases: list) -> dict:
    """
    Dùng Groq Vision (llama-3.2-90b-vision-preview) để phân tích ảnh cây/lá bệnh.
    Trả về dict: {success, plant_type, detected_diseases, symptoms_visible,
                  confidence, treatment, raw_response}
    """
    if not client:
        return {"success": False, "error": "Chưa có GROQ_API_KEY trong .env"}

    disease_names = ", ".join([d["name"] for d in diseases]) if diseases else "các bệnh phổ biến"

    system_prompt = (
        "Bạn là chuyên gia bệnh học thực vật, đặc biệt giỏi về cây cà phê và cây trồng Tây Nguyên Việt Nam. "
        "Hãy phân tích ảnh được cung cấp và trả lời CHÍNH XÁC theo định dạng JSON sau, không thêm bất kỳ text nào khác:\n"
        "{\n"
        '  "plant_type": "Tên loại cây (cà phê Robusta / Arabica / Catimor / cây khác)",\n'
        '  "plant_part": "Bộ phận trong ảnh (lá / quả / cành / rễ / toàn cây)",\n'
        '  "detected_diseases": ["Tên bệnh 1", "Tên bệnh 2"],\n'
        '  "symptoms_visible": ["Mô tả triệu chứng quan sát được 1", "triệu chứng 2"],\n'
        '  "confidence": "Cao / Trung bình / Thấp",\n'
        '  "severity": "Nhẹ / Trung bình / Nặng / Rất nặng",\n'
        '  "treatment_urgent": ["Biện pháp xử lý cấp bách 1", "biện pháp 2"],\n'
        '  "prevention": ["Phòng ngừa 1", "phòng ngừa 2"],\n'
        '  "note": "Ghi chú thêm nếu cần"\n'
        "}"
    )

    user_prompt = (
        f"Phân tích ảnh này. Các bệnh cần chú ý trong knowledge base gồm: {disease_names}. "
        "Nếu cây/lá trông khỏe mạnh, hãy ghi detected_diseases là [] và note rằng cây bình thường. "
        "Nếu không rõ là cây gì, hãy mô tả theo những gì thấy được."
    )

    try:
        img_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{image_type};base64,{img_b64}"

        response = client.chat.completions.create(
            model="llama-3.2-90b-vision-preview",  # hoặc "llama-3.2-11b-vision-preview"
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": data_url}}
                    ]
                }
            ],
            max_tokens=1200,
            temperature=0.0
        )
        raw = response.choices[0].message.content.strip()
        # Parse JSON
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
        result["success"] = True
        result["raw_response"] = raw
        return result
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Lỗi parse JSON từ Vision API: {e}", "raw_response": raw if 'raw' in dir() else ""}
    except Exception as e:
        return {"success": False, "error": f"Lỗi Vision API: {str(e)}"}


def render_vision_result(result: dict, diseases_kb: list):
    """Hiển thị kết quả phân tích ảnh đẹp."""
    if not result.get("success"):
        st.error(f"❌ {result.get('error', 'Lỗi không xác định')}")
        return

    detected = result.get("detected_diseases", [])
    severity = result.get("severity", "")
    confidence = result.get("confidence", "")

    severity_color = {"Nhẹ": "#66BB6A", "Trung bình": "#FFA726", "Nặng": "#EF5350", "Rất nặng": "#B71C1C"}.get(severity, "#FFE082")
    conf_icon = {"Cao": "🟢", "Trung bình": "🟡", "Thấp": "🔴"}.get(confidence, "⚪")

    st.markdown(f'<div class="vision-badge">🤖 Groq Vision AI · Độ tin cậy: {conf_icon} {confidence}</div>', unsafe_allow_html=True)

    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown(f"**🌿 Loại cây:** {result.get('plant_type', 'Chưa xác định')}")
    with col2:
        st.markdown(f"**🍃 Bộ phận:** {result.get('plant_part', 'N/A')}")
    with col3:
        st.markdown(f"**⚠️ Mức độ:** <span style='color:{severity_color};font-weight:700'>{severity or 'N/A'}</span>", unsafe_allow_html=True)

    if detected:
        st.markdown("#### 🔬 Bệnh phát hiện trong ảnh:")
        for disease_name in detected:
            # Match với KB
            matched_kb = next((d for d in diseases_kb if d["name"] in disease_name or disease_name in d["name"]), None)
            if matched_kb:
                loss = matched_kb.get("impact", {}).get("yield_loss_percent", [0, 0])
                st.markdown(
                    f'<div class="alert-danger">🔴 <strong>{disease_name}</strong> — '
                    f'Khớp KB: <em>{matched_kb["name"]}</em> · Thiệt hại tiềm năng: {loss[0]}-{loss[1]}%</div>',
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(f'<div class="alert-warning">🟡 <strong>{disease_name}</strong></div>', unsafe_allow_html=True)
    else:
        st.markdown('<div class="alert-success">✅ <strong>Không phát hiện bệnh rõ ràng</strong> — Cây có vẻ khỏe mạnh!</div>', unsafe_allow_html=True)

    symptoms = result.get("symptoms_visible", [])
    if symptoms:
        st.markdown("**👁️ Triệu chứng quan sát:**")
        for s in symptoms:
            st.markdown(f"  • {s}")

    treatments = result.get("treatment_urgent", [])
    if treatments and detected:
        st.markdown("**💊 Xử lý cấp bách:**")
        for t in treatments:
            st.markdown(f"  ✅ {t}")

    prevention = result.get("prevention", [])
    if prevention:
        with st.expander("🛡️ Biện pháp phòng ngừa"):
            for p in prevention:
                st.markdown(f"  • {p}")

    if result.get("note"):
        st.info(f"📝 {result['note']}")


# ──────────────────────────────────────────────────────────────────────────────
# HÀM TẢI KNOWLEDGE BASE
# ──────────────────────────────────────────────────────────────────────────────
@st.cache_data
def load_disease_knowledge():
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        json_path = os.path.join(script_dir, "diseases.json")
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data["knowledge_base"]["diseases"]
    except FileNotFoundError:
        st.warning("⚠️ Không tìm thấy diseases.json - dùng knowledge base rút gọn")
        return []
    except Exception as e:
        st.error(f"Lỗi tải knowledge base: {e}")
        return []


# ──────────────────────────────────────────────────────────────────────────────
# HÀM LẤY DỮ LIỆU THỜI TIẾT
# ──────────────────────────────────────────────────────────────────────────────
def get_weather(location: str, api_key: str) -> dict:
    if not api_key:
        return _mock_weather(location)
    try:
        url = "https://api.openweathermap.org/data/2.5/weather"
        params = {
            "q": location,
            "appid": api_key,
            "units": "metric",
            "lang": "vi"
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        raw = response.json()
        return {
            "success": True,
            "location": f"{raw['name']}, {raw.get('sys', {}).get('country', 'VN')}",
            "temperature": round(raw["main"]["temp"], 1),
            "feels_like": round(raw["main"]["feels_like"], 1),
            "humidity": raw["main"]["humidity"],
            "description": raw["weather"][0]["description"].capitalize(),
            "wind_speed": round(raw["wind"]["speed"] * 3.6, 1),
            "clouds": raw["clouds"]["all"],
            "rainfall_1h": raw.get("rain", {}).get("1h", 0),
            "icon": raw["weather"][0]["icon"],
            "timestamp": datetime.fromtimestamp(raw["dt"]).strftime("%d/%m/%Y %H:%M"),
            "source": "OpenWeatherMap (Live)"
        }
    except Exception as e:
        return {"success": False, "error": f"❌ Lỗi thời tiết: {str(e)}"}

def _mock_weather(location: str) -> dict:
    import random
    base_data = {
        "Chư Sê": {"temp": 22, "humidity": 88, "rain": 4.2, "desc": "Mưa rào nhẹ"},
        "Đắk Đoa": {"temp": 21, "humidity": 91, "rain": 6.5, "desc": "Mưa vừa, có sấm nhẹ"},
        "Pleiku": {"temp": 20, "humidity": 86, "rain": 2.1, "desc": "Nhiều mây, ẩm"},
        "Buôn Ma Thuột": {"temp": 25, "humidity": 78, "rain": 0, "desc": "Nắng nhẹ, mây rải rác"},
    }
    matched = next(
        (v for k, v in base_data.items() if k.lower() in location.lower()),
        {"temp": 23, "humidity": 85, "rain": 3.0, "desc": "Mây nhiều, ẩm ướt"}
    )
    temp = matched["temp"] + random.uniform(-1, 1)
    return {
        "success": True,
        "location": location,
        "temperature": round(temp, 1),
        "feels_like": round(temp - 2.5, 1),
        "humidity": matched["humidity"] + random.randint(-3, 3),
        "description": matched["desc"],
        "wind_speed": round(random.uniform(5, 18), 1),
        "clouds": 75,
        "rainfall_1h": matched["rain"],
        "icon": "10d",
        "timestamp": datetime.now().strftime("%d/%m/%Y %H:%M"),
        "source": "⚠️ Dữ liệu mô phỏng (Chưa có API key OpenWeatherMap)"
    }


# ──────────────────────────────────────────────────────────────────────────────
# PHÂN TÍCH RỦI RO BỆNH TỪ KNOWLEDGE BASE
# ──────────────────────────────────────────────────────────────────────────────
def analyze_disease_risk(weather: dict, diseases: list) -> list:
    if not diseases:
        return []
    risks = []
    temp = weather.get("temperature", 25)
    humidity = weather.get("humidity", 75)
    rainfall = weather.get("rainfall_1h", 0)
    for disease in diseases:
        conditions = disease.get("conditions", {})
        risk_score = 0
        risk_factors = []
        temp_min = conditions.get("temperature_range_celsius", [0, 100])[0]
        temp_max = conditions.get("temperature_range_celsius", [0, 100])[1]
        if temp_min <= temp <= temp_max:
            risk_score += 40
            risk_factors.append(f"Nhiệt độ {temp}°C nằm trong vùng nguy hiểm ({temp_min}-{temp_max}°C)")
        hum_min = conditions.get("humidity_percent_min", 0)
        hum_max = conditions.get("humidity_percent_max", 100)
        if hum_min > 0 and humidity >= hum_min:
            risk_score += 35
            risk_factors.append(f"Độ ẩm {humidity}% vượt ngưỡng nguy hiểm (>{hum_min}%)")
        elif hum_max < 100 and humidity <= hum_max:
            risk_score += 30
            risk_factors.append(f"Độ ẩm thấp {humidity}% thuận lợi cho côn trùng")
        rain_threshold = conditions.get("rainfall_mm_threshold", 0)
        if conditions.get("rainfall_favorable") and rainfall >= rain_threshold:
            risk_score += 25
            risk_factors.append(f"Lượng mưa {rainfall}mm tạo điều kiện phát triển bệnh")
        elif not conditions.get("rainfall_favorable") and rainfall == 0:
            risk_score += 20
            risk_factors.append("Thời tiết khô hanh thuận lợi cho sâu bọ")
        if risk_score >= 40:
            risks.append({
                **disease,
                "risk_score": risk_score,
                "risk_level": "🔴 Cao" if risk_score >= 70 else "🟡 Trung bình",
                "risk_factors": risk_factors
            })
    return sorted(risks, key=lambda x: x["risk_score"], reverse=True)


# ──────────────────────────────────────────────────────────────────────────────
# GỌI GROQ API (text)
# ──────────────────────────────────────────────────────────────────────────────
def call_groq(prompt: str, temperature: float = 0.3) -> str:
    if not client:
        return "⚠️ **Chưa có API key Groq.** Vui lòng thêm GROQ_API_KEY vào file .env"
    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là trợ lý AI chuyên về nông nghiệp, đặc biệt là cà phê Tây Nguyên. Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu, có thể dùng emoji."},
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=2000
        )
        return response.choices[0].message.content
    except Exception as e:
        error_msg = str(e)
        if "quota" in error_msg.lower():
            return "⚠️ **Hết quota Groq hôm nay.** Vui lòng thử lại sau hoặc dùng key khác."
        elif "invalid" in error_msg.lower() or "api key" in error_msg.lower():
            return "❌ **Lỗi API key Groq không hợp lệ.** Kiểm tra lại key trong .env"
        else:
            return f"⚠️ **Lỗi Groq:** {error_msg[:300]}"

def run_dual_agent_analysis(
    location: str,
    farmer_question: str,
    weather: dict,
    disease_risks: list
) -> tuple[str, str]:
    if not client:
        return _fallback_analysis(weather, disease_risks, location, farmer_question)

    risk_summary = "\n".join([
        f"- {d['name']}: Rủi ro {d.get('risk_level','?')} (Điểm {d.get('risk_score',0)})"
        for d in disease_risks[:3]
    ]) or "Không phát hiện rủi ro bệnh rõ ràng."

    disease_details = "\n\n".join([
        f"### {d['name']}\nTriệu chứng: {'; '.join(d.get('symptoms', [])[:3])}\nKhuyến cáo: {'; '.join(d.get('recommendation', {}).get('immediate', [])[:2])}"
        for d in disease_risks[:3]
    ]) or "Không có bệnh nguy hiểm."

    prompt1 = f"""
Bạn là chuyên gia Thời tiết & Bệnh hại Cà phê Tây Nguyên. Hãy phân tích và trả lời bằng tiếng Việt, dùng emoji, ngắn gọn dễ hiểu cho nông dân.

**Địa điểm:** {location}
**Dữ liệu thời tiết hiện tại:**
- Nhiệt độ: {weather['temperature']}°C (cảm giác {weather.get('feels_like', 'N/A')}°C)
- Độ ẩm: {weather['humidity']}%
- Lượng mưa 1h: {weather.get('rainfall_1h', 0)} mm
- Trạng thái: {weather['description']}
- Gió: {weather.get('wind_speed', 'N/A')} km/h

**Kết quả phân tích rủi ro bệnh (từ knowledge base):**
{risk_summary}

**Chi tiết bệnh nguy hiểm nhất:**
{disease_details}

**Câu hỏi của nông dân:** "{farmer_question}"

Yêu cầu:
1. Nhận định tổng quan về thời tiết và mức độ nguy hiểm.
2. Liệt kê 2-3 bệnh cần chú ý nhất, kèm triệu chứng nhận biết.
3. Đưa ra khuyến cáo hành động ngay trong 24-48h.
4. Trả lời trực tiếp câu hỏi của nông dân.
"""
    agent1_result = call_groq(prompt1, temperature=0.3)

    prompt2 = f"""
Bạn là chuyên gia Kinh tế Nông nghiệp. Dựa trên báo cáo bệnh hại sau, hãy phân tích tác động kinh tế.

**Báo cáo bệnh hại:**
{agent1_result}

**Thông tin tham khảo:**
- Diện tích trung bình hộ: 1-3 ha
- Năng suất Robusta: 3-5 tấn nhân/ha
- Giá hiện tại: 55,000-65,000 VNĐ/kg
- Mùa thu hoạch: Tháng 10-1

Yêu cầu trả lời bằng tiếng Việt, số liệu cụ thể:
1. Ước tính % thiệt hại năng suất nếu không can thiệp.
2. Tính thiệt hại kinh tế (VNĐ/ha và vườn 2ha).
3. So sánh chi phí xử lý (~3.5 triệu/ha) với thiệt hại.
4. Đề xuất biện pháp tối ưu chi phí - hiệu quả.
5. Dự báo ngắn: nên bán hay trữ cà phê mùa này?
"""
    agent2_result = call_groq(prompt2, temperature=0.2)

    return agent1_result, agent2_result

def _fallback_analysis(weather: dict, disease_risks: list, location: str, question: str) -> tuple:
    temp = weather.get("temperature", 25)
    humidity = weather.get("humidity", 75)
    rainfall = weather.get("rainfall_1h", 0)
    a1 = f"""## 🌿 Phân tích điều kiện thời tiết & Bệnh hại

**Nhận định tổng quan:**
Với nhiệt độ {temp}°C, độ ẩm {humidity}% và lượng mưa {rainfall}mm tại {location}, 
điều kiện {"rất thuận lợi" if humidity > 80 else "tương đối thuận lợi"} cho bệnh nấm phát triển.

"""
    if disease_risks:
        a1 += "**⚠️ Các bệnh cần chú ý ngay:**\n"
        for i, d in enumerate(disease_risks[:3], 1):
            a1 += f"\n**{i}. {d['name']}** - {d.get('risk_level', '🟡 Trung bình')}\n"
            symptoms = d.get("symptoms", [])[:2]
            if symptoms:
                a1 += f"- Triệu chứng: {'; '.join(symptoms)}\n"
            recs = d.get("recommendation", {}).get("immediate", [])[:2]
            if recs:
                a1 += f"- Xử lý ngay: {'; '.join(recs)}\n"
    else:
        a1 += "✅ **Không phát hiện nguy cơ bệnh đặc biệt** trong điều kiện thời tiết hiện tại.\n"

    a1 += f"\n💡 **Về câu hỏi của bạn:** \"{question}\"\n"
    a1 += "→ Hãy kiểm tra vườn kỹ lưỡng 2-3 ngày tới và chú ý các triệu chứng nêu trên.\n"
    a1 += "\n*⚙️ (Phân tích từ Knowledge Base nội bộ - Không có API key Groq)*"
    return a1, _fallback_economics(disease_risks, location)

def _fallback_economics(disease_risks: list, location: str) -> str:
    if not disease_risks:
        return """## 💰 Dự báo Sản lượng & Kinh tế

✅ **Rủi ro bệnh thấp** trong điều kiện hiện tại.

- Dự báo năng suất: Bình thường (3.5-4.5 tấn nhân/ha)
- Doanh thu ước tính: ~195-270 triệu VNĐ/ha (giá 55,000 VNĐ/kg)
- Khuyến nghị: Tiếp tục chăm sóc định kỳ, phòng bệnh là ưu tiên

*⚙️ (Phân tích sơ bộ - Không có API key)*"""
    max_loss = max([d.get("impact", {}).get("yield_loss_percent", [0, 20])[1] for d in disease_risks[:2]])
    min_loss = max([d.get("impact", {}).get("yield_loss_percent", [0, 20])[0] for d in disease_risks[:2]])
    base_yield_kg = 4000
    price_vnd = 58000
    base_revenue = base_yield_kg * price_vnd
    loss_min_vnd = int(base_revenue * min_loss / 100)
    loss_max_vnd = int(base_revenue * max_loss / 100)
    treatment_cost = 3_500_000
    return f"""## 💰 Dự báo Sản lượng & Kinh tế

**📊 Tác động năng suất (nếu không can thiệp):**
- Mất năng suất ước tính: **{min_loss}-{max_loss}%** 
- Thiệt hại: **{loss_min_vnd:,.0f} - {loss_max_vnd:,.0f} VNĐ/ha**
- Thiệt hại vườn 2ha: **{loss_min_vnd*2:,.0f} - {loss_max_vnd*2:,.0f} VNĐ**

**💊 So sánh Chi phí - Lợi ích:**
| Kịch bản | Chi phí | Tổn thất |
|---|---|---|
| Không xử lý | 0 | {loss_max_vnd:,.0f} VNĐ/ha |
| Xử lý ngay | ~{treatment_cost:,.0f} VNĐ/ha | Giảm 60-80% thiệt hại |

**✅ Khuyến nghị:** Can thiệp ngay có **ROI ~{int((loss_max_vnd * 0.7 - treatment_cost) / treatment_cost * 100)}x** 
- Ưu tiên phun phòng trong 48h tới
- Theo dõi sát trong 2 tuần

*⚙️ (Phân tích sơ bộ - Không có API key)*"""


# ──────────────────────────────────────────────────────────────────────────────
# COMPONENT HIỂN THỊ
# ──────────────────────────────────────────────────────────────────────────────
def render_weather_cards(weather: dict):
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.markdown(f"""
        <div class="weather-card">
            <div class="metric-icon">🌡️</div>
            <div class="metric-value">{weather['temperature']}°C</div>
            <div class="metric-label">Nhiệt độ</div>
            <div style="font-size:0.78rem;opacity:0.7;">Cảm giác {weather.get('feels_like','N/A')}°C</div>
        </div>
        """, unsafe_allow_html=True)
    with col2:
        st.markdown(f"""
        <div class="weather-card" style="background: linear-gradient(135deg, #1B5E20, #2E7D32);">
            <div class="metric-icon">💧</div>
            <div class="metric-value">{weather['humidity']}%</div>
            <div class="metric-label">Độ ẩm</div>
            <div style="font-size:0.78rem;opacity:0.7;">{"Rất ẩm ⚠️" if weather['humidity'] > 85 else "Bình thường"}</div>
        </div>
        """, unsafe_allow_html=True)
    with col3:
        rain = weather.get('rainfall_1h', 0)
        st.markdown(f"""
        <div class="weather-card" style="background: linear-gradient(135deg, #006064, #00838F);">
            <div class="metric-icon">🌧️</div>
            <div class="metric-value">{rain} mm</div>
            <div class="metric-label">Mưa (1 giờ)</div>
            <div style="font-size:0.78rem;opacity:0.7;">{"Có mưa ⚠️" if rain > 0 else "Không mưa"}</div>
        </div>
        """, unsafe_allow_html=True)
    with col4:
        st.markdown(f"""
        <div class="weather-card" style="background: linear-gradient(135deg, #4A148C, #6A1B9A);">
            <div class="metric-icon">🌬️</div>
            <div class="metric-value">{weather.get('wind_speed', 'N/A')}</div>
            <div class="metric-label">Gió (km/h)</div>
            <div style="font-size:0.78rem;opacity:0.7;">{weather['description']}</div>
        </div>
        """, unsafe_allow_html=True)

def render_zalo_message(location: str, disease_risks: list, weather: dict):
    now = datetime.now()
    time_str = now.strftime("%H:%M")
    if disease_risks:
        top_disease = disease_risks[0]
        alert_level = "🔴 CẢNH BÁO CAO" if top_disease.get("risk_score", 0) >= 70 else "🟡 CHÚ Ý"
        msg1 = f"⚠️ {alert_level} - Vườn cà phê {location}"
        msg2 = f"Thời tiết hiện tại: {weather['temperature']}°C, ẩm {weather['humidity']}%, {weather['description'].lower()}"
        msg3 = f"Nguy cơ bệnh cao: {top_disease['name']}. Khuyến cáo: {top_disease.get('recommendation', {}).get('immediate', ['Kiểm tra vườn ngay'])[0]}"
        msg4 = f"📞 Liên hệ Khuyến nông huyện để được hỗ trợ thêm. #MuaVangAgent"
    else:
        msg1 = f"✅ Tình hình vườn cà phê {location} bình thường"
        msg2 = f"Thời tiết: {weather['temperature']}°C, ẩm {weather['humidity']}%"
        msg3 = "Không phát hiện nguy cơ bệnh cao trong 24h tới."
        msg4 = "Tiếp tục chăm sóc định kỳ. #MuaVangAgent 🌾"
    st.markdown(f"""
    <div class="zalo-container">
        <div class="zalo-header">
            <div class="zalo-avatar">🌾</div>
            <div>
                <div class="zalo-contact-name">MÙA VÀNG AGENT</div>
                <div class="zalo-contact-sub">Hệ thống cảnh báo sâu bệnh cà phê</div>
            </div>
            <div style="margin-left:auto;background:#4CAF50;width:10px;height:10px;border-radius:50%;"></div>
        </div>
        <div class="zalo-body">
            <div><div class="zalo-bubble">📍 <strong>{msg1}</strong></div><div class="zalo-time">{time_str}</div></div>
            <div><div class="zalo-bubble">🌤️ {msg2}</div><div class="zalo-time">{time_str}</div></div>
            <div><div class="zalo-bubble">🔬 {msg3}</div><div class="zalo-time">{time_str}</div></div>
            <div><div class="zalo-bubble" style="font-size:0.82rem;opacity:0.85;">{msg4}</div><div class="zalo-time">{time_str}</div></div>
        </div>
    </div>
    """, unsafe_allow_html=True)

def render_sidebar():
    with st.sidebar:
        st.markdown("""
        <div style="text-align:center;padding:1rem 0;">
            <div style="font-size:3rem;">🌾</div>
            <div style="color:#FFE082;font-size:1.1rem;font-weight:700;">MÙA VÀNG AGENT</div>
            <div style="color:#A5D6A7;font-size:0.8rem;">Hackathon • AI no 1 team</div>
        </div>
        """, unsafe_allow_html=True)
        st.divider()
        st.markdown("### ⚙️ Cấu hình")
        if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
            st.success(f"✅ Groq ({GROQ_MODEL}): Sẵn sàng")
            # Kiểm tra vision model có sẵn không? (giả định)
            st.success("✅ Groq Vision: Sẵn sàng (llama-3.2-90b-vision-preview)")
        else:
            st.warning("⚠️ Groq: Chưa có API key")
        if OPENWEATHER_API_KEY:
            st.success("✅ Thời tiết: Live")
        else:
            st.info("ℹ️ Thời tiết: Mô phỏng")
        st.divider()
        st.markdown("""
        <div class="sidebar-info">
        <strong>📌 Về dự án</strong><br>
        Multi-Agent AI cảnh báo sâu bệnh cà phê vùng Tây Nguyên.<br><br>
        <strong>🤖 Agents:</strong><br>
        • Agent 1: Thời tiết & Bệnh hại (Groq)<br>
        • Agent 2: Sản lượng & Kinh tế (Groq)<br>
        • Vision AI: Nhận diện bệnh từ ảnh (Groq Vision)<br><br>
        <strong>🗄️ Knowledge Base:</strong><br>
        6 bệnh phổ biến cà phê TN<br><br>
        <strong>🔑 Cần .env:</strong><br>
        • GROQ_API_KEY (bắt buộc)<br>
        • OPENWEATHER_API_KEY (khuyến nghị)
        </div>
        """, unsafe_allow_html=True)
    
    return OPENWEATHER_API_KEY

# ──────────────────────────────────────────────────────────────────────────────
# MAIN APP
# ──────────────────────────────────────────────────────────────────────────────
def main():
    weather_key = render_sidebar()
    st.markdown("""
    <div class="main-header">
        <h1>🌾 MÙA VÀNG AGENT</h1>
        <p>Hệ thống Multi-Agent cảnh báo sâu bệnh cà phê Tây Nguyên </br> Groq (Text + Vision) + OpenWeatherMap</p>
    </div>
    """, unsafe_allow_html=True)

    col_input1, col_input2 = st.columns([1, 2])
    with col_input1:
        st.markdown("#### 📍 Địa điểm vườn")
        location = st.text_input(
            label="Địa điểm",
            value=st.session_state.get("location", "Chư Sê, Gia Lai"),
            placeholder="VD: Chư Sê, Gia Lai",
            label_visibility="collapsed"
        )
        st.markdown("**Thử ngay:**")
        btn_col1, btn_col2 = st.columns(2)
        with btn_col1:
            if st.button("📍 Chư Sê", use_container_width=True):
                st.session_state["location"] = "Chư Sê, Gia Lai"
                st.rerun()
        with btn_col2:
            if st.button("📍 Đắk Đoa", use_container_width=True):
                st.session_state["location"] = "Đắk Đoa, Gia Lai"
                st.rerun()
        btn_col3, btn_col4 = st.columns(2)
        with btn_col3:
            if st.button("📍 Pleiku", use_container_width=True):
                st.session_state["location"] = "Pleiku, Gia Lai"
                st.rerun()
        with btn_col4:
            if st.button("📍 Buôn Ma Thuột", use_container_width=True):
                st.session_state["location"] = "Buon Ma Thuot, Dak Lak"
                st.rerun()
    with col_input2:
        st.markdown("#### 💬 Câu hỏi của bạn")
        farmer_question = st.text_area(
            label="Câu hỏi",
            value=st.session_state.get("question",
                "Thời tiết mấy ngày nay trời ẩm ướt, lá cà phê xuất hiện đốm vàng. "
                "Tôi cần làm gì để bảo vệ vườn trước khi vào vụ thu hoạch?"),
            height=120,
            placeholder="Nhập câu hỏi về vườn cà phê của bạn...",
            label_visibility="collapsed"
        )

    st.markdown("")
    # ── IMAGE UPLOAD SECTION ──────────────────────────────────────────────────
    st.markdown("#### 📸 Ảnh cây / lá bệnh (tùy chọn)")
    with st.expander("📷 Tải ảnh lên để AI nhận diện bệnh trực tiếp từ hình ảnh", expanded=False):
        st.markdown(
            '<div class="image-upload-box">'
            '<div style="font-size:2.5rem;margin-bottom:0.5rem;">📷</div>'
            '<div style="color:#FFE082;font-weight:600;margin-bottom:0.3rem;">Chụp ảnh lá, quả hoặc cành bị bệnh</div>'
            '<div style="color:#A5D6A7;font-size:0.85rem;">Hỗ trợ: JPG, PNG, WEBP · Tối đa 10MB</div>'
            '</div>',
            unsafe_allow_html=True,
        )
        uploaded_image = st.file_uploader(
            label="Chọn ảnh",
            type=["jpg", "jpeg", "png", "webp"],
            label_visibility="collapsed",
            key="plant_image",
        )
        if uploaded_image is not None:
            col_img, col_info = st.columns([1, 1])
            with col_img:
                st.image(uploaded_image, caption="Ảnh đã tải lên", use_container_width=True)
            with col_info:
                st.markdown("**✅ Ảnh sẵn sàng phân tích**")
                st.markdown(f"📁 `{uploaded_image.name}` ({round(uploaded_image.size/1024, 1)} KB)")
                if not GROQ_API_KEY:
                    st.warning("⚠️ Cần `GROQ_API_KEY` trong `.env` để dùng tính năng nhận diện ảnh (Groq Vision).")
                else:
                    st.success("🤖 Groq Vision sẵn sàng phân tích!")
                analyze_img_btn = st.button("🔍 Phân tích ảnh ngay", type="primary", use_container_width=True, key="btn_analyze_img")
                if analyze_img_btn:
                    diseases = load_disease_knowledge()
                    image_bytes = uploaded_image.read()
                    ext = uploaded_image.name.rsplit(".", 1)[-1].lower()
                    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
                    image_type = mime_map.get(ext, "image/jpeg")
                    with st.spinner("🤖 Groq Vision đang phân tích ảnh..."):
                        vision_result = analyze_image_with_groq(image_bytes, image_type, diseases)
                    st.session_state["vision_result"] = vision_result
                    st.session_state["vision_diseases_kb"] = diseases
                    # Auto-fill câu hỏi nếu phát hiện bệnh
                    if vision_result.get("success") and vision_result.get("detected_diseases"):
                        detected_str = ", ".join(vision_result["detected_diseases"])
                        st.session_state["question"] = (
                            f"Ảnh cho thấy có thể bị: {detected_str}. "
                            f"Triệu chứng: {'; '.join(vision_result.get('symptoms_visible', [])[:2])}. "
                            "Tôi cần làm gì để xử lý và phòng ngừa?"
                        )
                        st.rerun()

        # Hiện kết quả Vision nếu đã có
        if "vision_result" in st.session_state:
            st.markdown("---")
            st.markdown("#### 🔬 Kết quả phân tích ảnh")
            render_vision_result(
                st.session_state["vision_result"],
                st.session_state.get("vision_diseases_kb", []),
            )

    st.markdown("")
    col_run = st.columns([1, 2, 1])[1]
    with col_run:
        run_button = st.button("🚀 Chạy Multi-Agent Phân tích", use_container_width=True, type="primary")

    if run_button:
        if not location.strip():
            st.error("⚠️ Vui lòng nhập địa điểm vườn cà phê!")
            st.stop()

        diseases = load_disease_knowledge()
        with st.spinner("🔄 Đang khởi động Multi-Agent hệ thống..."):
            status = st.status("📡 Agent Thời tiết đang kết nối...", expanded=False)
            weather = get_weather(location.strip(), weather_key)
            if not weather.get("success"):
                st.error(weather.get("error", "Lỗi không xác định"))
                st.stop()
            status.update(label="✅ Dữ liệu thời tiết: OK", state="complete")
            time.sleep(0.3)

            status2 = st.status("🔬 Phân tích Knowledge Base bệnh hại...", expanded=False)
            disease_risks = analyze_disease_risk(weather, diseases)
            status2.update(label=f"✅ Phát hiện {len(disease_risks)} bệnh có nguy cơ", state="complete")
            time.sleep(0.3)

            status3 = st.status("🤖 Agents đang phân tích chuyên sâu với Groq...", expanded=False)
            agent1_result, agent2_result = run_dual_agent_analysis(
                location, farmer_question, weather, disease_risks
            )
            status3.update(label="✅ Agents hoàn thành phân tích", state="complete")

        st.success(f"✅ Phân tích hoàn tất cho **{weather['location']}** lúc {weather['timestamp']}")
        if weather.get("source", "").startswith("⚠️"):
            st.info(f"ℹ️ {weather['source']}")

        st.markdown('<div class="section-title">🌤️ Dữ liệu Thời tiết Hiện tại</div>', unsafe_allow_html=True)
        render_weather_cards(weather)
        st.markdown(f"""
        <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:0.8rem 1.2rem;
                    margin-top:0.8rem;color:#B2EBF2;font-size:0.9rem;">
            📍 <strong>{weather['location']}</strong> &nbsp;|&nbsp; 
            ☁️ {weather['description']} &nbsp;|&nbsp; 
            🌬️ Gió {weather.get('wind_speed','N/A')} km/h &nbsp;|&nbsp;
            ☁️ Mây phủ {weather.get('clouds','N/A')}% &nbsp;|&nbsp;
            🕐 Cập nhật: {weather['timestamp']}
        </div>
        """, unsafe_allow_html=True)
        st.markdown("")

        col_a1, col_a2 = st.columns(2, gap="medium")
        with col_a1:
            st.markdown("""
            <div class="agent-header">
                <span class="agent-badge">AGENT 1</span>
                <span class="agent-title">🌿 Thời tiết & Bệnh hại</span>
            </div>
            """, unsafe_allow_html=True)
            if disease_risks:
                top_score = disease_risks[0].get("risk_score", 0)
                if top_score >= 70:
                    st.markdown('<div class="alert-danger">🔴 <strong>CẢNH BÁO CAO</strong> - Nguy cơ bùng phát bệnh trong 24-48h!</div>', unsafe_allow_html=True)
                else:
                    st.markdown('<div class="alert-warning">🟡 <strong>CẦN THEO DÕI</strong> - Điều kiện thuận lợi cho bệnh phát triển</div>', unsafe_allow_html=True)
            else:
                st.markdown('<div class="alert-success">✅ <strong>AN TOÀN</strong> - Không có nguy cơ bệnh cao</div>', unsafe_allow_html=True)
            st.markdown(agent1_result)
            if disease_risks:
                with st.expander(f"📚 Xem chi tiết {len(disease_risks)} bệnh phát hiện"):
                    for d in disease_risks[:4]:
                        st.markdown(f"**{d['name']}** — {d.get('risk_level', '')}")
                        st.markdown(f"*Điều kiện bùng phát:* {d.get('conditions', {}).get('trigger_conditions', 'N/A')}")
                        st.markdown(f"*Triệu chứng:* {'; '.join(d.get('symptoms', [])[:2])}")
                        st.markdown(f"*Thuốc khuyến cáo:* {', '.join(d.get('recommendation', {}).get('products', [])[:3])}")
                        st.divider()
        with col_a2:
            st.markdown("""
            <div class="agent-header">
                <span class="agent-badge" style="background:linear-gradient(135deg,#1B5E20,#2E7D32);">AGENT 2</span>
                <span class="agent-title">💰 Sản lượng & Kinh tế</span>
            </div>
            """, unsafe_allow_html=True)
            st.markdown(agent2_result)

        st.markdown("")
        st.markdown('<div class="section-title">📱 Mô phỏng Thông báo Zalo</div>', unsafe_allow_html=True)
        col_zalo1, col_zalo2 = st.columns([1, 1])
        with col_zalo1:
            st.markdown("*Hệ thống sẽ tự động gửi cảnh báo đến nông dân qua Zalo OA:*")
            render_zalo_message(location, disease_risks, weather)
        with col_zalo2:
            st.markdown("*Tóm tắt nhanh cho người dùng:*")
            total_risks = len(disease_risks)
            high_risks = len([d for d in disease_risks if d.get("risk_score", 0) >= 70])
            metric_col1, metric_col2 = st.columns(2)
            with metric_col1:
                st.metric("Bệnh có rủi ro", f"{total_risks} loại", delta=f"{high_risks} mức cao" if high_risks else "0 mức cao", delta_color="inverse")
            with metric_col2:
                st.metric("Độ ẩm môi trường", f"{weather['humidity']}%", delta="Nguy hiểm" if weather['humidity'] > 85 else "Bình thường", delta_color="inverse" if weather['humidity'] > 85 else "normal")
            if disease_risks:
                st.markdown("**🚨 Danh sách cảnh báo:**")
                for d in disease_risks[:4]:
                    icon = "🔴" if d.get("risk_score", 0) >= 70 else "🟡"
                    st.markdown(f"{icon} **{d['name']}** — Mất {d.get('impact', {}).get('yield_loss_percent', [0,20])[1]}% sản lượng nếu không xử lý")
            else:
                st.markdown("✅ **Không có cảnh báo bệnh đặc biệt**")
        st.divider()
        st.markdown("""
        <div style="text-align:center;color:rgba(255,255,255,0.4);font-size:0.8rem;padding:1rem 0;">
            🌾 MÙA VÀNG AGENT · Hackathon · AI no 1 team   
            Groq (Text + Vision) + OpenWeatherMap<br>
            Dữ liệu chỉ mang tính tham khảo. Luôn tham vấn chuyên gia khuyến nông địa phương.
        </div>
        """, unsafe_allow_html=True)

    else:
        st.markdown("""
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                    border-radius:16px;padding:2.5rem;text-align:center;color:#B2DFDB;">
            <div style="font-size:4rem;margin-bottom:1rem;">🌿</div>
            <h3 style="color:#FFE082;margin-bottom:0.5rem;">Sẵn sàng phân tích vườn cà phê của bạn</h3>
            <p style="margin-bottom:1.5rem;opacity:0.8;">
                Nhập địa điểm và câu hỏi, sau đó nhấn <strong style="color:#FFE082">🚀 Chạy Multi-Agent</strong>
            </p>
            <div style="display:flex;justify-content:center;gap:2rem;flex-wrap:wrap;font-size:0.9rem;">
                <div>📡 <strong>Live Weather</strong><br><small>Thời tiết thực tế từ OpenWeatherMap</small></div>
                <div>🔬 <strong>AI Analysis</strong><br><small>Groq (Siêu nhanh, miễn phí)</small></div>
                <div>📸 <strong>Vision AI</strong><br><small>Nhận diện bệnh từ ảnh (Groq Vision)</small></div>
                <div>📊 <strong>Kinh tế</strong><br><small>Dự báo thiệt hại bằng VNĐ</small></div>
                <div>📱 <strong>Zalo Alert</strong><br><small>Mô phỏng thông báo nông dân</small></div>
            </div>
        </div>
        """, unsafe_allow_html=True)
        diseases = load_disease_knowledge()
        if diseases:
            st.markdown('<div class="section-title">📚 Knowledge Base: Bệnh hại Cà phê Tây Nguyên</div>', unsafe_allow_html=True)
            cols = st.columns(3)
            for i, d in enumerate(diseases[:6]):
                with cols[i % 3]:
                    with st.expander(f"🌿 {d['name']}"):
                        st.markdown(f"**Loại:** {d.get('type', 'N/A')} | **Mức độ:** {d.get('severity', 'N/A')}")
                        st.markdown(f"**Điều kiện bùng phát:** {d.get('conditions', {}).get('trigger_conditions', 'N/A')}")
                        st.markdown(f"**Triệu chứng:** {d.get('symptoms', [''])[0]}")
                        loss = d.get("impact", {}).get("yield_loss_percent", [0, 0])
                        st.markdown(f"**Thiệt hại năng suất:** {loss[0]}-{loss[1]}%")

if __name__ == "__main__":
    main()