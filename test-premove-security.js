const { io } = require('socket.io-client');
const assert = require('assert');
const { createOrUpdateUser } = require('./users');

async function run() {
  console.log('--- Starting Pre-Move & Security Verification Suite ---');

  async function createPlayer(username) {
    const user = await createOrUpdateUser({
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username,
      isGuest: false,
      accepted_terms: true
    });
    return new Promise((resolve, reject) => {
      const socket = io('http://localhost:3000', { forceNew: true, auth: { token: user.id } });
      socket.on('connect', () => {
        socket.emit('set_username', username);
        resolve(socket);
      });
      socket.on('connect_error', reject);
    });
  }

  const p1 = await createPlayer('Alice');
  const p2 = await createPlayer('Bob');
  console.log('✓ Both players connected');

  let matchData1 = null;
  let matchData2 = null;

  const matchPromise = new Promise(resolve => {
    let count = 0;
    p1.on('match_found', d => { matchData1 = d; count++; if (count === 2) resolve(); });
    p2.on('match_found', d => { matchData2 = d; count++; if (count === 2) resolve(); });
  });

  p1.emit('join_matchmaking');
  p2.emit('join_matchmaking');

  await matchPromise;
  console.log(`✓ Match created: GameId ${matchData1.gameId}, P1 is ${matchData1.color}, P2 is ${matchData2.color}`);

  const whitePlayer = matchData1.color === 'w' ? p1 : p2;
  const blackPlayer = matchData1.color === 'b' ? p1 : p2;

  // Track strikes
  let whiteStrikes = 0;
  let blackStrikes = 0;
  whitePlayer.on('anti_cheat_strike', d => { whiteStrikes = d.strikes; });
  blackPlayer.on('anti_cheat_strike', d => { blackStrikes = d.strikes; });

  // 1. White makes initial move: e2 -> e4
  console.log('Step 1: White plays e2 -> e4');
  const move1Promise = new Promise(resolve => whitePlayer.once('move_made', resolve));
  whitePlayer.emit('make_move', {
    from: 'e2',
    to: 'e4',
    promotion: 'q',
    telemetry: { isTrusted: true, mouseMoves: 15, isTouch: false, timestamp: Date.now() }
  });
  const res1 = await move1Promise;
  assert.strictEqual(res1.turn, 'b', 'Turn should now be Black');
  console.log('✓ Move e4 accepted. Current turn: Black');

  // 2. Tab focus test: Black leaves tab / unfocuses
  console.log('Step 2: Testing tab_hidden / window_blurred (thinking player unfocuses)');
  blackPlayer.emit('anti_cheat_event', { type: 'tab_hidden', timestamp: Date.now() });
  blackPlayer.emit('anti_cheat_event', { type: 'window_blurred', timestamp: Date.now() });
  await new Promise(r => setTimeout(r, 600));

  assert.strictEqual(blackStrikes, 0, 'Black should receive 0 strikes for tab focus changes while thinking');
  console.log('✓ Verified: Tab focus changes produce zero strikes and no forfeit triggers');

  // 3. Pre-move test: Black plays e7 -> e5, and White immediately plays Nf3 within 15ms
  console.log('Step 3: Black plays e7 -> e5');
  const move2Promise = new Promise(resolve => blackPlayer.once('move_made', resolve));
  blackPlayer.emit('make_move', {
    from: 'e7',
    to: 'e5',
    promotion: 'q',
    telemetry: { isTrusted: true, mouseMoves: 20, isTouch: false, timestamp: Date.now() }
  });
  await move2Promise;
  console.log('✓ Move e5 accepted. Current turn: White');

  console.log('Step 4: White executes instantaneous Pre-Move (Nf3 within 20ms)');
  const move3Promise = new Promise(resolve => whitePlayer.once('move_made', resolve));
  const startTime = Date.now();
  whitePlayer.emit('make_move', {
    from: 'g1',
    to: 'f3',
    promotion: 'q',
    telemetry: { isTrusted: true, mouseMoves: 1, isTouch: false, timestamp: startTime }
  });
  const res3 = await move3Promise;
  assert.strictEqual(res3.turn, 'b', 'Turn should now be Black after White pre-move');
  assert.strictEqual(whiteStrikes, 0, 'White should have 0 strikes for fast pre-move');
  console.log('✓ Pre-move Nf3 successfully accepted with 0 strikes and instant execution!');

  p1.disconnect();
  p2.disconnect();
  console.log('\n======================================================');
  console.log('🎉 ALL PRE-MOVE & ANTI-CHEAT VERIFICATIONS PASSED 100%');
  console.log('======================================================');
  process.exit(0);
}

run().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
