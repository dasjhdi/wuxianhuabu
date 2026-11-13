@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM 创梦 · 隧道发布启动脚本
REM 结构：cloudflared → 鉴权反代(8090) → 应用(3000) → 渠道(8787)
REM 访问口令见 tunnel\password.txt，可自行修改
REM ============================================================

cd /d %~dp0
set /p ACCESS_PASSWORD=<tunnel\password.txt
if "%ACCESS_PASSWORD%"=="" (
  echo 未找到访问口令，请检查 tunnel\password.txt
  pause
  exit /b 1
)

echo [1/5] 启动渠道服务（仅本机）...
start "创梦渠道服务" /min cmd /c "cd /d D:\wuxianhuabu\channel-server && python -m uvicorn main:app --host 127.0.0.1 --port 8787"
timeout /t 3 >nul

echo [2/5] 启动本地音色克隆服务（8100，首次加载约 30 秒）...
start "创梦音色克隆" /min cmd /c "cd /d D:\wuxianhuabu\CosyVoice && .venv\Scripts\python.exe server_local.py"
timeout /t 3 >nul

echo [3/5] 启动应用服务（3000）...
start "创梦应用服务" /min cmd /c "cd /d D:\wuxianhuabu\Toonflow-app && set TOONFLOW_SHARED_WORKSPACES=D:\wuxianhuabudate&& set TOONFLOW_ALLOW_LAN_HOSTS=1&& set TOONFLOW_ALLOWED_HOSTS=trycloudflare.com&& bun run start:server"
timeout /t 6 >nul

echo [4/5] 启动口令鉴权反代（8090）...
start "创梦鉴权反代" /min cmd /c "cd /d D:\wuxianhuabu\tunnel && set DREAMMUSE_ACCESS_PASSWORD=%ACCESS_PASSWORD%&& bun run auth-proxy.ts"
timeout /t 3 >nul

echo [5/5] 建立公网隧道，请在下方窗口复制 https://xxx.trycloudflare.com 地址
echo 访问口令：%ACCESS_PASSWORD%
echo.
cd /d D:\wuxianhuabu\tools
cloudflared.exe tunnel --url http://127.0.0.1:8090 --no-autoupdate

pause
