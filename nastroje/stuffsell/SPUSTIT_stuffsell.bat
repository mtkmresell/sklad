@echo off
chcp 65001 >nul
cd /d "%~dp0"
title stuffsell kontrola - MTKM.Store
python stuffsell_kontrola.py %*
pause
