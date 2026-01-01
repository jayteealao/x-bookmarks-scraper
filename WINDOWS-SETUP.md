# Windows Setup Guide

Quick fix guide for running X Bookmarks Scraper on Windows.

## Quick Start

```powershell
# 1. Clone repository
git clone https://github.com/jayteealao/x-bookmarks-scraper.git
cd x-bookmarks-scraper

# 2. Install dependencies
npm install

# 3. Install Playwright Chromium
npx playwright install chromium

# 4. Run discovery mode
npm run discover
```

## Common Windows Issues

### Issue 1: Browser doesn't start
**Symptom:** Command runs but nothing happens

**Solution:** Make sure Chromium is installed
```powershell
npx playwright install chromium
```

### Issue 2: "Cannot find module" errors
**Symptom:** Import errors when running

**Solution:** Reinstall dependencies
```powershell
rm -r node_modules
rm package-lock.json
npm install
```

### Issue 3: Path issues with profile directory
**Symptom:** Errors about profile path

**Solution:** Use explicit path
```powershell
npm run extract -- --profile-dir=C:\Users\YourName\x-bookmarks-profile
```

### Issue 4: Permission errors
**Symptom:** EACCES or permission denied

**Solution:** Run PowerShell as Administrator
- Right-click PowerShell
- Select "Run as Administrator"
- Navigate to project directory
- Run commands

### Issue 5: Long path errors
**Symptom:** Errors about path length

**Solution:** Enable long paths in Windows
```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

Or move project to shorter path:
```powershell
cd C:\
git clone https://github.com/jayteealao/x-bookmarks-scraper.git scraper
cd scraper
```

## Windows-Specific Commands

### Check Node version
```powershell
node --version
# Should be v20 or higher
```

### View output files
```powershell
# List files
dir out

# Count tweets (PowerShell)
(Get-Content out\tweetEntity.jsonl | Measure-Object -Line).Lines

# View first tweet (requires jq for Windows)
Get-Content out\tweetEntity.jsonl -First 1 | jq .
```

### Install jq (for viewing JSON)
```powershell
# Using chocolatey
choco install jq

# Or download from: https://stedolan.github.io/jq/download/
# Place jq.exe in C:\Windows\System32\
```

### SQLite on Windows
```powershell
# Install SQLite
choco install sqlite

# Or download from: https://sqlite.org/download.html
# Add to PATH

# Query database
sqlite3 out\bookmarks.db "SELECT COUNT(*) FROM tweets"
```

## Recommended Windows Setup

### 1. Install Chocolatey (Package Manager)
```powershell
# Run as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

### 2. Install Tools
```powershell
choco install nodejs-lts
choco install git
choco install jq
choco install sqlite
```

### 3. Verify Installation
```powershell
node --version
git --version
jq --version
sqlite3 --version
```

## Running Commands

### Discovery Mode
```powershell
npm run discover
```

### Full Extraction
```powershell
npm run extract
```

### With Options
```powershell
# SQLite export
npm run extract -- --sqlite

# Download media
npm run extract -- --download-media

# Headless mode
npm run extract -- --headless

# Limit scrolls
npm run extract -- --max-scrolls=10
```

## File Paths on Windows

When specifying paths, use either:

**Forward slashes:**
```powershell
npm run extract -- --profile-dir=./x-profile
```

**Or escaped backslashes:**
```powershell
npm run extract -- --profile-dir=.\\x-profile
```

**Or full Windows paths:**
```powershell
npm run extract -- --profile-dir=C:/Users/YourName/Documents/x-profile
```

## Performance Tips for Windows

### 1. Disable Windows Defender for project folder
- Open Windows Security
- Virus & threat protection
- Manage settings
- Add exclusion
- Add folder: `C:\Users\YourName\x-bookmarks-scraper`

### 2. Use SSD if available
Move project to SSD drive for better performance

### 3. Close other applications
Browser automation uses significant resources

## Output File Locations

Windows uses backslashes in paths:
```powershell
out\tweetEntity.jsonl
out\twitterUser.jsonl
out\bookmarks.db
out\media\1234567890.jpg
```

But the scraper works with forward slashes:
```javascript
// Both work on Windows
"out/tweetEntity.jsonl"
"out\\tweetEntity.jsonl"
```

## Troubleshooting on Windows

### Check if process is running
```powershell
Get-Process | Where-Object {$_.ProcessName -like "*node*"}
Get-Process | Where-Object {$_.ProcessName -like "*chrome*"}
```

### Kill stuck processes
```powershell
Stop-Process -Name "node" -Force
Stop-Process -Name "chrome" -Force
```

### Clear output directory
```powershell
Remove-Item -Path out\* -Recurse -Force
```

### Check disk space
```powershell
Get-PSDrive C
```

### View logs in real-time
```powershell
npm run extract 2>&1 | Tee-Object -FilePath log.txt
```

## WSL Alternative

If you have Windows Subsystem for Linux:

```bash
# In WSL terminal
git clone https://github.com/jayteealao/x-bookmarks-scraper.git
cd x-bookmarks-scraper
npm install
npx playwright install chromium
npm run discover
```

WSL may have better compatibility with some Node packages.

## Success Checklist

- [x] Node.js 20+ installed
- [x] Git installed
- [x] Project cloned
- [x] `npm install` completed
- [x] `npx playwright install chromium` completed
- [x] `npm run discover` opens a browser
- [x] Files appear in `out\` directory

## Getting Help

If issues persist:

1. Check error messages carefully
2. Verify Node.js version: `node --version`
3. Reinstall Playwright: `npx playwright install --force chromium`
4. Try in WSL if available
5. Open issue with error details and Windows version

---

**Ready to go!** Run `npm run discover` and the browser should open.
