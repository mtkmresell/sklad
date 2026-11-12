@echo off
chcp 65001 >nul
cd /d "%~dp0"
title thebeast kontrola - MTKM.Store
python thebeast_kontrola.py %*
pause
