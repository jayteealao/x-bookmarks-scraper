#!/usr/bin/env node
console.log('=== DIAGNOSTIC TEST ===');
console.log('1. Node version:', process.version);
console.log('2. Platform:', process.platform);
console.log('3. Current directory:', process.cwd());

console.error('4. Testing console.error output');

try {
  console.log('5. Attempting to import playwright...');
  const playwright = await import('playwright');
  console.log('6. ✓ Playwright imported successfully');
  console.log('7. Playwright version:', playwright.chromium);
} catch (error) {
  console.error('8. ✗ Failed to import playwright:', error.message);
}

console.log('9. Script completed');
process.exit(0);
