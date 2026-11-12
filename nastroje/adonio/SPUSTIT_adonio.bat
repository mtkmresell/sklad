@echo off
chcp 65001 >nul
cd /d "%~dp0"
title adonio kontrola - MTKM.Store
python adonio_kontrola.py %*
pause
