@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bazos kontrola - MTKM.Store
python bazos_kontrola.py
echo.
pause
