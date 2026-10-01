const { io } = require('socket.io-client');

console.log('🛡️ Starting Advanced Anti-Cheat Verification Suite...');

const p1 = io('http://localhost:3000');
const p2 = io('http://localhost:3000');

let p1Color = null;
let p2Color = null;

p1.on('connect', () => {
  p1.emit('set_username', 'Grandmaster_Test');
  p1.emit('join_matchmaking');
});

p1.on('queue_joined', () => {
  p2.emit('set_username', 'Challenger_Test');
  p2.emit('join_matchmaking');
});

p1.on('match_found', (data) => {
  p1Color = data.color;
  checkStart();
});

p2.on('match_found', (data) => {
  p2Color = data.color;
  checkStart();
});

function checkStart() {
  if (p1Color && p2Color) {
    const whiteSocket = p1Color === 'w' ? p1 : p2;
    const blackSocket = p1Color === 'w' ? p2 : p1;

    console.log('♟️ Normal move: White e2 -> e4...');
    whiteSocket.emit('make_move', {
      from: 'e2',
      to: 'e4',
      telemetry: { isTrusted: true, mouseMoves: 12, isTouch: false, timestamp: Date.now() }
    });

    whiteSocket.once('move_made', () => {
      console.log('✅ Move accepted with valid human telemetry.');

      // Test 1: Black sends a synthetic automated bot move (isTrusted: false)
      console.log('🤖 Simulating Automated Bot / Synthetic Event Move (isTrusted: false)...');
      blackSocket.emit('make_move', {
        from: 'e7',
        to: 'e5',
        telemetry: { isTrusted: false, mouseMoves: 0, isTouch: false, timestamp: Date.now() }
      });

      let moveRejected = false;
      let strikeReceived = false;

      blackSocket.once('move_rejected', (rej) => {
        console.log(`🛡️ Synthetic move REJECTED by server: "${rej.reason}"`);
        moveRejected = true;
        checkSyntheticPass();
      });

      blackSocket.once('anti_cheat_strike', (strike) => {
        console.log(`🛡️ Anti-Cheat Strike awarded for synthetic event: ${strike.violationName} (${strike.strikes}/${strike.maxStrikes})`);
        strikeReceived = true;
        checkSyntheticPass();
      });

      function checkSyntheticPass() {
        if (moveRejected && strikeReceived) {
          console.log('✅ TEST 1 PASSED: Synthetic Bot Events are blocked and penalized!');

          // Test 2: Inhuman speed test (<120ms move)
          console.log('⚡ Simulating Inhuman / Superhuman Speed Move (<120ms)...');
          // Make legal move immediately
          blackSocket.emit('make_move', {
            from: 'e7',
            to: 'e5',
            telemetry: { isTrusted: true, mouseMoves: 15, isTouch: false, timestamp: Date.now() }
          });

          blackSocket.once('anti_cheat_strike', (speedStrike) => {
            console.log(`🛡️ Anti-Cheat Speed Strike caught: ${speedStrike.violationName} (${speedStrike.strikes}/${speedStrike.maxStrikes})`);
            console.log('✅ TEST 2 PASSED: Superhuman speed triggered violation flag!');

            // Test 3: Log broadcast test
            console.log('📋 Simulating DOM Injection Security Alert...');
            blackSocket.emit('anti_cheat_event', { type: 'unauthorized_dom_injection' });

            whiteSocket.once('anti_cheat_log_entry', (log) => {
              console.log(`📢 Verified Security Log broadcast to both players: [${log.severity}] ${log.text}`);
              console.log('⭐⭐⭐ ALL ADVANCED ANTI-CHEAT SYSTEMS VERIFIED AND OPERATIONAL! ⭐⭐⭐');

              p1.disconnect();
              p2.disconnect();
              process.exit(0);
            });
          });
        }
      }
    });
  }
}
