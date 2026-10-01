const { io } = require('socket.io-client');

console.log('♟️ Starting Pawn Promotion Verification Test...');

const p1 = io('http://localhost:3000', { auth: { token: 'usr_74657374706c6179' } });
const p2 = io('http://localhost:3000', { auth: { token: 'usr_7375706572676d40' } });

let whiteSocket = null;
let blackSocket = null;

p1.on('connect', () => {
  p1.emit('set_username', 'Promo_Tester_1');
  p1.emit('join_matchmaking');
});

p1.on('queue_joined', () => {
  p2.emit('set_username', 'Promo_Tester_2');
  p2.emit('join_matchmaking');
});

let matches = 0;
function onMatch(data, sock) {
  if (data.color === 'w') whiteSocket = sock;
  else blackSocket = sock;
  if (++matches === 2) {
    runPromo();
  }
}

p1.on('match_found', (d) => onMatch(d, p1));
p2.on('match_found', (d) => onMatch(d, p2));

async function runPromo() {
  console.log('✅ Match found, testing quick pawn race to promotion...');
  // Quick moves:
  // 1. e4 d5
  // 2. exd5 c6
  // 3. dxc6 b6
  // 4. cxb7 a5
  // 5. bxa8=Q (Promotion to Queen!)
  const promoMoves = [
    { from: 'e2', to: 'e4', isWhite: true },
    { from: 'd7', to: 'd5', isWhite: false },
    { from: 'e4', to: 'd5', isWhite: true },
    { from: 'c7', to: 'c6', isWhite: false },
    { from: 'd5', to: 'c6', isWhite: true },
    { from: 'g8', to: 'f6', isWhite: false },
    { from: 'c6', to: 'b7', isWhite: true },
    { from: 'a7', to: 'a5', isWhite: false },
    { from: 'b7', to: 'a8', promotion: 'q', isWhite: true } // Promotion!
  ];

  for (let i = 0; i < promoMoves.length; i++) {
    const m = promoMoves[i];
    const s = m.isWhite ? whiteSocket : blackSocket;

    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout on move ${m.from}->${m.to}`)), 4000);

      function handler(data) {
        if (data.move.from === m.from && data.move.to === m.to) {
          clearTimeout(timer);
          s.off('move_made', handler);
          resolve(data);
        }
      }
      s.on('move_made', handler);

      setTimeout(() => {
        s.emit('make_move', {
          from: m.from,
          to: m.to,
          promotion: m.promotion || 'q',
          telemetry: { isTrusted: true, mouseMoves: 10, isTouch: false, timestamp: Date.now() }
        });
      }, 150);
    });

    console.log(`  Move ${i + 1}: ${m.from}->${m.to} ${m.promotion ? `(=${m.promotion.toUpperCase()})` : ''} confirmed: SAN=${res.move.san}, Promotion=${res.move.promotion}`);
  }

  console.log('⭐⭐⭐ PAWN PROMOTION TEST PASSED FLAWLESSLY! ⭐⭐⭐');
  p1.disconnect();
  p2.disconnect();
  process.exit(0);
}
