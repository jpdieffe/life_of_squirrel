// Automated P2P connection test using Puppeteer
// Spins up a PeerJS server, opens a browser page, runs host+joiner in same page,
// checks if data is exchanged. Fully self-contained.

import puppeteer from 'puppeteer';
import { PeerServer } from 'peer';

const PORT = 9876; // dedicated test port

async function runTest() {
  console.log('=== P2P Automated Test ===\n');

  // 1. Start PeerJS server
  console.log('[setup] Starting PeerJS server on port', PORT);
  const server = PeerServer({ port: PORT, path: '/' });
  await new Promise(r => setTimeout(r, 1000)); // let server start
  console.log('[setup] PeerJS server ready\n');

  // 2. Launch browser
  console.log('[setup] Launching browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Collect console messages
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log('[browser]', text);
  });

  // 3. Navigate to an inline page that does the P2P test
  const html = `
  <html><body><script>
  (async () => {
    // Dynamically import PeerJS from CDN
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    script.onload = () => {
      const ROOM = 'autotest-' + Math.floor(Math.random() * 9000 + 1000);
      const SERVER = { host: 'localhost', port: ${PORT}, path: '/', secure: false };
      
      console.log('ROOM: ' + ROOM);
      console.log('Creating host...');
      
      const hostPeer = new Peer(ROOM, SERVER);
      
      hostPeer.on('error', e => console.log('HOST_ERROR: ' + e.type + ' ' + e.message));
      
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
        
        // Create joiner after host is registered
        console.log('Creating joiner...');
        const joinPeer = new Peer(SERVER);
        
        joinPeer.on('error', e => console.log('JOIN_ERROR: ' + e.type + ' ' + e.message));
        
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

  // 4. Wait for result
  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('FAIL_TIMEOUT'), 25000);
    
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('TEST_RESULT:PASS')) {
        clearTimeout(timeout);
        resolve('PASS');
      } else if (text.includes('TEST_RESULT:FAIL')) {
        clearTimeout(timeout);
        resolve('FAIL');
      }
    });
  });

  console.log('\n=============================');
  console.log('RESULT:', result);
  console.log('=============================\n');

  // Cleanup
  await browser.close();
  try { server.close(); } catch {}
  
  process.exit(result === 'PASS' ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test crashed:', err);
  process.exit(2);
});
