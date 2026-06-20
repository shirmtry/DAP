import streamlit as st
import os
from dotenv import load_dotenv
from agent_manager import CropDecisionAgent

load_dotenv()

st.set_page_config(page_title="🌾 AI Agent Giám Sát Nông Nghiệp", layout="wide")
st.title("🌾 Hệ Thống Multi-Agent Giám Sát Nông Sản Real-time")
st.caption("Ứng dụng dành cho khu vực Bình Định - Gia Lai")

with st.sidebar:
    st.header("⚙️ Cấu Hình")
    location = st.selectbox("Chọn địa phương:", ["Gia Lai", "Bình Định"])
    st.markdown("---")
    st.header("🔔 Nhận báo cáo qua Telegram")
    telegram_id = st.text_input("Nhập Telegram Chat ID (để nhận báo cáo tự động)", value="")
    st.caption("Có thể bỏ trống nếu không muốn nhận.")
    st.markdown("---")
    st.caption("AI no 1 Group")

st.subheader("📸 Chụp ảnh hoặc Tải ảnh cây trồng")
img_file = st.camera_input("Chụp hình cây trồng trực tiếp từ thiết bị")
if not img_file:
    img_file = st.file_uploader("Hoặc tải ảnh cây trồng từ máy lên...", type=["jpg", "jpeg", "png"])

if img_file:
    st.image(img_file, caption="Ảnh nông sản đầu vào", width=300)

    with st.expander("✏️ Nhập tên cây trồng thủ công (nếu ảnh không rõ hoặc Vision lỗi)"):
        manual_crop = st.text_input("Tên cây trồng (ví dụ: cà phê, lúa, tiêu):")
        if manual_crop:
            st.success(f"✅ Đã đặt tên cây là: **{manual_crop}** – Agent sẽ ưu tiên sử dụng tên này.")
        else:
            st.info("Để trống để Agent tự nhận diện từ ảnh.")
    
    if st.button("🚀 Kích hoạt AI Agent Phân Tích", type="primary"):
        with st.spinner("Agent đang tự chủ vận hành hệ thống Tool..."):
            image_bytes = img_file.getvalue()
            agent = CropDecisionAgent()
            
            manual_crop_value = manual_crop.strip() if manual_crop else None
            telegram_id_value = telegram_id.strip() if telegram_id.strip() else None

            decision, execution_logs = agent.run_workflow(
                image_bytes,
                location=location,
                manual_crop=manual_crop_value,
                user_telegram_id=telegram_id_value   # thêm tham số này
            )
            
            st.success("✅ Quá trình vận hành của Agent:")
            log_text = "\n".join(execution_logs)
            st.text_area("Nhật ký hoạt động", log_text, height=300, disabled=True)
            
            st.markdown("---")
            st.subheader("💡 Khuyến nghị chiến lược từ Agent:")
            st.markdown(decision)