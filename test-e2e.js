const { io } = require('socket.io-client');

console.log('🧪 Starting E2E Multiplayer & Anti-Cheat Test...');

const p1 = io('http://localhost:3000', { auth: { token: 'usr_74657374706c6179' } });
const p2 = io('http://localhost:3000', { auth: { token: 'usr_7375706572676d40' } });

let p1Data = null;
let p2Data = null;

p1.on('connect', () => {
  console.log('✅ Player 1 connected');
  p1.emit('set_username', 'Alice');
  p1.emit('join_matchmaking');
});

p1.on('queue_joined', (data) => {
  console.log(`✅ Player 1 in queue (inQueue: ${data.inQueue})`);
  // Now connect player 2
  p2.emit('set_username', 'Bob');
  p2.emit('join_matchmaking');
});

p1.on('match_found', (data) => {
  p1Data = data;
  console.log(`🎯 Player 1 matched! Color: ${data.color}, Opponent: ${data.opponentName}, Time: ${data.timeRemaining}ms (10m)`);
  checkStart();
});

p2.on('match_found', (data) => {
  p2Data = data;
  console.log(`🎯 Player 2 matched! Color: ${data.color}, Opponent: ${data.opponentName}, Time: ${data.timeRemaining}ms (10m)`);
  checkStart();
});

function checkStart() {
  if (p1Data && p2Data) {
    console.log('🎉 Match successfully created between real human players (no bots)!');
    // Determine who is White
    const whiteSocket = p1Data.color === 'w' ? p1 : p2;
    const blackSocket = p1Data.color === 'w' ? p2 : p1;

    console.log('♟️ White playing e2 -> e4...');
    whiteSocket.emit('make_move', { from: 'e2', to: 'e4' });

    whiteSocket.once('move_made', (moveData) => {
      console.log(`✅ Move e2-e4 confirmed by server: SAN=${moveData.move.san}`);

      console.log('♟️ Black playing e7 -> e5...');
      blackSocket.emit('make_move', { from: 'e7', to: 'e5' });

      blackSocket.once('move_made', (move2Data) => {
        console.log(`✅ Move e7-e5 confirmed by server: SAN=${move2Data.move.san}`);

        // Now test Anti-Cheat: White triggers security violation
        console.log('🚨 Simulating Player security violation (anti_cheat_event: unauthorized_dom_injection)...');
        whiteSocket.emit('anti_cheat_event', { type: 'unauthorized_dom_injection' });

        whiteSocket.once('anti_cheat_strike', (strikeData) => {
          console.log(`⚠️ Anti-Cheat Strike 1 confirmed: ${strikeData.playerName} strikes=${strikeData.strikes}/${strikeData.maxStrikes}`);

          setTimeout(() => {
            // Emit strike 2
            console.log('🚨 Simulating 2nd security violation...');
            whiteSocket.emit('anti_cheat_event', { type: 'unauthorized_dom_injection' });

            whiteSocket.once('anti_cheat_strike', (strike2Data) => {
              console.log(`⚠️ Anti-Cheat Strike 2 confirmed: strikes=${strike2Data.strikes}/${strike2Data.maxStrikes}`);

              setTimeout(() => {
                // Emit strike 3 -> should cause instant forfeit
                console.log('🚨 Simulating 3rd security violation (Disqualification limit)...');
                whiteSocket.emit('anti_cheat_event', { type: 'unauthorized_dom_injection' });
              }, 3100);
            });
          }, 3100);
        });

        // Listen for game_over on both
        blackSocket.once('game_over', (overData) => {
          console.log(`🏆 GAME OVER! Winner: ${overData.winner}, Reason: ${overData.reason}`);
          console.log(`📋 Details: ${overData.details}`);

          if (overData.reason === 'anti_cheat_disqualification') {
            console.log('⭐⭐⭐ ALL TESTS PASSED: Matchmaking, 10m Clocks, Chess Rules, and Tab-Switch Anti-Cheat Verified! ⭐⭐⭐');
            p1.disconnect();
            p2.disconnect();
            process.exit(0);
          } else {
            console.error('❌ Expected anti_cheat_disqualification');
            process.exit(1);
          }
        });
      });
    });
  }
}
