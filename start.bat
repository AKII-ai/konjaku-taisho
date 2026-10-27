@echo off
chcp 65001 > nul
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python が見つかりません。
  echo Python 3 をインストールしてから、もう一度このファイルを開いてください。
  pause
  exit /b 1
)
python server.py
pause
