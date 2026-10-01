const { io } = require('socket.io-client');
const assert = require('assert');
const fs = require('fs');

async function run() {
  console.log('--- 🧪 STARTING SUPABASE AUTH, ELO & SECRET TRUST FACTOR VERIFICATION ---');

  const BASE_URL = 'http://localhost:3000';

  const testEmail1 = `player1_${Date.now()}@gmail.com`;
  const testEmail2 = `player2_${Date.now()}@gmail.com`;

  // 1. TEST SUPABASE SEND CODE
  console.log('\n[TEST 1] Dispatching Verification Code to Gmail...');
  const sendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail1, username: 'SuperGM' })
  }).then(r => r.json());

  console.log('Send Code Response:', sendRes);
  assert.strictEqual(sendRes.success, true, 'Send code should succeed');
  const testOtp = sendRes.devCode || '123456';

  // 2. TEST VERIFY CODE
  console.log(`\n[TEST 2] Verifying 6-digit OTP code (${testOtp})...`);
  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail1, code: testOtp, username: 'SuperGM' })
  }).then(r => r.json());

  console.log('Verify Response Profile:', verifyRes.profile);
  assert.strictEqual(verifyRes.success, true, 'Verify code should succeed');
  assert.strictEqual(verifyRes.profile.username, 'SuperGM');
  assert.strictEqual(verifyRes.profile.elo, 1200);
  assert.strictEqual(verifyRes.profile.trustFactor, undefined, 'Secret trustFactor must NEVER be exposed in public profile!');

  // Check persistent disk save
  const rawUsers = JSON.parse(fs.readFileSync('./data/users.json', 'utf8'));
  const savedUser = rawUsers.find(u => u.email === testEmail1);
  assert(savedUser, 'User must be saved persistently to data/users.json');
  assert.strictEqual(savedUser.elo, 1200);
  assert.strictEqual(savedUser.trustFactor, 100);
  console.log('✓ Verified: Account saved persistently with 1200 Elo & 100 Secret Trust Factor');

  // 3. TEST REAL ELO RATING UPDATE & MATCHMAKING
  console.log('\n[TEST 3] Testing Real 1v1 Elo Matchmaking & Rating Calculations...');
  
  // Register second player
  const p2Send = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail2, username: 'Challenger' })
  }).then(r => r.json());
  const p2Otp = p2Send.devCode || '123456';

  const p2Res = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail2, code: p2Otp, username: 'Challenger' })
  }).then(r => r.json());

  function createSocket(token, username) {
    return new Promise((resolve) => {
      const socket = io(BASE_URL, { forceNew: true });
      socket.on('connect', () => {
        socket.emit('auth_session', { userId: token, username });
      });
      socket.on('auth_success', () => resolve(socket));
    });
  }

  const s1 = await createSocket(verifyRes.token, 'SuperGM');
  const s2 = await createSocket(p2Res.token, 'Challenger');

  let match1 = null;
  let match2 = null;

  const matchPromise = new Promise(resolve => {
    let count = 0;
    s1.on('match_found', d => { match1 = d; count++; if (count === 2) resolve(); });
    s2.on('match_found', d => { match2 = d; count++; if (count === 2) resolve(); });
  });

  s1.emit('join_matchmaking');
  s2.emit('join_matchmaking');

  await matchPromise;
  console.log(`✓ Match Found! P1 (${match1.myElo} Elo) vs Opponent (${match1.opponentElo} Elo)`);
  assert.strictEqual(match1.myElo, 1200);
  assert.strictEqual(match1.opponentElo, 1200);

  // Play game: SuperGM resigns -> Challenger wins!
  console.log('\n[TEST 4] Game Outcome & Elo Update calculation...');
  const eloPromise = new Promise(resolve => {
    s1.on('elo_updated', resolve);
  });

  const resignSocket = match1.color === 'w' ? s1 : s2;
  resignSocket.emit('resign');

  const eloRes = await eloPromise;
  console.log('Elo Update Result:', eloRes);

  const resignColor = resignSocket === s1 ? match1.color : match2.color;
  const winnerData = resignColor === 'w' ? eloRes.black : eloRes.white;
  const loserData = resignColor === 'w' ? eloRes.white : eloRes.black;

  assert(winnerData.delta > 0, 'Winner must gain positive Elo');
  assert(loserData.delta < 0, 'Loser must lose Elo');
  assert.strictEqual(winnerData.newElo, 1200 + winnerData.delta);
  assert.strictEqual(loserData.newElo, 1200 + loserData.delta);
  console.log(`✓ Winner (${winnerData.username}) Elo: 1200 -> ${winnerData.newElo} (+${winnerData.delta})`);
  console.log(`✓ Loser (${loserData.username}) Elo: 1200 -> ${loserData.newElo} (${loserData.delta})`);

  // Verify disk persistence of new Elo ratings
  const updatedUsers = JSON.parse(fs.readFileSync('./data/users.json', 'utf8'));
  const user1OnDisk = updatedUsers.find(u => u.id === verifyRes.token);
  const expectedUser1Elo = user1OnDisk.id === winnerData.userId ? winnerData.newElo : loserData.newElo;
  assert.strictEqual(user1OnDisk.elo, expectedUser1Elo, 'Updated Elo must persist on disk');
  console.log('✓ Verified: New Elo rating saved permanently to database/disk!');

  s1.disconnect();
  s2.disconnect();

  console.log('\n===============================================================');
  console.log('🎉 ALL SUPABASE AUTH, ELO & TRUST FACTOR TESTS PASSED (100%)');
  console.log('===============================================================');
  process.exit(0);
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
