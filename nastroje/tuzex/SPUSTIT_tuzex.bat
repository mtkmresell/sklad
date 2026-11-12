@echo off
chcp 65001 >nul
cd /d "%~dp0"
title tuzex kontrola - MTKM.Store
python tuzex_kontrola.py %*
pause
