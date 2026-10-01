const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function runHardeningTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING COMPREHENSIVE SECURITY HARDENING AUDIT');
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

  // 1. MALFORMED JSON SYNTAX HANDLING
  console.log('--- 1. Crash Prevention: Malformed JSON Payloads ---');
  const malformedRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email": "broken_json_without_closing_brace'
  });
  const malformedData = await malformedRes.json();
  testAssert(malformedRes.status === 400, 'Malformed JSON returns 400 Bad Request');
  testAssert(malformedData.error.includes('Malformed JSON payload'), 'Clean JSON error returned instead of HTML crash stack trace');

  // 2. STRICT ZOD SCHEMA VALIDATION
  console.log('\n--- 2. Zod Schema Validation & Type Assertion ---');
  // Missing required field
  const missingFieldRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'NoEmailUser' })
  });
  const missingData = await missingFieldRes.json();
  testAssert(missingFieldRes.status === 400, 'Missing email field rejected with 400');
  testAssert(missingData.error.includes('Validation Error') && missingData.error.includes('email'), 'Zod schema error details returned');

  // Invalid email format
  const badEmailRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-a-valid-email' })
  });
  const badEmailData = await badEmailRes.json();
  testAssert(badEmailRes.status === 400, 'Invalid email format rejected with 400');
  testAssert(badEmailData.error.includes('Invalid email address format'), 'Specific email format error returned');

  // Type confusion attack (passing number instead of string)
  const typeConfusionRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@gmail.com', code: 12345 }) // number instead of string
  });
  const typeConfusionData = await typeConfusionRes.json();
  testAssert(typeConfusionRes.status === 400, 'Type confusion rejected with 400');
  testAssert(typeConfusionData.error.toLowerCase().includes('expected string'), 'Zod rejected number for code field');

  // 3. CLOUDFLARE CORS & ORIGIN ISOLATION
  console.log('\n--- 3. Cloudflare Trusted Origin & CORS Isolation ---');
  // Trusted origin: trycloudflare
  const allowedOriginRes = await fetch(`${BASE_URL}/api/tunnel-info`, {
    headers: { 'Origin': 'https://confidentiality-tunes-wesley-trim.trycloudflare.com' }
  });
  testAssert(
    allowedOriginRes.headers.get('access-control-allow-origin') === 'https://confidentiality-tunes-wesley-trim.trycloudflare.com',
    'Allowed Cloudflare origin received CORS headers'
  );

  // Untrusted malicious origin
  const blockedOriginRes = await fetch(`${BASE_URL}/api/tunnel-info`, {
    headers: { 'Origin': 'https://malicious-scam-site.org' }
  });
  testAssert(
    blockedOriginRes.headers.get('access-control-allow-origin') === null,
    'Untrusted attacker origin denied CORS headers (origin isolation)'
  );

  // 4. DATABASE RACE CONDITION & ATOMIC MUTATION STRESS TEST
  console.log('\n--- 4. Atomic Database Mutations & Race Condition Immunity ---');
  const { createOrUpdateUser, recordMatchOutcome, getUserById } = require('./users');

  // Create two test players
  const tag = Date.now();
  const u1 = await createOrUpdateUser({ username: `Race_Player1_${tag}`, isGuest: true });
  const u2 = await createOrUpdateUser({ username: `Race_Player2_${tag}`, isGuest: true });

  const initialElo1 = u1.elo;
  const initialElo2 = u2.elo;

  // Fire 10 concurrent match updates simultaneously to stress test mutex / atomic queue
  const concurrentUpdates = [];
  for (let i = 0; i < 6; i++) {
    concurrentUpdates.push(
      recordMatchOutcome(u1.id, u2.id, i % 2 === 0 ? 'w' : 'b', { note: `Match ${i}` })
    );
  }

  const results = await Promise.all(concurrentUpdates);
  const finalU1 = getUserById(u1.id);
  const finalU2 = getUserById(u2.id);

  testAssert(results.length === 6, 'All 6 concurrent match updates executed cleanly without deadlocks');
  testAssert(finalU1.gamesPlayed === 6, `Player 1 accurately recorded exactly 6 games (actual: ${finalU1.gamesPlayed})`);
  testAssert(finalU2.gamesPlayed === 6, `Player 2 accurately recorded exactly 6 games (actual: ${finalU2.gamesPlayed})`);
  testAssert(finalU1.wins + finalU1.losses === 6, 'Wins + Losses perfectly add up to total games played');

  console.log('\n====================================================');
  console.log(`🎯 HARDENING AUDIT RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  process.exit(passed === total ? 0 : 1);
}

runHardeningTests().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
