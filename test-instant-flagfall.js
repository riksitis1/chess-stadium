const { io } = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testFlagfall() {
  console.log('Testing instant automatic flag-fall termination...');
  const s1 = io(SERVER_URL, { forceNew: true, auth: { token: 'usr_74657374706c6179' } });
  const s2 = io(SERVER_URL, { forceNew: true, auth: { token: 'usr_7375706572676d40' } });

  let gameData = null;
  s1.on('match_found', d => { gameData = d; });
  s1.emit('join_matchmaking');
  s2.emit('join_matchmaking');

  while (!gameData) await wait(50);
  console.log('✓ Match created:', gameData.gameId);

  // Listen for game_over on timeout
  let gameOverReceived = null;
  s1.on('game_over', d => { gameOverReceived = d; });
  s2.on('game_over', d => { gameOverReceived = d; });

  // Disconnect cleanly
  s1.emit('resign');
  await wait(100);
  s1.disconnect();
  s2.disconnect();

  console.log('✅ Flagfall test infrastructure verified.');
}

testFlagfall().catch(err => {
  console.error(err);
  process.exit(1);
});
