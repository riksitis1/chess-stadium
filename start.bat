@echo off
title Chess 1v1 Multiplayer with Anti-Cheat & Cloudflare
cd /d "%~dp0"
echo ========================================================
echo   CHESS 1v1 MULTIPLAYER - 10 MINUTE RAPID & ANTI-CHEAT
echo ========================================================
echo Starting server and Cloudflare public tunnel...
start http://localhost:3000
node tunnel.js
pause
