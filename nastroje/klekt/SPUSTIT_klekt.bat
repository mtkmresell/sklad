@echo off
chcp 65001 >nul
cd /d "%~dp0"
title klekt kontrola - MTKM.Store
python klekt_kontrola.py %*
pause
