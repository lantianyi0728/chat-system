@echo off
chcp 65001 >nul
title 轻聊 · 局域网聊天系统
cd /d "%~dp0"

echo.
echo ============================================================
echo   正在启动 轻聊 聊天系统 ...
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js，请先安装 Node.js 22 或更高版本。
  echo        下载地址：https://nodejs.org
  echo.
  pause
  exit /b 1
)

node server.js

echo.
echo 服务已停止。
pause
