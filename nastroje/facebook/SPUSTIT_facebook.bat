@echo off
chcp 65001 >nul
cd /d "%~dp0"
title facebook kontrola - MTKM.Store
python facebook_kontrola.py %*
pause
