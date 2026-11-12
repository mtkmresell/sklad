@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Prihlaseni na weby kontrol - MTKM.Store
echo Instaluji Playwright (jen poprve, chvili to trva)...
python -m pip install --quiet playwright
python prohlizec.py
pause
