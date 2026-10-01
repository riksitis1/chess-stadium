const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAuthRateLimitTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING AUTH RATE LIMITING & BRUTE-FORCE DEFENSE TESTS');
  console.log('====================================================\n');

  // Test 1: 60-Second Email Cooldown on /api/auth/send-code
  console.log('--- Test 1: 60-Second Email Cooldown Defense ---');
  const targetEmail = `victim_${Date.now()}@gmail.com`;

  // First send: should succeed
  const res1 = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: targetEmail, username: 'PlayerOne' })
  });
  const data1 = await res1.json();
  assert.strictEqual(res1.status, 200, 'Initial send-code should return 200 OK');
  assert.strictEqual(data1.success, true, 'Initial send-code should succeed');
  console.log('✓ Initial verification code sent successfully.');

  // Immediate second send to same email: should be blocked by 60s cooldown
  const res2 = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: targetEmail, username: 'PlayerOne' })
  });
  const data2 = await res2.json();
  assert.strictEqual(res2.status, 429, 'Immediate second send must return HTTP 429 Too Many Requests');
  assert.strictEqual(data2.rateLimited, true, 'Response must flag rateLimited: true');
  assert.ok(data2.retryAfterSeconds > 0, 'Response must provide retryAfterSeconds');
  console.log(`✅ [PASS] Email spamming blocked with HTTP 429 (Cooldown: ${data2.retryAfterSeconds}s remaining).`);

  // Test 2: Verify '123456' Backdoor Bypass is Completely Removed
  console.log('\n--- Test 2: Verify Backdoor Bypass is Fully Eliminated ---');
  const bypassEmail = `secure_${Date.now()}@gmail.com`;
  await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bypassEmail, username: 'Target' })
  });

  // Try guessing with 123456
  const bypassRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bypassEmail, code: '123456', username: 'Target' })
  });
  const bypassData = await bypassRes.json();
  assert.strictEqual(bypassData.success, false, '123456 bypass must NOT succeed');
  console.log('✅ [PASS] Hardcoded backdoor token 123456 strictly rejected.');

  // Test 3: Brute-Force Password/OTP Guessing Protection & Account Lockout
  console.log('\n--- Test 3: Brute-Force Guessing Throttling & Account Lockout ---');
  const bruteEmail = `brute_target_${Date.now()}@gmail.com`;
  const codeSendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bruteEmail, username: 'BruteTarget' })
  });
  const codeSendData = await codeSendRes.json();
  const realCode = codeSendData.devCode;

  // Simulate attacker attempting wrong guesses (3-attempt threshold)
  console.log('Simulating attacker cycling through incorrect OTP guesses...');
  const fakeGuesses = ['000001', '000002'];

  for (let i = 0; i < fakeGuesses.length; i++) {
    const guessRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bruteEmail, code: fakeGuesses[i], username: 'BruteTarget' })
    });
    const guessData = await guessRes.json();
    assert.strictEqual(guessRes.status, 400);
    assert.strictEqual(guessData.attemptsRemaining, 2 - i);
    console.log(`  Guess ${i + 1} (${fakeGuesses[i]}): Rejected, ${guessData.attemptsRemaining} attempt(s) remaining.`);
  }

  // 3rd failed guess: Must trigger immediate revocation & 15-minute lockout!
  console.log('Sending 3rd failed guess (strict 3-attempt threshold limit)...');
  const guess3Res = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bruteEmail, code: '999999', username: 'BruteTarget' })
  });
  const guess3Data = await guess3Res.json();
  assert.strictEqual(guess3Res.status, 429, '3rd failed attempt must return HTTP 429 Too Many Requests');
  assert.strictEqual(guess3Data.locked, true, 'Account must be marked locked');
  assert.strictEqual(guess3Data.attemptsRemaining, 0);
  console.log('✅ [PASS] 3rd failed attempt triggered HTTP 429 & 15-minute account lockout.');

  // Even if attacker now submits the real code, it must be rejected because it was revoked!
  console.log('Testing submission of original code after lockout...');
  const postLockoutRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bruteEmail, code: realCode, username: 'BruteTarget' })
  });
  const postLockoutData = await postLockoutRes.json();
  assert.strictEqual(postLockoutRes.status, 429, 'Even correct code must be rejected with HTTP 429 after lockout');
  assert.strictEqual(postLockoutData.locked, true);
  console.log('✅ [PASS] Revoked code completely neutralized: Attacker locked out from further attempts.');

  // Attempting to request a new code while locked out must also be denied
  const sendWhileLockedRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: bruteEmail, username: 'BruteTarget' })
  });
  const sendWhileLockedData = await sendWhileLockedRes.json();
  assert.strictEqual(sendWhileLockedRes.status, 429, 'send-code must return 429 when account is locked');
  assert.strictEqual(sendWhileLockedData.locked, true);
  console.log('✅ [PASS] Code re-issuance blocked while account is under lockout.');

  // Test 4: Legitimate Login Flow Works 100% with Valid Code
  console.log('\n--- Test 4: Legitimate Login Flow with Valid Code ---');
  const legitEmail = `legit_gm_${Date.now()}@gmail.com`;
  const legitSendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: legitEmail, username: 'LegitGrandmaster' })
  });
  const legitSendData = await legitSendRes.json();
  const legitCode = legitSendData.devCode;

  const legitVerifyRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: legitEmail, code: legitCode, username: 'LegitGrandmaster' })
  });
  const legitVerifyData = await legitVerifyRes.json();
  assert.strictEqual(legitVerifyRes.status, 200, 'Valid code must return 200 OK');
  assert.strictEqual(legitVerifyData.success, true);
  assert.strictEqual(legitVerifyData.profile.username, 'LegitGrandmaster');
  console.log('✅ [PASS] Legitimate user verified and authenticated on first attempt.');

  console.log('\n====================================================');
  console.log('🎉 ALL AUTH RATE LIMITING & BRUTE-FORCE TESTS PASSED 100%');
  console.log('====================================================');
  process.exitCode = 0;
}

runAuthRateLimitTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
