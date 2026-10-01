const { io } = require('socket.io-client');
const { createOrUpdateUser } = require('./users');

const SERVER_URL = 'http://localhost:3000';

async function connectSocket(username) {
  const user = await createOrUpdateUser({
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    username,
    isGuest: false,
    accepted_terms: true
  });

  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: user.id }
    });
    socket.on('connect', () => {
      socket.emit('set_username', username);
      resolve(socket);
    });
    socket.on('connect_error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPenetrationTests() {
  console.log('====================================================');
  console.log('🛡️ RUNNING CONSOLE / F12 EXPLOIT RESILIENCE TESTS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // TEST 1: Malformed Payloads (null, prototype pollution, type confusion)
  console.log('--- Test Suite 1: Malformed & Toxic Payloads ---');
  const s1 = await connectSocket('Attacker_Payload');

  let rejectedCount = 0;
  s1.on('move_rejected', () => { rejectedCount++; });
  s1.on('server_error', () => { rejectedCount++; });

  // Emitting malformed moves that previously caused uncaught TypeErrors
  s1.emit('make_move', null);
  s1.emit('make_move', 12345);
  s1.emit('make_move', 'drop table users;');
  s1.emit('make_move', { from: 12, to: null });
  s1.emit('make_move', { from: 'bad', to: 'coords' });
  s1.emit('make_move', { from: 'e2', to: 'e4', promotion: 'INVALID_PIECE' });
  s1.emit('join_room', null);
  s1.emit('join_room', 12345);
  s1.emit('anti_cheat_event', null);
  s1.emit('respond_draw', null);

  await delay(600);

  // Ping server to ensure it is still 100% alive
  const s2 = await connectSocket('Verifier_Socket');
  assert(s2.connected, 'Server survived all toxic payloads without crashing');
  s1.disconnect();
  s2.disconnect();

  // TEST 2: Console While(true) Loop Flood (Rate Limiter & Disconnect)
  console.log('\n--- Test Suite 2: High-Speed Console Event Flooding ---');
  const flooder = await connectSocket('Attacker_Flooder');
  let rateLimitWarning = false;
  let wasDisconnected = false;

  flooder.on('rate_limit_warning', () => {
    rateLimitWarning = true;
  });

  flooder.on('disconnect', () => {
    wasDisconnected = true;
  });

  // Flood 65 events immediately to simulate `while(true) socket.emit(...)`
  for (let i = 0; i < 65; i++) {
    flooder.emit('join_matchmaking');
  }

  await delay(600);

  assert(wasDisconnected, 'Attacker socket was forcibly disconnected for aggressive event flooding (>60 req/sec)');

  // TEST 3: State Tampering & Move Authority
  console.log('\n--- Test Suite 3: Server-Authoritative State & Rules ---');
  const p1 = await connectSocket('Player_White');
  const p2 = await connectSocket('Player_Black');

  let p1Game = null;
  let p2Game = null;

  p1.on('match_found', (data) => { p1Game = data; });
  p2.on('match_found', (data) => { p2Game = data; });

  p1.emit('join_matchmaking');
  p2.emit('join_matchmaking');

  let waited = 0;
  while ((!p1Game || !p2Game) && waited < 4000) {
    await delay(200);
    waited += 200;
  }

  assert(p1Game !== null && p2Game !== null, 'Matchmaking successfully paired players');

  const whiteSocket = p1Game.color === 'w' ? p1 : p2;
  const blackSocket = p1Game.color === 'b' ? p1 : p2;

  // Attempt A: Black tries to move on White's turn
  let blackRejected = false;
  blackSocket.once('move_rejected', (data) => {
    if (data.reason.includes('Not your turn')) blackRejected = true;
  });

  blackSocket.emit('make_move', { from: 'e7', to: 'e5' });
  await delay(300);
  assert(blackRejected, 'Server rejected Black moving on White turn (Client cannot fake turn in console)');

  // Attempt B: White tries to make illegal chess move (e.g., e2 to e5)
  let illegalRejected = false;
  whiteSocket.once('move_rejected', (data) => {
    if (data.reason.includes('Illegal move')) illegalRejected = true;
  });

  whiteSocket.emit('make_move', { from: 'e2', to: 'e5' });
  await delay(300);
  assert(illegalRejected, 'Server rejected illegal move coordinates (Client cannot move arbitrarily)');

  // Attempt C: White makes legal move (e2 to e4)
  let legalMoveMade = false;
  whiteSocket.once('move_made', (data) => {
    if (data.move.from === 'e2' && data.move.to === 'e4') legalMoveMade = true;
  });

  whiteSocket.emit('make_move', { from: 'e2', to: 'e4' });
  await delay(300);
  assert(legalMoveMade, 'Server authoritatively accepted valid move and updated game state');

  p1.disconnect();
  p2.disconnect();

  console.log('\n====================================================');
  console.log(`🎯 PENETRATION RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('====================================================');

  process.exit(passed === total ? 0 : 1);
}

runPenetrationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
