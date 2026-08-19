PHOTOBOOTH MEDIA/QR SERVER V4.0 - RAILWAY

MỤC TIÊU
- Ảnh/video được upload từ PhotoboothNews qua HTTPS.
- QR chứa URL public, khách dùng 4G/5G hoặc Wi-Fi khác vẫn mở được.
- Dữ liệu lưu trên Railway Volume.
- Phiên tự xóa sau 24 giờ mặc định.

1. TẠO GITHUB REPOSITORY
Ví dụ:
photobooth-media

Upload toàn bộ nội dung thư mục này lên repo.
package.json và news-qr-server.js phải nằm ở root repository.

2. RAILWAY
Trong project Railway hiện tại:
New Service -> GitHub Repo -> photobooth-media

3. VARIABLES
Thêm:
SESSION_TTL_HOURS=24
MAX_UPLOAD_MB=100
STORAGE_DIR=/data/news_sessions

Không cần ép PORT=3005 nếu Railway tự cấp PORT.
Code dùng process.env.PORT tự động.

PUBLIC_BASE_URL có thể để trống.
Server sẽ tự lấy https://<host Railway> từ request.
Sau khi có domain, nếu muốn cố định thì đặt:
PUBLIC_BASE_URL=https://<domain-cua-ban>

4. VOLUME - BẮT BUỘC
Railway service photobooth-media:
Settings / Volumes -> Add Volume
Mount Path:
/data

Sau đó deploy/redeploy.

5. PUBLIC NETWORKING
Generate Domain.
Ví dụ:
https://photobooth-media-production.up.railway.app

Mở:
https://.../health

Phải thấy:
success=true
status=running

6. PHOTOBOOTHNEWS CONFIG
Đổi:
"serverUrl": "http://localhost:3005"

thành:
"serverUrl": "https://photobooth-media-production.up.railway.app"

Không cần QR Server local nữa khi dùng URL online.

7. TEST
- Chụp 1 phiên.
- App upload ảnh/video.
- QR hiển thị.
- Dùng điện thoại TẮT Wi-Fi, dùng 4G/5G quét QR.
- Trang ảnh phải mở.
- Tải ảnh/video.
- Ảnh in có QR đúng.

8. LƯU Ý
- Volume trial có dung lượng hạn chế.
- SESSION_TTL_HOURS=24 giúp tự dọn media.
- Production lớn nên chuyển media sang object storage sau.
