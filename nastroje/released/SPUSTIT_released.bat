@echo off
chcp 65001 >nul
cd /d "%~dp0"
title released kontrola - MTKM.Store
python released_kontrola.py %*
pause
