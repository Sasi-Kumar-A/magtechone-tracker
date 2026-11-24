@echo off
REM Run the API against the local data folder (no GitHub needed). Needs JDK 17+.
cd /d %~dp0
if exist out rmdir /s /q out
dir /s /b src\*.java > sources.txt
javac -d out @sources.txt
del sources.txt
set STORE=local
set DATA_DIR=..\data
set PORT=8080
if "%AUTH_SECRET%"=="" set AUTH_SECRET=local-dev-secret
java -cp out com.magtech.tracker.Main
