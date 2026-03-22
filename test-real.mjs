// Test using the ACTUAL game Network class via vite dev server
import puppeteer from 'puppeteer';

async function runTest() {
  console.log('=== Real Network Class Test ===\n');

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('[browser]', msg.text());
  });
  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });

  // Use the vite dev server which can serve .ts files
  await page.goto('http://localhost:5174/test-real.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('[setup] Test page loaded\n');

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('FAIL_TIMEOUT'), 25000);
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('TEST_RESULT:PASS')) { clearTimeout(timeout); resolve('PASS'); }
      else if (text.includes('TEST_RESULT:FAIL')) { clearTimeout(timeout); resolve(text); }
    });
  });

  console.log('\n=============================');
  console.log('RESULT:', result);
  console.log('=============================\n');

  await browser.close();
  process.exit(result === 'PASS' ? 0 : 1);
}

runTest().catch(err => { console.error('Test crashed:', err); process.exit(2); });
