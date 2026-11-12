@echo off
chcp 65001 >nul
cd /d "%~dp0"
title sellect kontrola - MTKM.Store
python sellect_kontrola.py %*
pause
