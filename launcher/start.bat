@echo off
chcp 65001 >nul
title 桌宠
where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 Node.js，先装 Node.js 20 或更新版本：https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0index.mjs" %*
if errorlevel 1 pause