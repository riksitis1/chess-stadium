const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 3000;
let cloudflareUrl = null;

console.log('----------------------------------------------------');
console.log('♟️  CHESS MULTIPLAYER - CLOUDFLARE PUBLIC LAUNCHER');
console.log('----------------------------------------------------');

// Start Node server
const serverProcess = spawn('node', ['server.js'], {
  stdio: 'inherit',
  shell: true
});

serverProcess.on('error', (err) => {
  console.error('Failed to start server:', err);
});

// Wait 2 seconds for server to bind, then start Cloudflare Tunnel
setTimeout(() => {
  console.log('\n[Cloudflare] Initializing secure public tunnel via cloudflared...');

  const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
    shell: true
  });

  const onData = (data) => {
    const text = data.toString();
    // Look for trycloudflare url
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !cloudflareUrl) {
      cloudflareUrl = match[0];
      console.log('\n======================================================');
      console.log('🌟 YOUR CHESS GAME IS NOW PUBLIC ACROSS THE WORLD!');
      console.log(`🌐 Public Cloudflare URL:  ${cloudflareUrl}`);
      console.log(`🏠 Local URL:              http://localhost:${PORT}`);
      console.log('Share this link with your friends to play 1v1 anywhere!');
      console.log('======================================================\n');

      // Post back to local server so browser clients can see their public URL
      const req = http.request({
        hostname: 'localhost',
        port: PORT,
        path: '/api/tunnel-info',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {});
      req.on('error', () => {});
      req.write(JSON.stringify({ url: cloudflareUrl }));
      req.end();
    }
  };

  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);

  tunnel.on('close', (code) => {
    console.log(`[Cloudflare Tunnel] Process exited with code ${code}`);
  });

  process.on('SIGINT', () => {
    tunnel.kill();
    serverProcess.kill();
    process.exit();
  });
}, 2000);
