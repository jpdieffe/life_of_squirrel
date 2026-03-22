// Test that simulates the EXACT game flow:
// 1. Host registers with PeerJS
// 2. Heavy work blocks main thread (simulating BabylonJS scene creation)
// 3. Joiner tries to connect
// This tests whether startGame() blocking is the culprit.

import puppeteer from 'puppeteer';

async function runTest() {
  console.log('=== P2P Game-Flow Simulation Test ===\n');

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('[browser]', msg.text());
  });

  const html = `
  <html><body><script>
  (async () => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    script.onload = () => {
      const ROOM = 'gameflow-' + Math.floor(Math.random() * 9000 + 1000);
      
      console.log('ROOM: ' + ROOM);
      console.log('');
      
      // ========== STEP 1: Host registers (first "Host" button click) ==========
      console.log('[Step 1] Host registering...');
      const hostPeer = new Peer(ROOM);
      
      hostPeer.on('error', e => console.log('HOST_ERROR: ' + e.type + ': ' + e.message));
      hostPeer.on('disconnected', () => {
        console.log('HOST DISCONNECTED from signaling!');
        hostPeer.reconnect();
      });
      
      hostPeer.on('open', hostId => {
        console.log('[Step 1] Host registered: ' + hostId);
        
        hostPeer.on('connection', conn => {
          console.log('[Step 5] Host received connection from joiner');
          conn.on('open', () => {
            console.log('[Step 6] Host data channel OPEN');
            conn.send('hello-from-host');
          });
          conn.on('data', data => {
            console.log('[Step 7] Host received: ' + data);
            console.log('TEST_RESULT:PASS');
          });
          conn.on('error', e => console.log('HOST_CONN_ERROR: ' + e));
        });
        
        // ========== STEP 2: Simulate "Start Playing" click ==========
        // Block main thread for 5 seconds (simulating BabylonJS scene creation)
        console.log('[Step 2] Simulating heavy startGame() - blocking main thread for 5s...');
        const start = Date.now();
        while (Date.now() - start < 5000) {
          // Busy-wait to simulate heavy sync work
          Math.random() * Math.random();
        }
        console.log('[Step 2] startGame() done');
        
        // ========== STEP 3: ensureSignaling() ==========
        console.log('[Step 3] Checking signaling state: disconnected=' + hostPeer.disconnected);
        if (hostPeer.disconnected) {
          console.log('[Step 3] Reconnecting to signaling...');
          hostPeer.reconnect();
        }
        
        // ========== STEP 4: Joiner connects (after host game loaded) ==========
        setTimeout(() => {
          console.log('[Step 4] Creating joiner...');
          const joinPeer = new Peer();
          
          joinPeer.on('error', e => console.log('JOIN_ERROR: ' + e.type + ': ' + e.message));
          
          joinPeer.on('open', joinId => {
            console.log('[Step 4] Joiner registered: ' + joinId);
            console.log('[Step 4] Joiner connecting to: ' + ROOM);
            
            const conn = joinPeer.connect(ROOM, { reliable: true });
            
            conn.on('open', () => {
              console.log('[Step 5b] Joiner data channel OPEN');
            });
            conn.on('data', data => {
              console.log('[Step 6b] Joiner received: ' + data);
              conn.send('hello-from-joiner');
            });
            conn.on('error', e => console.log('JOIN_CONN_ERROR: ' + e));
          });
        }, 2000);  // Joiner connects 2s after host finishes loading
      });
      
      setTimeout(() => {
        if (!document.body.dataset.done) {
          console.log('TEST_RESULT:FAIL_TIMEOUT');
        }
      }, 30000);
    };
    document.head.appendChild(script);
  })();
  </script></body></html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  console.log('[setup] Test page loaded\n');

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('FAIL_TIMEOUT'), 35000);
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('TEST_RESULT:PASS')) { clearTimeout(timeout); resolve('PASS'); }
      else if (text.includes('TEST_RESULT:FAIL')) { clearTimeout(timeout); resolve('FAIL'); }
    });
  });

  console.log('\n=============================');
  console.log('RESULT:', result);
  console.log('=============================\n');

  await browser.close();
  process.exit(result === 'PASS' ? 0 : 1);
}

runTest().catch(err => { console.error('Test crashed:', err); process.exit(2); });
