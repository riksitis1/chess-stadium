const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const { createOrUpdateUser, getUserById, getUserByUsername } = require('./users');

const BASE_URL = 'http://localhost:3000';
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function testAssert(condition, message) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`✅ [PASS] ${message}`);
}

async function runUsernameTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING USERNAME UNIQUENESS & PERSISTENCE TESTS');
  console.log('====================================================\n');

  // --- Test 1: Check public/index.html placeholder does not contain "Riko" ---
  console.log('--- Test 1: Frontend Cleanliness (No "Riko" in username example) ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  testAssert(!indexHtml.toLowerCase().includes('grandmasterriko'), 'GrandmasterRiko example completely removed from index.html');
  testAssert(indexHtml.includes('placeholder="e.g. Grandmaster"'), 'Replaced with generic "e.g. Grandmaster"');

  // --- Test 2: Pre-existing user with distinct username ---
  console.log('\n--- Test 2: Database Uniqueness Enforcement (REST API) ---');
  const uniqueTag = Date.now();
  const targetUsername = `RoyalKnight_${uniqueTag}`;

  const userA = await createOrUpdateUser({
    id: `usr_playerA_${uniqueTag}`,
    email: `player_a_${uniqueTag}@gmail.com`,
    username: targetUsername,
    isGuest: false,
    accepted_terms: true
  });
  testAssert(userA && userA.username === targetUsername, `Player A successfully created with username "${targetUsername}"`);

  // Attempt to register Player B with the EXACT SAME username (POST /api/auth/send-code)
  const duplicateSendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `player_b_${uniqueTag}@gmail.com`,
      username: targetUsername // duplicate!
    })
  });
  const duplicateSendData = await duplicateSendRes.json();
  testAssert(duplicateSendRes.status === 409, `POST /api/auth/send-code rejected duplicate username with HTTP 409 Conflict (status=${duplicateSendRes.status})`);
  testAssert(duplicateSendData.success === false, 'Duplicate response flagged success: false');
  testAssert(duplicateSendData.error.includes('already taken'), `Correct error message: "${duplicateSendData.error}"`);

  // Case-insensitive duplicate check: "royalknight_..."
  const caseInsensitiveRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `player_b_${uniqueTag}@gmail.com`,
      username: targetUsername.toLowerCase() // lowercase duplicate
    })
  });
  testAssert(caseInsensitiveRes.status === 409, 'Case-insensitive duplicate username strictly rejected with HTTP 409 Conflict');

  // Original owner (Player A) CAN log in with their own email and username
  const testIp = `198.51.100.${Date.now() % 240 + 10}`;
  const ownerSendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': testIp },
    body: JSON.stringify({
      email: `player_a_${uniqueTag}@gmail.com`, // Same owner
      username: targetUsername
    })
  });
  testAssert(ownerSendRes.status === 200, 'Original owner permitted to request code with their own username');

  // Direct createOrUpdateUser collision attempt from backend
  let caughtBackendError = false;
  try {
    await createOrUpdateUser({
      id: `usr_playerB_${uniqueTag}`,
      email: `player_b_${uniqueTag}@gmail.com`,
      username: targetUsername, // duplicate!
      isGuest: false
    });
  } catch (err) {
    caughtBackendError = true;
    testAssert(err.code === 'USERNAME_TAKEN', `createOrUpdateUser threw USERNAME_TAKEN error: ${err.message}`);
  }
  testAssert(caughtBackendError, 'Direct backend mutation strictly blocked duplicate username collision');

  // --- Test 3: WebSocket set_username Uniqueness & Persistence ---
  console.log('\n--- Test 3: WebSocket set_username Uniqueness & Disk Persistence ---');
  const userB = await createOrUpdateUser({
    id: `usr_playerB_${uniqueTag}`,
    email: `player_b_${uniqueTag}@gmail.com`,
    username: `UniqueB_${uniqueTag}`,
    isGuest: false,
    accepted_terms: true
  });

  const socketB = io(BASE_URL, {
    forceNew: true,
    auth: { token: userB.id },
    transports: ['websocket']
  });

  await new Promise((resolve) => socketB.on('connect', resolve));
  testAssert(socketB.connected, 'Player B connected via authenticated socket');

  // Player B attempts to rename to Player A's username via socket
  let usernameErrorReceived = false;
  let usernameErrorMsg = '';
  socketB.on('username_error', (data) => {
    usernameErrorReceived = true;
    usernameErrorMsg = data.message;
  });

  socketB.emit('set_username', targetUsername);
  await wait(500);

  testAssert(usernameErrorReceived, 'Socket emitted "username_error" when attempting to steal Player A username');
  testAssert(usernameErrorMsg.includes('already taken'), `Socket error message confirmed: "${usernameErrorMsg}"`);

  // Verify Player B's username in memory was NOT corrupted
  const userBUnchanged = getUserById(userB.id);
  testAssert(userBUnchanged.username === `UniqueB_${uniqueTag}`, 'Player B username retained original value without corruption');

  // Now Player B renames to a valid, unique new username
  const newValidUsername = `Champion_${uniqueTag}`;
  let usernameUpdatedReceived = false;
  let updatedUsernameVal = '';
  socketB.on('username_updated', (data) => {
    usernameUpdatedReceived = true;
    updatedUsernameVal = data.username;
  });

  socketB.emit('set_username', newValidUsername);
  await wait(500);

  testAssert(usernameUpdatedReceived, 'Socket emitted "username_updated" for valid unique username');
  testAssert(updatedUsernameVal === newValidUsername, `Updated username matches: "${updatedUsernameVal}"`);

  // --- Test 4: Physical Disk Persistence Verification ---
  console.log('\n--- Test 4: Disk Persistence (users.json) Verification ---');
  const rawDisk = fs.readFileSync(USERS_FILE, 'utf8');
  const diskList = JSON.parse(rawDisk);
  const diskUserB = diskList.find(u => u.id === userB.id);

  testAssert(Boolean(diskUserB), 'Player B record found in physical users.json on disk');
  testAssert(diskUserB.username === newValidUsername, `Player B persisted username in users.json is "${diskUserB.username}"`);

  socketB.disconnect();

  console.log('\n====================================================');
  console.log('🎉 ALL USERNAME UNIQUENESS & PERSISTENCE TESTS PASSED (100%)');
  console.log('====================================================');
  process.exit(0);
}

runUsernameTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
