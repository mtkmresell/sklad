@echo off
chcp 65001 >nul
cd /d "%~dp0"
title wtb kontrola - MTKM.Store
python wtb_kontrola.py %*
pause
