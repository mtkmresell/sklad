@echo off
chcp 65001 >nul
cd /d "%~dp0"
title tnsky kontrola - MTKM.Store
python tnsky_kontrola.py %*
pause
