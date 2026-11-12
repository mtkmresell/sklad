@echo off
chcp 65001 >nul
cd /d "%~dp0"
title hypeboost kontrola - MTKM.Store
python hypeboost_kontrola.py %*
pause
