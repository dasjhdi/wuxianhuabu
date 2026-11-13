@echo off
chcp 65001 >nul
setlocal

REM 局域网共享启动脚本：渠道服务 + 客户端
REM 访客地址：http://<本机局域网IP>:5173

cd /d %~dp0

REM 1) 启动渠道服务（仅本机可见）
start "创梦渠道服务" /min cmd /c "cd /d D:\wuxianhuabu\channel-server && python -m uvicorn main:app --host 127.0.0.1 --port 8787"
timeout /t 3 >nul

REM 2) 启动客户端（对局域网开放）
set CODEBUDDY_SAFE_DELETE_ENABLED=0
set DREAMMUSE_CHANNEL=dreammuse
set DREAMMUSE_API_BASE=http://127.0.0.1:8787
REM 允许局域网访客打开的项目目录，多个用分号分隔
set TOONFLOW_SHARED_WORKSPACES=D:\wuxianhuabudate
REM 放行私网 Host 访问控制接口（默认关闭，仅局域网共享时开启）
set TOONFLOW_ALLOW_LAN_HOSTS=1

call bun run dev
