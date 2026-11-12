@echo off
chcp 65001 >nul
cd /d "%~dp0"
title sneakerstore kontrola - MTKM.Store
python sneakerstore_kontrola.py %*
pause
