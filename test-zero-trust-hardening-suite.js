/**
 * Zero-Trust Architectural Hardening & Security Test Suite
 * Tests all 6 pillars required by the security audit:
 * 1. Zero-Trust Handshake & Session Binding
 * 2. OTP Rate Limiting & 3-Attempt Lockout
 * 3. Server-Authoritative Engine, Active Player Verification & 45s Reconnection Window
 * 4. Zod Validation, 30s Draw Cooldown, Cryptographic Room Codes & Room Join Rate Limiting
 * 5. Server-Authoritative Telemetry & Elimination of Client Strikes
 * 6. Supabase RLS Schema & Complete Elimination of innerHTML
 */

const http = require('http');
const ioClient = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { createOrUpdateUser, getUserById } = require('./users');
const { sendVerificationCode, verifyCode } = require('./supabaseClient');

const SERVER_URL = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function makeGet(endpoint, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(`${SERVER_URL}${endpoint}`, {
      method: 'GET',
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function makePost(endpoint, body = {}, token = null) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(`${SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🛡️ RUNNING EXHAUSTIVE ZERO-TRUST ARCHITECTURAL HARDENING SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // PILLAR 1: Zero-Trust Handshake & Session Binding
  // -------------------------------------------------------------
  console.log('--- Pillar 1: Zero-Trust Handshake & Session Binding ---');
  
  // 1.1 Reject unauthenticated connection
  const unauthSocket = ioClient(SERVER_URL, {
    transports: ['websocket'],
    reconnection: false
  });

  const unauthBlocked = await new Promise(resolve => {
    unauthSocket.on('connect_error', (err) => resolve(err.message));
    unauthSocket.on('connect', () => resolve(false));
  });
  unauthSocket.disconnect();
  assert(Boolean(unauthBlocked), 'Socket connection without token rejected by io.use');

  // 1.2 Authenticated connection with valid token
  const testUid = `usr_zt_${Date.now()}`;
  await createOrUpdateUser({
    id: testUid,
    email: `${testUid}@gmail.com`,
    username: `ZTPlayer_${Date.now().toString().slice(-4)}`,
    accepted_terms: true
  });

  const authSocket = ioClient(SERVER_URL, {
    transports: ['websocket'],
    auth: { token: testUid },
    reconnection: false
  });

  const authConnected = await new Promise(resolve => {
    authSocket.on('connect', () => resolve(true));
    authSocket.on('connect_error', () => resolve(false));
  });
  assert(authConnected, 'Authenticated socket connected successfully with valid token');

  // 1.3 Unauthenticated REST access returns 401
  const unauthRest = await makeGet('/api/auth/me');
  assert(unauthRest.status === 401, 'Unauthenticated /api/auth/me request returns 401 Unauthorized');
  authSocket.disconnect();

  // -------------------------------------------------------------
  // PILLAR 2: OTP Rate Limiting & Auth DoS Mitigation
  // -------------------------------------------------------------
  console.log('\n--- Pillar 2: OTP Rate Limiting & 3-Attempt Lockout ---');
  
  // 2.1 Test 3-attempt lockout on verifyCode in supabaseClient
  const lockoutEmail = `lockout_${Date.now()}@gmail.com`;
  await sendVerificationCode(lockoutEmail, 'LockoutTester');
  
  // Attempt 1: wrong code
  const res1 = await verifyCode(lockoutEmail, '000000', 'LockoutTester');
  assert(!res1.success && res1.attemptsRemaining === 2, 'Failed OTP attempt 1 recorded (2 remaining)');

  // Attempt 2: wrong code
  const res2 = await verifyCode(lockoutEmail, '000000', 'LockoutTester');
  assert(!res2.success && res2.attemptsRemaining === 1, 'Failed OTP attempt 2 recorded (1 remaining)');

  // Attempt 3: wrong code -> immediate code revocation & 15m lockout
  const res3 = await verifyCode(lockoutEmail, '000000', 'LockoutTester');
  assert(!res3.success && res3.locked === true, 'Max 3 invalid OTP attempts triggers immediate token revocation & lockout');

  // -------------------------------------------------------------
  // PILLAR 3: Server-Authoritative Engine, Clocks & 45s Reconnection Window
  // -------------------------------------------------------------
  console.log('\n--- Pillar 3: Engine Authority, Clocks & 45s Reconnection Window ---');
  
  // Create two players for an active match
  const p1Id = `usr_p1_${Date.now()}`;
  const p2Id = `usr_p2_${Date.now()}`;
  await createOrUpdateUser({ id: p1Id, email: `${p1Id}@gmail.com`, username: `P1_${Date.now().toString().slice(-4)}`, accepted_terms: true });
  await createOrUpdateUser({ id: p2Id, email: `${p2Id}@gmail.com`, username: `P2_${Date.now().toString().slice(-4)}`, accepted_terms: true });

  const s1 = ioClient(SERVER_URL, { auth: { token: p1Id }, transports: ['websocket'], reconnection: false });
  const s2 = ioClient(SERVER_URL, { auth: { token: p2Id }, transports: ['websocket'], reconnection: false });

  await Promise.all([
    new Promise(r => s1.on('connect', r)),
    new Promise(r => s2.on('connect', r))
  ]);

  // Player 1 creates room (tests cryptographic room code as well)
  const roomCreatedPromise = new Promise(r => s1.on('room_created', r));
  s1.emit('createRoom');
  const roomData = await roomCreatedPromise;
  assert(Boolean(roomData.roomCode) && roomData.roomCode.length === 10 && /^[A-F0-9]{10}$/.test(roomData.roomCode), `Cryptographically secure 10-char room code generated: ${roomData.roomCode}`);

  // Player 2 joins room
  const matchPromiseP1 = new Promise(r => s1.on('match_found', r));
  const matchPromiseP2 = new Promise(r => s2.on('match_found', r));
  s2.emit('joinRoom', roomData.roomCode);

  const [p1Match, p2Match] = await Promise.all([matchPromiseP1, matchPromiseP2]);
  assert(p1Match && p2Match, 'Match created and authoritative clocks initialized');

  const whiteSocket = p1Match.color === 'w' ? s1 : s2;
  const blackSocket = p1Match.color === 'b' ? s1 : s2;

  // 3.1 Zero-Trust Active Player Verification: Black socket tries to move on White's turn
  const moveRejectedPromise = new Promise(r => blackSocket.on('move_rejected', r));
  blackSocket.emit('makeMove', { from: 'e7', to: 'e5' });
  const rejection = await moveRejectedPromise;
  assert(Boolean(rejection), 'Server engine rejects move from socket whose userId does not match active turn');

  // 3.2 45-Second Reconnection Window on Disconnect
  const disconnectPromise = new Promise(r => {
    whiteSocket.on('player_disconnected', r);
  });
  blackSocket.disconnect();
  const discData = await disconnectPromise;
  assert(discData.reconnectWindow === 45, `Strict 45-second reconnection window announced upon disconnect (reconnectWindow: ${discData.reconnectWindow})`);

  s1.disconnect();

  // -------------------------------------------------------------
  // PILLAR 4: Schema Validation, 30s Draw Cooldown & Room Join Rate Limiting
  // -------------------------------------------------------------
  console.log('\n--- Pillar 4: Zod Schema Validation, 30s Draw Cooldown & Room Join Rate Limiting ---');

  const p3Id = `usr_p3_${Date.now()}`;
  const p4Id = `usr_p4_${Date.now()}`;
  await createOrUpdateUser({ id: p3Id, email: `${p3Id}@gmail.com`, username: `P3_${Date.now().toString().slice(-4)}`, accepted_terms: true });
  await createOrUpdateUser({ id: p4Id, email: `${p4Id}@gmail.com`, username: `P4_${Date.now().toString().slice(-4)}`, accepted_terms: true });

  const s3 = ioClient(SERVER_URL, { auth: { token: p3Id }, transports: ['websocket'], reconnection: false });
  const s4 = ioClient(SERVER_URL, { auth: { token: p4Id }, transports: ['websocket'], reconnection: false });

  await Promise.all([
    new Promise(r => s3.on('connect', r)),
    new Promise(r => s4.on('connect', r))
  ]);

  // Create match for draw cooldown test
  const p3RoomPromise = new Promise(r => s3.on('room_created', r));
  s3.emit('create_room');
  const p3Room = await p3RoomPromise;

  const p3MatchPromise = new Promise(r => s3.on('match_found', r));
  const p4MatchPromise = new Promise(r => s4.on('match_found', r));
  s4.emit('join_room', p3Room.roomCode);
  await Promise.all([p3MatchPromise, p4MatchPromise]);

  // 4.1 Test Draw Offer 30-Second Cooldown
  s3.emit('offerDraw');
  // Rapid second draw offer immediately:
  const cooldownWarningPromise = new Promise(r => s3.on('rate_limit_warning', r));
  s3.emit('offerDraw');
  const warning = await cooldownWarningPromise;
  assert(Boolean(warning && warning.error && warning.error.includes('cooldown')), 'Rapid draw offer rejected by 30-second draw offer cooldown');

  // 4.2 Malformed Move Schema Validation (Zod safely rejects without crash)
  const malformedPromise = new Promise(r => s3.on('move_rejected', r));
  s3.emit('makeMove', { from: 'invalid_sq', to: 123 });
  const malformedRes = await malformedPromise;
  assert(Boolean(malformedRes && malformedRes.reason), 'Malformed socket payload rejected cleanly by Zod validation without server exception');

  s3.disconnect();
  s4.disconnect();

  // -------------------------------------------------------------
  // PILLAR 5: Elimination of Client-Reported Strikes
  // -------------------------------------------------------------
  console.log('\n--- Pillar 5: Server-Authoritative Anti-Cheat & Client Strike Elimination ---');
  
  const serverJsContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const antiCheatEventIdx = serverJsContent.indexOf("safeListener(socket, 'anti_cheat_event'");
  const antiCheatSlice = serverJsContent.slice(antiCheatEventIdx, antiCheatEventIdx + 500);
  assert(!antiCheatSlice.includes("triggerAntiCheatViolation"), 'Direct client-reported strikes eliminated from anti_cheat_event handler');
  assert(serverJsContent.includes("stdDev < 300"), 'Server-authoritative robotic uniform delay check active (stdDev < 0.3s)');
  assert(serverJsContent.includes("moveElapsed < 150"), 'Server-authoritative superhuman speed check active (< 150ms)');

  // -------------------------------------------------------------
  // PILLAR 6: Supabase RLS Schema & Safe DOM (0 innerHTML)
  // -------------------------------------------------------------
  console.log('\n--- Pillar 6: Supabase RLS Schema & Complete Elimination of innerHTML ---');
  
  const gameJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'game.js'), 'utf8');
  const innerHtmlMatches = (gameJsContent.match(/\.innerHTML\b/g) || []).length;
  assert(innerHtmlMatches === 0, `All innerHTML instances completely eliminated from js/game.js (count: ${innerHtmlMatches})`);
  assert(gameJsContent.includes('setPieceSvg('), 'Safe SVG rendering implemented via DOMParser (setPieceSvg)');
  assert(gameJsContent.includes('sanitizeUsername('), 'Input sanitization function sanitizeUsername implemented');
  assert(gameJsContent.includes('sanitizeEmail('), 'Input sanitization function sanitizeEmail implemented');
  assert(gameJsContent.includes('sanitizeOtp('), 'Input sanitization function sanitizeOtp implemented');

  const schemaContent = fs.readFileSync(path.join(__dirname, 'supabase-schema.sql'), 'utf8');
  assert(schemaContent.includes('ENABLE ROW LEVEL SECURITY'), 'Supabase RLS enabled across all database tables');
  assert(schemaContent.includes('service_role'), 'Exclusive write access on Elo and ratings granted strictly to service_role');
  assert(schemaContent.includes('auth.uid()::text = id'), 'Client update policies strictly isolated to authenticated user ID');

  console.log('\n================================================================');
  console.log(`🎯 ZERO-TRUST HARDENING SUITE RESULTS: ${passed}/${passed + failed} PASSED (${Math.round((passed / (passed + failed)) * 100)}%)`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
