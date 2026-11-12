@echo off
chcp 65001 >nul
cd /d "%~dp0"
title refresher kontrola - MTKM.Store
python refresher_kontrola.py
pause
