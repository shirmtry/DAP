import os
import requests
import logging

logger = logging.getLogger(__name__)

def send_telegram_message(chat_id, text):
    """
    Gửi tin nhắn qua Telegram Bot.
    Yêu cầu biến môi trường: TELEGRAM_BOT_TOKEN
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN chưa được cấu hình trong .env")
        return "⚠️ Không thể gửi tin nhắn Telegram: thiếu token."

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            return f"✅ Đã gửi báo cáo đến Telegram chat {chat_id}"
        else:
            error_detail = response.json() if response.text else "Không có chi tiết"
            logger.error(f"Telegram API lỗi: {response.status_code} - {error_detail}")
            return f"❌ Lỗi gửi Telegram: {response.status_code} - {error_detail}"
    except Exception as e:
        logger.error(f"Lỗi kết nối Telegram: {e}")
        return f"❌ Lỗi kết nối Telegram: {str(e)}"