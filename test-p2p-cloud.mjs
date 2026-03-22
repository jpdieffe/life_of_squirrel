// Test P2P with the PUBLIC PeerJS cloud server (0.peerjs.com)
// This tests whether the free cloud signaling server actually works

import puppeteer from 'puppeteer';

async function runTest() {
  console.log('=== P2P Cloud Server Test ===\n');

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
      const ROOM = 'squirreltest-' + Math.floor(Math.random() * 9000 + 1000);
      
      console.log('ROOM: ' + ROOM);
      console.log('Using PUBLIC 0.peerjs.com (default)');
      console.log('Creating host...');
      
      // No server config = uses default 0.peerjs.com
      const hostPeer = new Peer(ROOM);
      
      hostPeer.on('error', e => console.log('HOST_ERROR: ' + e.type + ': ' + e.message));
      
      hostPeer.on('open', hostId => {
        console.log('Host registered: ' + hostId);
        
        hostPeer.on('connection', conn => {
          console.log('Host got connection');
          conn.on('open', () => {
            console.log('Host data channel open');
            conn.send('hello-from-host');
          });
          conn.on('data', data => {
            console.log('Host received: ' + data);
            console.log('TEST_RESULT:PASS');
          });
          conn.on('error', e => console.log('HOST_CONN_ERROR: ' + e));
        });
        
        console.log('Creating joiner...');
        const joinPeer = new Peer();
        
        joinPeer.on('error', e => console.log('JOIN_ERROR: ' + e.type + ': ' + e.message));
        
        joinPeer.on('open', joinId => {
          console.log('Joiner registered: ' + joinId);
          console.log('Joiner connecting to: ' + ROOM);
          
          const conn = joinPeer.connect(ROOM, { reliable: true });
          
          conn.on('open', () => {
            console.log('Joiner data channel open');
          });
          conn.on('data', data => {
            console.log('Joiner received: ' + data);
            conn.send('hello-from-joiner');
          });
          conn.on('error', e => console.log('JOIN_CONN_ERROR: ' + e));
        });
      });
      
      setTimeout(() => {
        if (!document.body.dataset.done) {
          console.log('TEST_RESULT:FAIL_TIMEOUT');
        }
      }, 20000);
    };
    document.head.appendChild(script);
  })();
  </script></body></html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  console.log('[setup] Test page loaded\n');

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('FAIL_TIMEOUT'), 25000);
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
