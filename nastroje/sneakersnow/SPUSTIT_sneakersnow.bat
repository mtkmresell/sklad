@echo off
chcp 65001 >nul
cd /d "%~dp0"
title sneakersnow kontrola - MTKM.Store
python sneakersnow_kontrola.py %*
pause
