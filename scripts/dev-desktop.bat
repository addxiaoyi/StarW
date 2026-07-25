@echo off
:: OpenStar Desktop 开发启动脚本
:: 窗口1: 启动 Vite dev server (Solid UI)
start "OpenStar: Vite (4446)" cmd /k "cd /d %~dp0..\packages\ui-web && bunx vite --port 4446 --host 127.0.0.1"
:: 窗口2: 等待 3 秒后启动 Electron
timeout /t 3 /nobreak >nul
start "OpenStar: Electron" cmd /k "cd /d %~dp0..\packages\desktop-electron && set OPENSTAR_DEV_SERVER_URL=http://127.0.0.1:4446 && bunx electron ."
echo 已在两个新窗口启动 Vite(4446) + Electron
echo 按任意键退出此窗口...
pause >nul
