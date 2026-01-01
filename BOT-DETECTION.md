# Bot Detection & Authentication Guide

## The Problem

Yes, Google and Twitter actively detect automated browsers and block logins. They check for:

1. **navigator.webdriver** - Set to `true` in automated browsers
2. **Chrome DevTools Protocol** - Detectable automation signals
3. **Missing browser features** - Like `window.chrome.runtime`
4. **Unusual behavior patterns** - Too-perfect mouse movements, instant actions
5. **User agent mismatches** - Chromium vs Chrome differences

## Solution 1: Stealth Mode (Now Enabled) ✅

The scraper now includes stealth configuration that should bypass most detection:

**What we've added:**
- `--disable-blink-features=AutomationControlled` - Hides automation
- `navigator.webdriver` override to `false`
- Realistic Chrome user agent
- `window.chrome.runtime` object injection
- Permissions API overrides

**Try this first:**
```powershell
npm run discover
```

The browser should now appear as a regular Chrome instance. Try logging in to Twitter directly (skip Google login).

## Solution 2: Direct Twitter Login (Recommended)

Instead of "Sign in with Google", use direct Twitter login:

1. When browser opens, go to Twitter
2. Click "Sign in"
3. Use **email/username and password** (not Google SSO)
4. Complete any 2FA if required
5. Navigate to bookmarks manually
6. Press Enter in terminal

**Why this works better:**
- Twitter's own login is less strict than Google OAuth
- Avoids Google's aggressive bot detection
- Session persists in profile directory

## Solution 3: Cookie Import

If stealth mode doesn't work, manually import cookies from your regular browser:

### Step 1: Export cookies from your browser

**Chrome/Edge:**
1. Install extension: [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/)
2. Go to https://twitter.com (while logged in)
3. Click EditThisCookie icon
4. Click "Export" (clipboard icon)
5. Save to `cookies.json`

**Firefox:**
1. Install extension: [Cookie-Editor](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)
2. Go to https://twitter.com
3. Click extension → Export → Copy to clipboard
4. Save to `cookies.json`

### Step 2: Create cookie import script

Create `import-cookies.ts`:
```typescript
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const cookies = JSON.parse(readFileSync('cookies.json', 'utf-8'));

const context = await chromium.launchPersistentContext('./x-profile', {
  headless: false,
});

await context.addCookies(cookies.map((c: any) => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path,
  expires: c.expirationDate,
  httpOnly: c.httpOnly,
  secure: c.secure,
  sameSite: c.sameSite || 'Lax',
})));

console.log('✅ Cookies imported to ./x-profile');
await context.close();
```

Run: `tsx import-cookies.ts`

Then run scraper normally - you'll be logged in.

## Solution 4: Use Firefox Instead

Firefox has less aggressive bot detection:

**Modify launch code** (in `bookmarks-capture-v2.ts`):
```typescript
import { firefox } from 'playwright';  // Change from chromium

// In launchBrowser():
this.context = await firefox.launchPersistentContext(this.options.profileDir, {
  // ... same options
});
```

Firefox often bypasses detection that catches Chromium.

## Solution 5: Manual Session Setup (Most Reliable)

Use your **actual Chrome browser** with your real profile:

### Windows:
```powershell
# Find your Chrome profile (usually here):
$env:LOCALAPPDATA\Google\Chrome\User Data\Default

# Copy it to project:
Copy-Item -Path "$env:LOCALAPPDATA\Google\Chrome\User Data" -Destination "./chrome-profile" -Recurse

# Update scraper to use it:
npm run discover -- --profile-dir="./chrome-profile/Default"
```

### Important: Close Chrome first!
You can't use the profile while Chrome is running.

**Or use a different Chrome profile:**
1. Open Chrome
2. Click profile icon → "Add"
3. Create "Scraper" profile
4. Log in to Twitter in that profile
5. Close Chrome
6. Copy profile: `C:\Users\YourName\AppData\Local\Google\Chrome\User Data\Profile 1`
7. Use it: `npm run discover -- --profile-dir="./chrome-profile/Profile 1"`

## Solution 6: Playwright's Firefox or WebKit

Install other browsers:
```powershell
npx playwright install firefox
npx playwright install webkit
```

Try Firefox (better for logins) or WebKit (Safari engine).

## Testing Stealth Mode

You can verify stealth mode is working:

1. Run the scraper
2. When browser opens, navigate to: https://bot.sannysoft.com/
3. Check the results - should show:
   - ❌ WebDriver: `false` (good!)
   - ✅ Chrome: `present` (good!)
   - ✅ Permissions: `defined` (good!)

If you see red flags, the stealth mode isn't fully working.

## What Detection You Might See

### Google Login:
- "This browser or app may not be secure"
- "Couldn't sign you in"
- Requires phone verification

**Solution**: Use direct Twitter login instead of Google SSO

### Twitter Login:
- "There was unusual login activity"
- "Verify it's you" - SMS code
- "Complete this challenge" - reCAPTCHA

**Solution**: Complete verification once, then session persists

## Best Practices

1. **Use non-headless mode** (default) - Headless is easier to detect
2. **Don't use `--headless` flag** when logging in
3. **Complete verification manually** - Don't try to automate 2FA
4. **Log in once** - Session saved in `./x-profile` directory
5. **Wait between attempts** - Rapid retries trigger detection
6. **Use direct credentials** - Avoid OAuth/SSO when possible

## Current Status

✅ **Stealth mode enabled** - Should work for most users
✅ **Direct Twitter login** - Recommended approach
✅ **Session persistence** - Login saved in `./x-profile`

## Troubleshooting

### Still blocked?

1. **Try Solution 2** - Use Twitter login (not Google)
2. **Try Solution 3** - Import cookies from regular browser
3. **Try Solution 4** - Use Firefox instead of Chromium
4. **Try Solution 5** - Use real Chrome profile

### Works in regular Chrome but not Playwright?

This means detection is still working. Try:
- Cookie import (Solution 3)
- Real Chrome profile (Solution 5)

### "Unusual activity" warnings?

This is normal on first login. Complete verification:
- Enter SMS code
- Solve captcha
- Confirm email

Session will persist for future runs.

## Summary

**Quick Start (Recommended):**
```powershell
# Pull latest changes with stealth mode
git pull

# Run scraper - use direct Twitter login (not Google)
npm run discover

# When browser opens:
# 1. Go to twitter.com
# 2. Click "Sign in"
# 3. Use email/password (not "Sign in with Google")
# 4. Complete 2FA if needed
# 5. Navigate to bookmarks
# 6. Press Enter in terminal
```

Session saved in `./x-profile/` - you only need to log in once!

---

**Still having issues?** Try the cookie import method (Solution 3) - it's the most reliable.
