const assert = require('assert');
const { io } = require('socket.io-client');
const { createOrUpdateUser, getUserById } = require('./users');

const BASE_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMandatoryAuthGateTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING MANDATORY AUTH & PRIVACY AGREEMENT GATE TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function testAssert(cond, msg) {
    total++;
    if (cond) {
      console.log(`✅ [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${msg}`);
    }
  }

  // TEST 1: Guest API Endpoint Permanently Eliminated
  console.log('--- Test 1: Guest API Access Revocation ---');
  const guestRes = await fetch(`${BASE_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'HackerGuest' })
  });
  const guestData = await guestRes.json();
  testAssert(guestRes.status === 403, 'POST /api/auth/guest strictly rejected with HTTP 403 Forbidden');
  testAssert(guestData.success === false, 'Guest access flagged success: false');
  testAssert(guestData.error.includes('Guest and anonymous access has been permanently revoked'), 'Guest revocation message confirmed');

  // TEST 2: Unauthenticated /api/auth/me Protection
  console.log('\n--- Test 2: Unauthenticated REST API Protection ---');
  const meUnauthRes = await fetch(`${BASE_URL}/api/auth/me`);
  testAssert(meUnauthRes.status === 401, 'GET /api/auth/me returns HTTP 401 Unauthorized when no session provided');

  // TEST 3: WebSocket Connection Handshake Token Verification
  console.log('\n--- Test 3: WebSocket Handshake Token Verification ---');
  
  // 3A: Connection without token must fail handshake
  const noTokenSocket = io(BASE_URL, {
    forceNew: true,
    transports: ['websocket']
  });

  let noTokenRejected = false;
  let noTokenErrorMsg = '';
  noTokenSocket.on('connect_error', (err) => {
    noTokenRejected = true;
    noTokenErrorMsg = err.message;
  });

  await wait(600);
  noTokenSocket.disconnect();
  testAssert(noTokenRejected, 'Socket handshake without auth token rejected');
  testAssert(noTokenErrorMsg.includes('Authentication required'), `Handshake error message confirmed: "${noTokenErrorMsg}"`);

  // 3B: Connection with fake/invalid token must fail handshake
  const fakeTokenSocket = io(BASE_URL, {
    forceNew: true,
    auth: { token: 'usr_non_existent_token_12345' },
    transports: ['websocket']
  });

  let fakeTokenRejected = false;
  let fakeTokenErrorMsg = '';
  fakeTokenSocket.on('connect_error', (err) => {
    fakeTokenRejected = true;
    fakeTokenErrorMsg = err.message;
  });

  await wait(600);
  fakeTokenSocket.disconnect();
  testAssert(fakeTokenRejected, 'Socket handshake with invalid token rejected');
  testAssert(fakeTokenErrorMsg.includes('Authentication failed'), `Invalid token error confirmed: "${fakeTokenErrorMsg}"`);

  // 3C: Connection with guest user ID must fail handshake
  const guestUsername = `IllegalGuest_${Date.now()}`;
  const guestUser = await createOrUpdateUser({
    id: `gst_test_${Date.now()}`,
    username: guestUsername,
    isGuest: true
  });

  const guestSocket = io(BASE_URL, {
    forceNew: true,
    auth: { token: guestUser.id },
    transports: ['websocket']
  });

  let guestRejected = false;
  let guestErrorMsg = '';
  guestSocket.on('connect_error', (err) => {
    guestRejected = true;
    guestErrorMsg = err.message;
  });

  await wait(600);
  guestSocket.disconnect();
  testAssert(guestRejected, 'Socket handshake using guest ID strictly rejected');
  testAssert(guestErrorMsg.includes('Guest access has been permanently revoked'), `Guest rejection message confirmed: "${guestErrorMsg}"`);

  // TEST 4: Verified User Creation & Mandatory Privacy Agreement Acceptance
  console.log('\n--- Test 4: Mandatory Privacy & Fair-Play Agreement Acceptance ---');
  const verifiedUsername = `TournamentPro_${Date.now()}`;
  const verifiedUser = await createOrUpdateUser({
    id: `usr_verified_${Date.now()}`,
    email: `player_${Date.now()}@gmail.com`,
    username: verifiedUsername,
    isGuest: false,
    accepted_terms: false
  });

  // Verify initial state: accepted_terms is false
  const meBeforeAgree = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${verifiedUser.id}` }
  }).then(r => r.json());
  testAssert(meBeforeAgree.profile.accepted_terms === false, 'User profile initially requires terms acceptance');

  // Accept terms via /api/auth/accept-terms
  const agreeRes = await fetch(`${BASE_URL}/api/auth/accept-terms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${verifiedUser.id}`
    }
  });
  const agreeData = await agreeRes.json();
  testAssert(agreeRes.status === 200, 'POST /api/auth/accept-terms returned 200 OK');
  testAssert(agreeData.profile.accepted_terms === true, 'Profile updated with accepted_terms: true');

  // TEST 5: Verified User Successfully Connects and Binds to Socket
  console.log('\n--- Test 5: Verified User Socket Handshake & Operations ---');
  const authedSocket = io(BASE_URL, {
    forceNew: true,
    auth: { token: verifiedUser.id },
    transports: ['websocket']
  });

  let authSuccessEmitted = false;
  let receivedProfile = null;
  authedSocket.on('auth_success', (data) => {
    authSuccessEmitted = true;
    receivedProfile = data.profile;
  });

  await wait(600);
  testAssert(authedSocket.connected, 'Verified user successfully passed handshake and established connection');
  testAssert(authSuccessEmitted, 'Server emitted auth_success for verified user');
  testAssert(receivedProfile && receivedProfile.username === verifiedUsername, 'User profile correctly bound to socket');

  // Enter matchmaking as verified user
  let queueJoined = false;
  authedSocket.on('queue_joined', () => { queueJoined = true; });
  authedSocket.emit('join_matchmaking');
  await wait(400);
  testAssert(queueJoined, 'Verified user successfully permitted into matchmaking queue');

  authedSocket.disconnect();

  console.log('\n====================================================');
  console.log(`🎯 GATE TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runMandatoryAuthGateTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
