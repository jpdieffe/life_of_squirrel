// Test with TWO SEPARATE browser pages (simulating two tabs/users)
// This is the closest simulation to the real-world usage
import puppeteer from 'puppeteer';

const VITE_URL = 'http://localhost:5174';

async function runTest() {
  console.log('=== Two-Page P2P Test (like real usage) ===\n');

  const browser = await puppeteer.launch({ headless: true });
  
  // Page 1: Host
  const hostPage = await browser.newPage();
  // Page 2: Joiner  
  const joinPage = await browser.newPage();
  
  let testResult = null;

  hostPage.on('console', msg => console.log('[HOST]', msg.text()));
  joinPage.on('console', msg => {
    const text = msg.text();
    console.log('[JOIN]', text);
    if (text.includes('TEST:PASS')) testResult = 'PASS';
    if (text.includes('TEST:FAIL')) testResult = text;
  });
  hostPage.on('pageerror', err => console.log('[HOST ERROR]', err.message));
  joinPage.on('pageerror', err => console.log('[JOIN ERROR]', err.message));

  // Load host page via vite dev server
  await hostPage.goto(VITE_URL + '/test-host.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('[setup] Host page loaded');
  
  // Wait for host to register and get room code from title
  let roomCode = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    roomCode = await hostPage.title();
    if (roomCode && roomCode.length > 3 && !roomCode.includes('loading')) break;
    roomCode = null;
  }
  
  if (!roomCode) {
    console.log('\nFAIL: Host never registered');
    await browser.close();
    process.exit(1);
  }
  
  console.log('[setup] Host registered with room:', roomCode);
  console.log('');

  // Simulate startGame() blocking on host
  console.log('[setup] Simulating startGame() on host page (3s block)...');
  await hostPage.evaluate(() => {
    const start = Date.now();
    while (Date.now() - start < 3000) { Math.random(); }
    console.log('startGame() simulation done');
  });
  console.log('[setup] startGame() done\n');

  // Load join page
  await joinPage.goto(VITE_URL + '/test-join.html#' + roomCode, { waitUntil: 'domcontentloaded', timeout: 10000 });
  console.log('[setup] Join page loaded\n');

  // Wait for result
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { if (!testResult) testResult = 'FAIL_TIMEOUT'; resolve(); }, 25000);
    const iv = setInterval(() => {
      if (testResult) { clearTimeout(timeout); clearInterval(iv); resolve(); }
    }, 200);
  });

  console.log('\n=============================');
  console.log('RESULT:', testResult);
  console.log('=============================\n');

  await browser.close();
  process.exit(testResult === 'PASS' ? 0 : 1);
}

runTest().catch(err => { console.error('Test crashed:', err); process.exit(2); });
