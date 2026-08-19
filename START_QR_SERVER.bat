@echo off
title PhotoboothNews QR Server V3
cd /d "%~dp0"

echo ==========================================
echo PhotoboothNews QR Server V3
echo ==========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Khong tim thay Node.js.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo [FIRST RUN] Dang cai express multer qrcode sharp...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install that bai.
    pause
    exit /b 1
  )
)

echo.
echo Dang khoi dong server cong 3005...
node news-qr-server.js
pause
