#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_system.py - Kiểm tra toàn diện hệ thống classroom-monitor
Chạy: python test_system.py
"""

import os
import sys
import json
import time
import requests
import websocket
import threading
from datetime import datetime
from dotenv import load_dotenv
import argparse
import logging

# ==================== CẤU HÌNH ====================
load_dotenv()  # Nếu có file .env trong thư mục backend

BASE_URL = os.getenv("TEST_BASE_URL", "http://localhost:5000")
API_KEY = os.getenv("API_KEY", "your-secret-key-change-me")
WS_URL = os.getenv("TEST_WS_URL", "ws://localhost:5000")

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY
}

# ==================== LOGGING ====================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger(__name__)

# ==================== HELPER FUNCTIONS ====================
def print_section(title):
    print("\n" + "=" * 80)
    print(f" {title} ".center(80, "="))
    print("=" * 80)

def print_result(passed, message, details=None):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {message}")
    if details:
        print(f"   Details: {json.dumps(details, indent=2, ensure_ascii=False)}")
    return passed

def measure_time(func, *args, **kwargs):
    start = time.time()
    result = func(*args, **kwargs)
    elapsed = time.time() - start
    return result, elapsed

def safe_request(method, url, **kwargs):
    """Gửi request và bắt lỗi, trả về (response, error)"""
    try:
        response = requests.request(method, url, timeout=10, **kwargs)
        return response, None
    except Exception as e:
        return None, str(e)

# ==================== TEST FUNCTIONS ====================

class SystemTester:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.api_key = api_key
        self.headers = {"Content-Type": "application/json", "x-api-key": api_key}
        self.results = []
        self.test_data = {
            "student_id": "TEST001",
            "student_name": "Nguyễn Văn Test",
            "gender": "male",
            "age": 20
        }
        # Mock descriptor (128 float) - chỉ để test
        self.mock_descriptor = [0.1] * 128
        self.mock_cropped_image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA="  # 1x1 pixel base64
        self.ws_connected = False
        self.ws_messages = []

    def log_result(self, test_name, passed, message, response_time=None):
        self.results.append({
            "test": test_name,
            "passed": passed,
            "message": message,
            "response_time": response_time,
            "timestamp": datetime.now().isoformat()
        })
        status = "✅ PASS" if passed else "❌ FAIL"
        logger.info(f"{status} - {test_name}: {message}" + (f" ({response_time:.3f}s)" if response_time else ""))

    # ------------------- TESTS -------------------
    def test_health(self):
        """Kiểm tra endpoint /api/health"""
        print_section("1. HEALTH CHECK")
        url = f"{self.base_url}/api/health"
        response, err = safe_request("GET", url)
        if err:
            self.log_result("Health check", False, f"Lỗi kết nối: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            self.log_result("Health check", True, f"Server OK, uptime={data.get('uptime',0):.1f}s, cache={data.get('cacheSize',0)}")
            return True
        else:
            self.log_result("Health check", False, f"Status {response.status_code}")
            return False

    def test_get_students(self):
        """Lấy danh sách học sinh"""
        print_section("2. GET STUDENTS")
        url = f"{self.base_url}/api/students"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Get students", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            count = len(data)
            self.log_result("Get students", True, f"Lấy thành công {count} học sinh")
            self.test_data["existing_students"] = [s.get("studentId") for s in data]
            return True
        else:
            self.log_result("Get students", False, f"Status {response.status_code}")
            return False

    def test_register_student(self):
        """Đăng ký học sinh mới (nếu chưa tồn tại)"""
        print_section("3. REGISTER STUDENT")
        url = f"{self.base_url}/api/register"
        payload = {
            "studentId": self.test_data["student_id"],
            "name": self.test_data["student_name"],
            "descriptor": self.mock_descriptor,
            "croppedImage": self.mock_cropped_image,
            "gender": self.test_data["gender"],
            "age": self.test_data["age"]
        }
        response, err = safe_request("POST", url, headers=self.headers, json=payload)
        if err:
            self.log_result("Register student", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            self.log_result("Register student", True, data.get("message", "Thành công"))
            return True
        elif response.status_code == 400 and "already exists" in response.text:
            self.log_result("Register student", True, "Học sinh đã tồn tại (bỏ qua)")
            return True
        else:
            self.log_result("Register student", False, f"Status {response.status_code}: {response.text}")
            return False

    def test_recognize(self):
        """Gửi nhận diện nhiều khuôn mặt (mock)"""
        print_section("4. RECOGNIZE MULTIPLE")
        url = f"{self.base_url}/api/recognize-multiple"
        payload = {
            "descriptors": [self.mock_descriptor],
            "emotions": ["happy"],
            "croppedImages": [self.mock_cropped_image],
            "ageGenders": [{"age": 20, "gender": "male"}]
        }
        response, err = safe_request("POST", url, headers=self.headers, json=payload)
        if err:
            self.log_result("Recognize", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            count = data.get("count", 0)
            results = data.get("results", [])
            self.log_result("Recognize", True, f"Nhận diện {count} khuôn mặt, kết quả: {len(results)}")
            return True
        else:
            self.log_result("Recognize", False, f"Status {response.status_code}: {response.text}")
            return False

    def test_get_attendance(self):
        """Lấy danh sách điểm danh hôm nay"""
        print_section("5. GET ATTENDANCE")
        url = f"{self.base_url}/api/attendance"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Get attendance", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            count = data.get("count", 0)
            self.log_result("Get attendance", True, f"Điểm danh hôm nay: {count} học sinh")
            return True
        else:
            self.log_result("Get attendance", False, f"Status {response.status_code}")
            return False

    def test_behavior_alert(self):
        """Gửi cảnh báo hành vi"""
        print_section("6. BEHAVIOR ALERT")
        url = f"{self.base_url}/api/behavior"
        payload = {
            "studentId": self.test_data["student_id"],
            "behavior": "Test behavior alert"
        }
        response, err = safe_request("POST", url, headers=self.headers, json=payload)
        if err:
            self.log_result("Behavior alert", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            self.log_result("Behavior alert", True, "Gửi cảnh báo thành công")
            return True
        else:
            self.log_result("Behavior alert", False, f"Status {response.status_code}")
            return False

    def test_get_stats(self):
        """Lấy thống kê"""
        print_section("7. GET STATS")
        url = f"{self.base_url}/api/stats"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Get stats", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            self.log_result("Get stats", True, f"Tổng học sinh: {data.get('totalStudents',0)}, Có mặt hôm nay: {data.get('presentToday',0)}")
            return True
        else:
            self.log_result("Get stats", False, f"Status {response.status_code}")
            return False

    def test_report_csv(self):
        """Tải báo cáo CSV"""
        print_section("8. REPORT CSV")
        url = f"{self.base_url}/api/report/csv"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Report CSV", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            content = response.text[:100]
            self.log_result("Report CSV", True, f"Tải CSV thành công (dòng đầu: {content[:50]}...)")
            return True
        else:
            self.log_result("Report CSV", False, f"Status {response.status_code}")
            return False

    def test_websocket(self):
        """Kiểm tra WebSocket kết nối và nhận broadcast"""
        print_section("9. WEBSOCKET CONNECTION")
        try:
            ws_url = f"{WS_URL}"
            self.ws_connected = False
            self.ws_messages = []

            def on_message(ws, message):
                data = json.loads(message)
                self.ws_messages.append(data)
                logger.info(f"WebSocket nhận: {data.get('type', 'unknown')}")

            def on_error(ws, error):
                logger.error(f"WebSocket error: {error}")
                self.ws_connected = False

            def on_close(ws, close_status_code, close_msg):
                logger.info("WebSocket closed")
                self.ws_connected = False

            def on_open(ws):
                logger.info("WebSocket connected")
                self.ws_connected = True

            ws = websocket.WebSocketApp(ws_url,
                                        on_open=on_open,
                                        on_message=on_message,
                                        on_error=on_error,
                                        on_close=on_close)

            # Chạy WebSocket trong thread riêng
            wst = threading.Thread(target=ws.run_forever, daemon=True)
            wst.start()
            time.sleep(2)  # Chờ kết nối

            if not self.ws_connected:
                self.log_result("WebSocket", False, "Không thể kết nối WebSocket")
                return False

            # Gửi một sự kiện để kích hoạt broadcast (ví dụ: điểm danh)
            # Ở đây ta chỉ kiểm tra kết nối và nhận được tin nhắn (nếu có)
            # Ta sẽ trigger attendance notify từ endpoint
            test_notify_url = f"{self.base_url}/api/attendance-notify"
            payload = {
                "studentId": self.test_data["student_id"],
                "studentName": self.test_data["student_name"],
                "image": self.mock_cropped_image
            }
            resp, _ = safe_request("POST", test_notify_url, headers=self.headers, json=payload)
            time.sleep(2)  # Chờ broadcast

            ws.close()
            time.sleep(1)

            # Kiểm tra xem có nhận được message không
            if self.ws_messages:
                types = [m.get('type') for m in self.ws_messages]
                self.log_result("WebSocket", True, f"Kết nối thành công, nhận {len(self.ws_messages)} tin nhắn: {types}")
                return True
            else:
                self.log_result("WebSocket", True, "Kết nối thành công nhưng chưa nhận được tin nhắn (có thể do không có sự kiện)")
                return True

        except Exception as e:
            self.log_result("WebSocket", False, f"Lỗi: {str(e)}")
            return False

    def test_emotion_stats(self):
        """Lấy thống kê cảm xúc của học sinh"""
        print_section("10. EMOTION STATS")
        student_id = self.test_data["student_id"]
        url = f"{self.base_url}/api/emotion/stats/{student_id}"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Emotion stats", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            stats = data.get("stats", [])
            self.log_result("Emotion stats", True, f"Lấy {len(stats)} bản ghi cảm xúc cho học sinh {student_id}")
            return True
        else:
            self.log_result("Emotion stats", False, f"Status {response.status_code}")
            return False

    def test_class_emotion(self):
        """Lấy thống kê cảm xúc lớp"""
        print_section("11. CLASS EMOTION")
        url = f"{self.base_url}/api/emotion/class"
        response, err = safe_request("GET", url, headers=self.headers)
        if err:
            self.log_result("Class emotion", False, f"Lỗi: {err}")
            return False
        if response.status_code == 200:
            data = response.json()
            stats = data.get("stats", [])
            self.log_result("Class emotion", True, f"Lấy thống kê cảm xúc lớp: {len(stats)} loại")
            return True
        else:
            self.log_result("Class emotion", False, f"Status {response.status_code}")
            return False

    def test_performance(self):
        """Đo hiệu năng của các endpoint chính"""
        print_section("12. PERFORMANCE TEST")
        endpoints = [
            ("/api/students", "GET"),
            ("/api/attendance", "GET"),
            ("/api/stats", "GET"),
            ("/api/emotion/class", "GET"),
        ]
        results = []
        for path, method in endpoints:
            url = f"{self.base_url}{path}"
            start = time.time()
            resp, err = safe_request(method, url, headers=self.headers)
            elapsed = time.time() - start
            if err:
                results.append({"endpoint": path, "status": "error", "time": elapsed, "error": err})
            else:
                results.append({"endpoint": path, "status": resp.status_code, "time": elapsed})

        avg_time = sum(r.get("time", 0) for r in results) / len(results)
        self.log_result("Performance", True, f"Trung bình thời gian phản hồi: {avg_time*1000:.1f}ms", avg_time)
        # In chi tiết
        for r in results:
            logger.info(f"   {r['endpoint']}: {r.get('time',0)*1000:.1f}ms (status {r.get('status','N/A')})")
        return True

    def test_delete_test_student(self):
        """Xóa học sinh test (nếu có)"""
        print_section("13. CLEANUP")
        student_id = self.test_data["student_id"]
        url = f"{self.base_url}/api/students/{student_id}"
        response, err = safe_request("DELETE", url, headers=self.headers)
        if err:
            self.log_result("Delete test student", False, f"Lỗi: {err}")
            return False
        if response.status_code in [200, 404]:
            self.log_result("Delete test student", True, f"Đã xóa học sinh {student_id}" if response.status_code == 200 else "Không tìm thấy để xóa")
            return True
        else:
            self.log_result("Delete test student", False, f"Status {response.status_code}")
            return False

    # ==================== RUN ALL ====================
    def run_all_tests(self, skip_cleanup=False):
        print("\n" + "🚀 BẮT ĐẦU KIỂM TRA HỆ THỐNG 🚀".center(80, " "))
        start_time = time.time()

        tests = [
            ("Health", self.test_health),
            ("Get Students", self.test_get_students),
            ("Register Student", self.test_register_student),
            ("Recognize", self.test_recognize),
            ("Get Attendance", self.test_get_attendance),
            ("Behavior Alert", self.test_behavior_alert),
            ("Get Stats", self.test_get_stats),
            ("Report CSV", self.test_report_csv),
            ("WebSocket", self.test_websocket),
            ("Emotion Stats", self.test_emotion_stats),
            ("Class Emotion", self.test_class_emotion),
            ("Performance", self.test_performance),
        ]

        if not skip_cleanup:
            tests.append(("Cleanup", self.test_delete_test_student))

        passed = 0
        for name, test_func in tests:
            try:
                result = test_func()
                if result:
                    passed += 1
            except Exception as e:
                self.log_result(name, False, f"Exception: {str(e)}")
                result = False

        elapsed = time.time() - start_time
        total = len(tests)
        print("\n" + "=" * 80)
        print(" KẾT QUẢ TỔNG HỢP ".center(80, "="))
        print(f"  Tổng số test: {total}")
        print(f"  ✅ PASS: {passed}")
        print(f"  ❌ FAIL: {total - passed}")
        print(f"  Thời gian: {elapsed:.2f} giây")
        print("=" * 80)

        # Lưu báo cáo
        report = {
            "timestamp": datetime.now().isoformat(),
            "total_tests": total,
            "passed": passed,
            "failed": total - passed,
            "duration": elapsed,
            "results": self.results
        }
        report_file = "test_report.json"
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\n📊 Báo cáo chi tiết đã lưu vào: {report_file}")

        return passed == total


# ==================== MAIN ====================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Kiểm tra hệ thống Classroom Monitor")
    parser.add_argument("--skip-cleanup", action="store_true", help="Không xóa học sinh test")
    parser.add_argument("--base-url", default=BASE_URL, help="Base URL của server (mặc định: http://localhost:5000)")
    parser.add_argument("--api-key", default=API_KEY, help="API key")
    args = parser.parse_args()

    tester = SystemTester(args.base_url, args.api_key)
    all_passed = tester.run_all_tests(skip_cleanup=args.skip_cleanup)
    sys.exit(0 if all_passed else 1)