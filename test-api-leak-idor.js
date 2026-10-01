const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

async function runApiSecurityTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING API DATA LEAK, IDOR & COOKIE TESTS');
  console.log('====================================================\n');

  // 1. Create a test user
  const email = `security_test_${Date.now()}@gmail.com`;
  const sendRes = await fetch(`${BASE_URL}/api/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username: 'SecurityTester' })
  }).then(r => r.json());

  const otp = sendRes.devCode || '123456';

  const verifyFetch = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: otp, username: 'SecurityTester' })
  });

  const setCookieHeader = verifyFetch.headers.get('set-cookie');
  const verifyData = await verifyFetch.json();
  const userId = verifyData.profile.id;

  // TEST 1: HttpOnly Cookie Verification
  console.log('--- Test 1: HttpOnly Session Cookie ---');
  assert(setCookieHeader, 'Server must set a Set-Cookie header upon authentication');
  assert(setCookieHeader.includes('HttpOnly'), 'Cookie must have HttpOnly flag (immune to F12 / document.cookie)');
  assert(setCookieHeader.includes('SameSite=Lax'), 'Cookie must have SameSite flag (CSRF protection)');
  console.log('✅ [PASS] Session token safely stored via HttpOnly SameSite cookie:', setCookieHeader.split(';')[0]);

  // TEST 2: Public Profile Data Scrubbing (Anti-Scraping / Data Leaks)
  console.log('\n--- Test 2: Public Profile Data Stripping (Anti-Scraping) ---');
  const publicRes = await fetch(`${BASE_URL}/api/users/${userId}/public`).then(r => r.json());
  assert(publicRes.success, 'Public profile fetch must succeed');
  assert.strictEqual(publicRes.profile.username, 'SecurityTester');
  assert.strictEqual(publicRes.profile.email, undefined, 'CRITICAL: Email MUST be stripped from public profile to prevent scraping!');
  assert.strictEqual(publicRes.profile.trustFactor, undefined, 'CRITICAL: Secret trustFactor MUST be stripped!');
  assert.strictEqual(publicRes.profile.password, undefined);
  assert.strictEqual(publicRes.profile.salt, undefined);
  console.log('✅ [PASS] Public profile strictly stripped: Only display data returned (email & trustFactor concealed)');

  // TEST 3: IDOR Prevention on /api/auth/me
  console.log('\n--- Test 3: IDOR & Query Parameter Impersonation Defense ---');
  // Attempting to query someone else's data via URL parameter ?userId=victim without credentials
  const idorAttempt = await fetch(`${BASE_URL}/api/auth/me?userId=${userId}`);
  assert.strictEqual(idorAttempt.status, 401, 'Server must reject unauthenticated query param impersonation with 401');
  console.log('✅ [PASS] IDOR attack blocked: /api/auth/me rejected query parameter impersonation (HTTP 401)');

  // TEST 4: Authorized Owner Access via Cookie
  console.log('\n--- Test 4: Authorized Owner Data Access via Cookie ---');
  const cookieVal = setCookieHeader.split(';')[0];
  const ownerRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { 'Cookie': cookieVal }
  }).then(r => r.json());

  assert(ownerRes.success, 'Owner fetch with HttpOnly cookie must succeed');
  assert.strictEqual(ownerRes.profile.email, email, 'Owner sees their own email');
  assert.strictEqual(ownerRes.profile.trustFactor, undefined, 'Secret trustFactor remains concealed even to owner');
  console.log('✅ [PASS] Owner authenticated securely via Cookie; received private profile with zero secret leaks');

  console.log('\n====================================================');
  console.log('🎉 ALL API SECURITY, IDOR & COOKIE TESTS PASSED (100%)');
  console.log('====================================================');
}

runApiSecurityTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
