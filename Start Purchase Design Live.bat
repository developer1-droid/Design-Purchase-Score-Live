@echo off
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund
if not exist .env (
  echo .env file nahi mili. .env.example ko copy karke .env banao aur values bharo.
  pause
  exit /b 1
)
rem Server pehle se chal raha hai to dobara start mat karo, sirf browser kholo.
netstat -ano | findstr /r /c:":4001 .*LISTENING" >nul && goto open
start "" /min cmd /c "node server.js"
rem Old-TV build ko ~6 second lagte hain.
timeout /t 10 /nobreak >nul
:open
rem Autoplay flag: set kiye time par awaaz bina click ke chale (Chrome pehle se khula ho to use band karke chalao).
start "" chrome --kiosk --autoplay-policy=no-user-gesture-required --app=http://localhost:4001 2>nul || start "" http://localhost:4001
