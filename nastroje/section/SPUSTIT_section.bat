@echo off
chcp 65001 >nul
cd /d "%~dp0"
title section kontrola - MTKM.Store
python section_kontrola.py
pause
