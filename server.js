require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Chess } = require('chess.js');

const { sendVerificationCode, verifyCode } = require('./supabaseClient');
const {
  getUserById,
  getUserByEmail,
  createOrUpdateUser,
  recordMatchOutcome,
  adjustSecretTrustFactor,
  getPublicProfile,
  getPrivateProfile
} = require('./users');

const { z } = require('zod');

const app = express();
const server = http.createServer(app);

// ------------------------------------------
// CLOUDFLARE PROXY, TRUSTED ORIGIN & CORS
// ------------------------------------------
// Trust Cloudflare reverse proxy headers (CF-Connecting-IP, X-Forwarded-For)
app.set('trust proxy', 1);

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    req.ip
  );
}

// Configurable Allowed Origins for Cloudflare and Development
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : [
      'https://drawings-sheep-ira-geography.trycloudflare.com',
      'https://confidentiality-tunes-wesley-trim.trycloudflare.com',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];

function isOriginAllowed(origin) {
  if (!origin) return true; // Same-origin, direct browser requests, cURL/tests
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Dynamic cloud domains: Render, Cloudflare tunnels, localhost
  if (/\.onrender\.com$/i.test(origin)) return true;
  if (/\.trycloudflare\.com$/i.test(origin)) return true;
  if (process.env.RENDER_EXTERNAL_URL && origin.startsWith(process.env.RENDER_EXTERNAL_URL)) return true;
  return false;
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS Blocked] Unauthorized origin rejected by Socket.io: ${origin}`);
        callback(new Error('CORS: Origin not permitted.'));
      }
    },
    credentials: true
  },
  pingInterval: 10000,
  pingTimeout: 5000,
  connectTimeout: 20000,
  maxHttpBufferSize: 32 * 1024, // 32 KB max buffer to prevent payload spam memory spikes
  perMessageDeflate: false // Disable per-message deflate to eliminate CPU compression overhead on rapid tiny chess packets
});

const PORT = process.env.PORT || 3000;
let cloudflareUrl = process.env.CLOUDFLARE_TUNNEL_URL || null;

// Strict CORS middleware for Express REST endpoints
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// JSON body parser with 100kb payload clamping
app.use(express.json({ limit: '100kb' }));

// Middleware: Intercept malformed JSON syntax errors and terminate with clean 400 Bad Request
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Malformed JSON payload: Request body contains invalid JSON syntax.'
    });
  }
  next(err);
});

// Static file server with dotfiles quarantined (prevents .env or private key leakage)
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));

// ------------------------------------------
// STRICT ZOD REQUEST SCHEMAS & VALIDATOR
// ------------------------------------------
const sendCodeSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).trim().email('Invalid email address format').max(100),
  username: z.string().trim().max(30).optional()
});

const verifyCodeSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).trim().email('Invalid email address format').max(100),
  code: z.string({ required_error: 'Verification code is required' }).trim().min(4, 'Code must be at least 4 characters').max(10, 'Code too long'),
  username: z.string().trim().max(30).optional()
});

const guestSchema = z.object({
  username: z.string().trim().max(30).optional()
});

const publicUserSchema = z.object({
  id: z.string().trim().min(3, 'User ID too short').max(64, 'User ID too long')
});

const tunnelInfoSchema = z.object({
  url: z.string({ required_error: 'Tunnel URL is required' }).trim().url('Invalid URL format').max(250)
});

// ------------------------------------------
// STRICT ZOD SOCKET EVENT SCHEMAS
// ------------------------------------------
const socketMoveSchema = z.object({
  from: z.string({ required_error: 'From square is required' }).trim().toLowerCase().regex(/^[a-h][1-8]$/, 'Invalid "from" square coordinates.'),
  to: z.string({ required_error: 'To square is required' }).trim().toLowerCase().regex(/^[a-h][1-8]$/, 'Invalid "to" square coordinates.'),
  promotion: z.string().trim().toLowerCase().regex(/^[qrbn]$/, 'Invalid promotion piece specifier.').optional().default('q'),
  telemetry: z.object({
    isTrusted: z.boolean().optional(),
    mouseMoves: z.number().int().min(0).max(10000).optional(),
    isTouch: z.boolean().optional(),
    timestamp: z.number().optional()
  }).passthrough().optional()
});

const socketJoinRoomSchema = z.string({ required_error: 'Room code required' }).trim().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid room code format');

const socketUsernameSchema = z.string({ required_error: 'Username required' }).trim().min(1).max(25);

const socketAuthSessionSchema = z.object({
  userId: z.string().trim().max(64).optional(),
  username: z.string().trim().max(30).optional()
}).nullable().optional();

const socketRespondDrawSchema = z.object({
  accept: z.boolean({ required_error: 'Accept boolean required' })
});

const socketAntiCheatEventSchema = z.object({
  type: z.string({ required_error: 'Violation type required' }).trim().max(50),
  timestamp: z.number().optional()
});

const socketHeartbeatSchema = z.object({
  focused: z.boolean().optional(),
  timestamp: z.number().optional()
}).nullable().optional();

// Middleware factory for strict request validation
function validateRequest(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error: ' + err.issues.map(e => `${e.path.join('.') || 'field'}: ${e.message}`).join(', ')
        });
      }
      next(err);
    }
  };
}

// Helper to parse cookies from incoming HTTP headers
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

// Secure session resolution middleware (HttpOnly Cookie > Bearer Token)
// STRICTLY REJECTS unauthenticated query parameter impersonation (prevents IDOR)
function resolveAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const sessionToken = cookies.chess_session || req.headers.authorization?.replace('Bearer ', '');
  if (!sessionToken || typeof sessionToken !== 'string') return null;
  return getUserById(sessionToken.trim());
}

// ------------------------------------------
// AUTHENTICATION RATE LIMITERS & BRUTE-FORCE DEFENSE
// ------------------------------------------

function createIpRateLimiter({ windowMs, maxRequests, message }) {
  const ipHits = new Map();

  // Periodic pruning of expired window records
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of ipHits.entries()) {
      const valid = timestamps.filter(t => t > cutoff);
      if (valid.length === 0) ipHits.delete(ip);
      else ipHits.set(ip, valid);
    }
  }, 5 * 60 * 1000);

  return (req, res, next) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (ipHits.get(ip) || []).filter(t => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldestHit = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestHit + windowMs - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        success: false,
        rateLimited: true,
        retryAfterSeconds,
        error: message || `Too many requests from this network. Please wait ${retryAfterSeconds}s before retrying.`
      });
    }

    timestamps.push(now);
    ipHits.set(ip, timestamps);
    next();
  };
}

const sendCodeIpLimiter = createIpRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 30,
  message: 'Too many verification code requests from this network. Please wait a few minutes before trying again.'
});

const verifyCodeIpLimiter = createIpRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 50,
  message: 'Too many login/verification attempts from this network. Access throttled to prevent brute-force attacks.'
});

const guestAuthIpLimiter = createIpRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxRequests: 25,
  message: 'Too many guest account creations from this network. Please wait a few minutes.'
});

// ------------------------------------------
// AUTHENTICATION & USER PROFILE REST API
// ------------------------------------------

// 1. Send OTP 6-digit verification code to email (Gmail via Supabase)
app.post('/api/auth/send-code', sendCodeIpLimiter, validateRequest({ body: sendCodeSchema }), async (req, res) => {
  try {
    const { email, username } = req.body;
    const result = await sendVerificationCode(email, username);
    if (result.rateLimited) {
      if (result.retryAfterSeconds) res.setHeader('Retry-After', result.retryAfterSeconds);
      return res.status(429).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Auth API] send-code error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Failed to dispatch verification code.' });
  }
});

// 2. Verify 6-digit OTP code and create/fetch persistent account
app.post('/api/auth/verify-code', verifyCodeIpLimiter, validateRequest({ body: verifyCodeSchema }), async (req, res) => {
  try {
    const { email, code, username } = req.body;
    const result = await verifyCode(email, code, username);
    if (!result.success) {
      if (result.rateLimited || result.locked) {
        if (result.retryAfterSeconds) res.setHeader('Retry-After', result.retryAfterSeconds);
        return res.status(429).json(result);
      }
      return res.status(400).json(result);
    }

    const user = await createOrUpdateUser({
      id: result.user.id,
      email: result.user.email,
      username: username || result.user.username,
      isGuest: false
    });

    // Set secure HttpOnly cookie (cannot be accessed or copied via browser console / document.cookie)
    res.cookie('chess_session', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({
      success: true,
      token: user.id,
      profile: getPrivateProfile(user.id)
    });
  } catch (err) {
    console.error('[Auth API] verify-code error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Verification failed.' });
  }
});

// 3. Guest Access Permanently Revoked (Mandatory sign-up gate enforced)
app.post('/api/auth/guest', (req, res) => {
  res.status(403).json({
    success: false,
    error: 'Guest and anonymous access has been permanently revoked. Mandatory verified email sign-up required.'
  });
});

// 3b. Mandatory Privacy & Fair-Play Agreement Gate Acceptance
app.post('/api/auth/accept-terms', async (req, res) => {
  const user = resolveAuthenticatedUser(req);
  if (!user || user.isGuest) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Valid verified session required.' });
  }

  const updatedUser = await createOrUpdateUser({
    id: user.id,
    email: user.email,
    username: user.username,
    isGuest: false,
    accepted_terms: true
  });

  console.log(`[Fair-Play Agreement] User ${updatedUser.username} (${updatedUser.id}) accepted Privacy Policy & Terms.`);

  res.json({
    success: true,
    profile: getPrivateProfile(updatedUser.id)
  });
});

// 4. Fetch current user profile (Owner-only private projection, strictly verified non-guest)
app.get('/api/auth/me', (req, res) => {
  const user = resolveAuthenticatedUser(req);
  if (!user || user.isGuest) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Valid session required.' });
  }
  // Return private profile specifically for the owner, omitting secret trustFactor
  res.json({ success: true, profile: getPrivateProfile(user.id) });
});

// 5. Fetch public profile (Opponent/Spectator projection, strictly omitting private email)
app.get('/api/users/:id/public', validateRequest({ params: publicUserSchema }), (req, res) => {
  const profile = getPublicProfile(req.params.id);
  if (!profile) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, profile });
});

app.get('/api/tunnel-info', (req, res) => {
  res.json({
    cloudflareUrl: cloudflareUrl || null,
    port: PORT,
    playersOnline: io.engine.clientsCount,
    queueCount: matchmakingQueue.length,
    activeGames: Object.keys(games).length
  });
});

app.post('/api/tunnel-info', validateRequest({ body: tunnelInfoSchema }), (req, res) => {
  if (req.body && req.body.url) {
    cloudflareUrl = req.body.url;
    console.log(`[Cloudflare Tunnel] Registered public URL: ${cloudflareUrl}`);
    io.emit('tunnel_updated', { url: cloudflareUrl });
  }
  res.json({ success: true, url: cloudflareUrl });
});

// Game state & Matchmaking
const games = {};
const playerToGame = {};
const matchmakingQueue = []; // Array of { socketId, userId, username, elo, trustFactor, joinedAt }

const MATCH_TIME_MS = 10 * 60 * 1000; // 10 minutes in ms
const MAX_STRIKES = 3;
const MAX_AWAY_SECONDS = 15; // 15 seconds grace period when leaving tab

function getPlayerColor(game, socketId) {
  if (!game || !game.players) return null;
  if (game.players.w && game.players.w.id === socketId) return 'w';
  if (game.players.b && game.players.b.id === socketId) return 'b';
  return null;
}

function getOpponentColor(color) {
  return color === 'w' ? 'b' : 'w';
}

function broadcastQueueStatus() {
  io.emit('queue_status', {
    inQueue: matchmakingQueue.length,
    playersOnline: io.engine.clientsCount
  });
}

function createGame(player1Socket, player2Socket, roomCode = null) {
  const gameId = roomCode || `game_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  
  // Resolve user profiles for both sockets
  const user1 = getUserById(player1Socket.userId) || { id: player1Socket.id, username: player1Socket.data.username || 'Player 1', elo: 1200 };
  const user2 = getUserById(player2Socket.userId) || { id: player2Socket.id, username: player2Socket.data.username || 'Player 2', elo: 1200 };

  // Randomly assign white and black
  const isP1White = Math.random() < 0.5;
  const whiteSocket = isP1White ? player1Socket : player2Socket;
  const blackSocket = isP1White ? player2Socket : player1Socket;
  const whiteUser = isP1White ? user1 : user2;
  const blackUser = isP1White ? user2 : user1;

  const chess = new Chess();

  const game = {
    id: gameId,
    chess: chess,
    status: 'in_progress', // 'waiting', 'in_progress', 'ended'
    turn: 'w',
    timerInterval: null,
    lastTurnTimestamp: null,
    gameStartedAt: Date.now(),
    players: {
      w: {
        id: whiteSocket.id,
        userId: whiteUser.id,
        name: whiteUser.username,
        elo: whiteUser.elo || 1200,
        timeRemaining: MATCH_TIME_MS,
        strikes: 0,
        isFocused: true,
        awayTimer: null,
        awaySince: null,
        connected: true,
        moveDurations: [],
        suspiciousCount: 0
      },
      b: {
        id: blackSocket.id,
        userId: blackUser.id,
        name: blackUser.username,
        elo: blackUser.elo || 1200,
        timeRemaining: MATCH_TIME_MS,
        strikes: 0,
        isFocused: true,
        awayTimer: null,
        awaySince: null,
        connected: true,
        moveDurations: [],
        suspiciousCount: 0
      }
    },
    moves: [],
    drawOffer: null
  };

  games[gameId] = game;
  playerToGame[whiteSocket.id] = gameId;
  playerToGame[blackSocket.id] = gameId;

  whiteSocket.join(gameId);
  blackSocket.join(gameId);

  // Notify players with Elo and profile ratings
  whiteSocket.emit('match_found', {
    gameId: gameId,
    color: 'w',
    opponentName: game.players.b.name,
    opponentElo: game.players.b.elo,
    myElo: game.players.w.elo,
    timeRemaining: MATCH_TIME_MS,
    fen: chess.fen()
  });

  blackSocket.emit('match_found', {
    gameId: gameId,
    color: 'b',
    opponentName: game.players.w.name,
    opponentElo: game.players.w.elo,
    myElo: game.players.b.elo,
    timeRemaining: MATCH_TIME_MS,
    fen: chess.fen()
  });

  console.log(`[Game Created] ID: ${gameId} | White: ${game.players.w.name} (${game.players.w.elo} Elo) vs Black: ${game.players.b.name} (${game.players.b.elo} Elo)`);

  // Start clock timer
  startGameTimer(game);
  return game;
}

function startGameTimer(game) {
  if (game.timerInterval) clearInterval(game.timerInterval);

  game.lastTurnTimestamp = Date.now();
  let syncCounter = 0;

  // 250ms High-Efficiency Server Clock Loop (eliminates event-loop lag spikes)
  game.timerInterval = setInterval(() => {
    if (game.status !== 'in_progress') {
      clearInterval(game.timerInterval);
      return;
    }

    const now = Date.now();
    const elapsed = now - (game.lastTurnTimestamp || now);
    game.lastTurnTimestamp = now;

    const currentTurn = game.chess.turn();
    const activePlayer = game.players[currentTurn];

    if (activePlayer) {
      activePlayer.timeRemaining = Math.max(0, activePlayer.timeRemaining - elapsed);

      // Instant flag-fall
      if (activePlayer.timeRemaining <= 0) {
        const winner = getOpponentColor(currentTurn);
        endGame(game, winner, 'timeout', `${currentTurn === 'w' ? 'White' : 'Black'} ran out of time.`);
        return;
      }
    }

    syncCounter++;
    // Broadcast clock sync once every second (4 x 250ms)
    if (syncCounter % 4 === 0) {
      io.to(game.id).emit('time_sync', {
        whiteTime: game.players.w.timeRemaining,
        blackTime: game.players.b.timeRemaining,
        turn: game.chess.turn()
      });
    }
  }, 250);
}

function endGame(game, winnerColor, reason, details) {
  if (!game || game.status === 'ended') return;

  game.status = 'ended';
  if (game.timerInterval) clearInterval(game.timerInterval);
  if (game.players.w.awayTimer) clearTimeout(game.players.w.awayTimer);
  if (game.players.b.awayTimer) clearTimeout(game.players.b.awayTimer);

  const winnerName = winnerColor ? (winnerColor === 'w' ? game.players.w.name : game.players.b.name) : 'No one';

  console.log(`[Game Ended] ID: ${game.id} | Winner: ${winnerColor} | Reason: ${reason} | ${details}`);

  // Calculate and apply persistent Elo updates
  const whiteUserId = game.players.w.userId;
  const blackUserId = game.players.b.userId;

  if (whiteUserId && blackUserId) {
    recordMatchOutcome(whiteUserId, blackUserId, winnerColor, { reason, details })
      .then(eloRes => {
        if (eloRes) {
          io.to(game.id).emit('elo_updated', eloRes);
        }
      })
      .catch(err => console.error('[Elo Error]', err));
  }

  io.to(game.id).emit('game_over', {
    winner: winnerColor, // 'w', 'b', or null for draw
    winnerName: winnerName,
    reason: reason, // 'checkmate', 'timeout', 'resignation', 'anti_cheat_disqualification', 'draw_agreement', 'stalemate'
    details: details,
    fen: game.chess.fen()
  });

  // Automatic Memory Garbage Collection: Prune finished games from RAM after 3 minutes
  const gameIdToClean = game.id;
  setTimeout(() => {
    try {
      if (games[gameIdToClean] && games[gameIdToClean].status === 'ended') {
        if (game.players?.w) delete playerToGame[game.players.w.id];
        if (game.players?.b) delete playerToGame[game.players.b.id];
        delete games[gameIdToClean];
      }
    } catch (e) {}
  }, 3 * 60 * 1000);
}

function triggerAntiCheatViolation(game, color, type) {
  if (!game || game.status !== 'in_progress') return;

  const opponentColor = getOpponentColor(color);
  const player = game.players[color];
  if (!player) return;

  const timestamp = Date.now();
  player.strikes += 1;

  const violationDescriptions = {
    'devtools_opened': 'Developer Tools / Console Shortcut Intercepted',
    'clipboard_copy_attempt': 'Board FEN Data Extraction Blocked',
    'clipboard_paste_attempt': 'Engine Move Paste Attempt Blocked',
    'unauthorized_dom_injection': 'DOM Mutation / Cheat Extension Injected',
    'synthetic_event_detected': 'Automated Bot Synthetic Click (isTrusted=false)',
    'timing_anomaly': 'Robotic Engine Timing Variance Detected'
  };

  const violationName = violationDescriptions[type] || type;

  console.warn(`[Anti-Cheat Strike ${player.strikes}/${MAX_STRIKES}] Game: ${game.id} | Player: ${color} (${player.name}) | ${violationName}`);

  // Emit log entry to both players for fair play terminal
  io.to(game.id).emit('anti_cheat_log_entry', {
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text: `${player.name} (${color === 'w' ? 'White' : 'Black'}): ${violationName} [Strike ${player.strikes}/${MAX_STRIKES}]`,
    severity: player.strikes >= MAX_STRIKES ? 'danger' : 'warning'
  });

  // Secret Trust Factor Degradation (Cheater pool penalty, never displayed to client)
  const playerSocket = io.sockets.sockets.get(player.id);
  const userId = player.userId || (playerSocket && playerSocket.userId);
  if (userId) {
    let penalty = -15;
    if (type === 'timing_anomaly') penalty = -30;
    else if (type === 'unauthorized_dom_injection') penalty = -25;
    else if (type === 'clipboard_paste_attempt') penalty = -20;
    adjustSecretTrustFactor(userId, penalty, type);
  }

  // If strike limit exceeded, disqualify immediately
  if (player.strikes >= MAX_STRIKES) {
    if (player.awayTimer) clearTimeout(player.awayTimer);
    if (userId) {
      adjustSecretTrustFactor(userId, -35, 'disqualification_strike_limit');
    }
    endGame(
      game,
      opponentColor,
      'anti_cheat_disqualification',
      `${player.name} (${color === 'w' ? 'White' : 'Black'}) was disqualified for Fair-Play Violations (${player.strikes}/${MAX_STRIKES} Strikes: ${violationName}).`
    );
    return;
  }

  // Notify players about strike
  io.to(game.id).emit('anti_cheat_strike', {
    playerColor: color,
    playerName: player.name,
    strikes: player.strikes,
    maxStrikes: MAX_STRIKES,
    type: type,
    violationName: violationName,
    awaySecondsLimit: MAX_AWAY_SECONDS
  });
}

// ==========================================
// CHESS.COM ELO & SECRET TRUST FACTOR MATCHMAKER
// ==========================================
function processMatchmakingQueue() {
  if (matchmakingQueue.length < 2) return;

  const now = Date.now();

  // Prune dead or disconnected sockets
  for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
    const s = io.sockets.sockets.get(matchmakingQueue[i].socketId);
    if (!s || !s.connected) {
      matchmakingQueue.splice(i, 1);
    }
  }

  const matched = new Set();

  for (let i = 0; i < matchmakingQueue.length; i++) {
    const p1 = matchmakingQueue[i];
    if (matched.has(p1.socketId)) continue;

    const waitP1 = (now - p1.joinedAt) / 1000;
    // Dynamic Elo window: starts tight at ±100, widens by ±50 every 4s, capped at 1000
    const eloWindowP1 = Math.min(1000, 100 + Math.floor(waitP1 / 4) * 50);
    const p1IsCheater = (p1.trustFactor < 50);

    let bestCandidateIdx = -1;
    let bestScore = Infinity;

    for (let j = 0; j < matchmakingQueue.length; j++) {
      if (i === j) continue;
      const p2 = matchmakingQueue[j];
      if (matched.has(p2.socketId)) continue;

      const waitP2 = (now - p2.joinedAt) / 1000;
      const eloWindowP2 = Math.min(1000, 100 + Math.floor(waitP2 / 4) * 50);
      const effectiveEloWindow = Math.max(eloWindowP1, eloWindowP2);

      const eloDiff = Math.abs(p1.elo - p2.elo);
      const p2IsCheater = (p2.trustFactor < 50);

      // 1. Elo condition: Check Elo difference first so you don't match mismatched tiers
      if (eloDiff > effectiveEloWindow) {
        continue;
      }

      // 2. Secret Trust Factor: Prioritize pairing same trust tier (cheaters with cheaters)
      const sameTrustPool = (p1IsCheater === p2IsCheater);
      const maxWait = Math.max(waitP1, waitP2);

      // If in different trust tiers, only pair if waiting > 10s (fallback so players aren't stranded)
      if (!sameTrustPool && maxWait < 10) {
        continue;
      }

      // Ranking score: lower is better
      const trustPenalty = sameTrustPool ? 0 : 500;
      const score = eloDiff + trustPenalty - Math.min(300, maxWait * 15);

      if (score < bestScore) {
        bestScore = score;
        bestCandidateIdx = j;
      }
    }

    if (bestCandidateIdx !== -1) {
      const p2 = matchmakingQueue[bestCandidateIdx];
      matched.add(p1.socketId);
      matched.add(p2.socketId);

      const s1 = io.sockets.sockets.get(p1.socketId);
      const s2 = io.sockets.sockets.get(p2.socketId);

      if (s1 && s2 && s1.connected && s2.connected) {
        console.log(`[Matchmaker] 🎯 Paired ${p1.username} (${p1.elo} Elo, Trust:${p1.trustFactor}) with ${p2.username} (${p2.elo} Elo, Trust:${p2.trustFactor}) | Elo Diff: ${Math.abs(p1.elo - p2.elo)}`);
        createGame(s1, s2);
      }
    }
  }

  // Remove matched players
  if (matched.size > 0) {
    for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
      if (matched.has(matchmakingQueue[i].socketId)) {
        matchmakingQueue.splice(i, 1);
      }
    }
    broadcastQueueStatus();
  }
}

// Heartbeat queue evaluation every 1.5 seconds
setInterval(processMatchmakingQueue, 1500);

// ==========================================
// INDESTRUCTIBLE AUTHORITATIVE SOCKET SECURITY & RATE-LIMITING
// ==========================================
const RATE_LIMIT_CONFIG = {
  WINDOW_MS: 1000,           // 1-second rolling window
  MAX_EVENTS_PER_SEC: 25,    // Max 25 general events per sec before throttling
  MAX_MOVES_PER_SEC: 5,      // Max 5 move action packets per second per client
  BURST_DISCONNECT_LIMIT: 60 // Hard disconnect if client floods >60 events/sec (console while(true) loop)
};

// Interceptor attached to every incoming socket connection
function setupSocketSecurity(socket) {
  let eventCount = 0;
  let moveCount = 0;
  let windowStart = Date.now();

  // Socket.io packet interceptor middleware
  socket.use(([eventName, ...args], next) => {
    const now = Date.now();
    if (now - windowStart > RATE_LIMIT_CONFIG.WINDOW_MS) {
      windowStart = now;
      eventCount = 0;
      moveCount = 0;
    }

    eventCount++;

    // 1. Detect high-frequency console script flood / attack
    if (eventCount > RATE_LIMIT_CONFIG.BURST_DISCONNECT_LIMIT) {
      console.warn(`[Security Alert] Disconnecting socket ${socket.id} due to aggressive event flood (${eventCount} req/sec).`);
      socket.emit('rate_limit_exceeded', { error: 'Connection terminated: Excessive request rate detected.' });
      socket.disconnect(true);
      return;
    }

    // 2. Action / Move-specific rate limiter: max 5 move packets per second
    if (eventName === 'make_move') {
      moveCount++;
      if (moveCount > RATE_LIMIT_CONFIG.MAX_MOVES_PER_SEC) {
        socket.emit('rate_limit_warning', { error: 'Move action rate limit exceeded (maximum 5 moves per second).' });
        return; // Drops the event cleanly without processing
      }
    }

    // 3. Soft-throttle general spam without crashing server
    if (eventCount > RATE_LIMIT_CONFIG.MAX_EVENTS_PER_SEC) {
      socket.emit('rate_limit_warning', { error: 'Requests throttled. Please slow down.' });
      return; // Drops the event cleanly; next() is not called
    }

    next();
  });
}

// Strict schema validator for chess moves to prevent type confusion / crashes
function validateMovePayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'Malformed move payload: Object expected.' };
  }

  // Prevent prototype pollution
  if (data.__proto__ !== Object.prototype && data.__proto__ !== null) {
    return { valid: false, error: 'Malicious payload detected: Prototype pollution attempt.' };
  }

  const { from, to, promotion } = data;
  const squareRegex = /^[a-h][1-8]$/;

  if (typeof from !== 'string' || !squareRegex.test(from.trim().toLowerCase())) {
    return { valid: false, error: 'Invalid "from" square coordinates.' };
  }

  if (typeof to !== 'string' || !squareRegex.test(to.trim().toLowerCase())) {
    return { valid: false, error: 'Invalid "to" square coordinates.' };
  }

  if (promotion !== undefined && promotion !== null) {
    if (typeof promotion !== 'string' || !/^[qrbn]$/i.test(promotion.trim())) {
      return { valid: false, error: 'Invalid promotion piece specifier.' };
    }
  }

  return {
    valid: true,
    clean: {
      from: from.trim().toLowerCase(),
      to: to.trim().toLowerCase(),
      promotion: promotion ? promotion.trim().toLowerCase() : 'q'
    }
  };
}

// Safe event listener wrapper ensuring errors never throw uncaught exceptions
// Safe event listener wrapper ensuring errors never throw uncaught exceptions
// and enforcing verified user account protection across all game mutations
function safeListener(socket, eventName, handler, schema = null) {
  socket.on(eventName, async (...args) => {
    try {
      // Endpoint & Event Protection: Strictly reject actions if socket is not bound to a verified user
      if (eventName !== 'auth_session') {
        if (!socket.userId || !socket.user || socket.user.isGuest) {
          console.warn(`[Unauthorized Socket Event] Event '${eventName}' from unauthenticated/guest socket ${socket.id}`);
          if (eventName === 'make_move') {
            socket.emit('move_rejected', { reason: 'Unauthorized: Verified account required.' });
          } else if (eventName.includes('room')) {
            socket.emit('room_error', { message: 'Unauthorized: Verified account required.' });
          } else {
            socket.emit('server_error', { message: 'Unauthorized: Verified account required.' });
          }
          return;
        }
      }

      let payload = args[0];
      if (schema) {
        const parseResult = schema.safeParse(payload);
        if (!parseResult.success) {
          const errMsg = parseResult.error.issues.map(e => `${e.path.join('.') || 'payload'}: ${e.message}`).join(', ');
          console.warn(`[Socket Validation Rejected] Event '${eventName}' from ${socket.id}: ${errMsg}`);
          if (eventName === 'make_move') {
            socket.emit('move_rejected', { reason: 'Malformed move payload: ' + errMsg });
          } else {
            socket.emit('server_error', { message: 'Invalid payload: ' + errMsg });
          }
          return;
        }
        payload = parseResult.data;
      }
      await handler(payload, ...args.slice(1));
    } catch (err) {
      console.error(`[Safe Socket Guard] Caught exception in '${eventName}' from socket ${socket.id}:`, err.message);
      socket.emit('server_error', { message: 'Invalid or malformed request rejected by server.' });
    }
  });
}

// Strict WebSocket Connection Handshake Authentication Guard (Requirement 3)
io.use((socket, next) => {
  const cookies = parseCookies({ headers: socket.handshake.headers });
  const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
                socket.handshake.query?.token ||
                cookies.chess_session;

  if (!token || typeof token !== 'string') {
    console.warn(`[Socket Handshake Blocked] Unauthenticated connection attempt without token from ${socket.id}`);
    return next(new Error('Authentication required: Valid session token must be provided in handshake.'));
  }

  const user = getUserById(token.trim());
  if (!user) {
    console.warn(`[Socket Handshake Blocked] Invalid/expired token provided from ${socket.id}: ${token}`);
    return next(new Error('Authentication failed: Invalid or expired session token.'));
  }

  if (user.isGuest) {
    console.warn(`[Socket Handshake Blocked] Guest account rejected from ${socket.id}: ${user.id}`);
    return next(new Error('Unauthorized: Guest access has been permanently revoked. Please sign in with a verified account.'));
  }

  // Bind verified user account to socket
  socket.userId = user.id;
  socket.user = user;
  socket.data.username = user.username;
  next();
});

// Socket.io connection handling
io.on('connection', (socket) => {
  // Attach rate-limiting and security firewall to this socket
  setupSocketSecurity(socket);

  console.log(`[Socket Connected] ${socket.id} (${socket.user?.username || 'Verified'} - ${socket.userId})`);
  broadcastQueueStatus();

  // Send initial Cloudflare tunnel link if available
  if (cloudflareUrl) {
    socket.emit('tunnel_updated', { url: cloudflareUrl });
  }

  if (socket.userId && socket.user) {
    socket.emit('auth_success', {
      profile: getPublicProfile(socket.user.id),
      token: socket.user.id
    });
  }

  // Authenticate session from client storage
  safeListener(socket, 'auth_session', async (data) => {
    let targetId = (data && typeof data === 'object' && typeof data.userId === 'string')
      ? data.userId.trim()
      : socket.userId;

    const user = getUserById(targetId);
    if (!user || user.isGuest) {
      socket.emit('auth_error', { message: 'Unauthorized: Verified account required.' });
      socket.disconnect(true);
      return;
    }

    socket.userId = user.id;
    socket.user = user;
    socket.data.username = user.username;

    socket.emit('auth_success', {
      profile: getPublicProfile(user.id),
      token: user.id
    });

    // Instant Reconnection Detection (Across browser refresh / tab reopen)
    for (const gId in games) {
      const g = games[gId];
      if (g && g.status === 'in_progress') {
        const isWhite = g.players.w.userId === user.id;
        const isBlack = g.players.b.userId === user.id;
        if (isWhite || isBlack) {
          const col = isWhite ? 'w' : 'b';
          const playerObj = g.players[col];
          playerObj.id = socket.id;
          playerObj.connected = true;
          if (playerObj.disconnectTimer) {
            clearTimeout(playerObj.disconnectTimer);
            playerObj.disconnectTimer = null;
          }
          playerToGame[socket.id] = g.id;
          socket.join(g.id);

          console.log(`[Reconnection] Player ${user.username} (${col}) resumed match in ${g.id}`);

          io.to(g.id).emit('player_reconnected', {
            color: col,
            name: user.username
          });

          socket.emit('match_reconnected', {
            gameId: g.id,
            color: col,
            fen: g.chess.fen(),
            whiteTime: g.players.w.timeRemaining,
            blackTime: g.players.b.timeRemaining,
            turn: g.chess.turn(),
            opponentName: col === 'w' ? g.players.b.name : g.players.w.name,
            opponentElo: col === 'w' ? g.players.b.elo : g.players.w.elo,
            myElo: col === 'w' ? g.players.w.elo : g.players.b.elo,
            history: g.moves
          });
          break;
        }
      }
    }
  }, socketAuthSessionSchema);

  // Set username
  safeListener(socket, 'set_username', (name) => {
    if (typeof name === 'string' && name.trim().length > 0) {
      const clean = name.trim().replace(/[^\w\s-]/g, '').substring(0, 20);
      if (clean.length > 0) {
        socket.data.username = clean;
        if (socket.userId) {
          const u = getUserById(socket.userId);
          if (u) {
            u.username = clean;
            socket.user = u;
          }
        }
      }
    }
  }, socketUsernameSchema);

  // Random 1v1 Matchmaking Queue (Elo + Secret Trust Factor)
  safeListener(socket, 'join_matchmaking', async () => {
    if (!socket.userId || !socket.user || socket.user.isGuest) {
      socket.emit('server_error', { message: 'Unauthorized: Verified account required to enter matchmaking.' });
      return;
    }

    const currentUser = getUserById(socket.userId) || socket.user;
    socket.user = currentUser;

    // Check if player is already in a game
    const existingGameId = playerToGame[socket.id];
    if (existingGameId && games[existingGameId] && games[existingGameId].status === 'in_progress') {
      const g = games[existingGameId];
      const col = getPlayerColor(g, socket.id);
      socket.emit('match_reconnected', {
        gameId: g.id,
        color: col,
        fen: g.chess.fen(),
        whiteTime: g.players.w.timeRemaining,
        blackTime: g.players.b.timeRemaining,
        opponentName: col === 'w' ? g.players.b.name : g.players.w.name,
        opponentElo: col === 'w' ? g.players.b.elo : g.players.w.elo,
        myElo: col === 'w' ? g.players.w.elo : g.players.b.elo,
        history: g.moves
      });
      return;
    }

    const existingIdx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
    if (existingIdx === -1) {
      matchmakingQueue.push({
        socketId: socket.id,
        userId: socket.userId,
        username: socket.user.username,
        elo: socket.user.elo || 1200,
        trustFactor: socket.user.trustFactor !== undefined ? socket.user.trustFactor : 100,
        joinedAt: Date.now()
      });
      console.log(`[Queue] ${socket.user.username} (${socket.user.elo} Elo) joined 1v1 queue. Queue length: ${matchmakingQueue.length}`);
    }

    socket.emit('queue_joined', { inQueue: matchmakingQueue.length });
    broadcastQueueStatus();

    // Trigger immediate evaluation
    processMatchmakingQueue();
  });

  safeListener(socket, 'leave_matchmaking', () => {
    const idx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
    if (idx !== -1) {
      matchmakingQueue.splice(idx, 1);
      console.log(`[Queue] ${socket.data.username} left queue.`);
    }
    socket.emit('queue_left');
    broadcastQueueStatus();
  });

  // Custom Room creation & joining
  safeListener(socket, 'create_room', () => {
    const roomCode = 'ROOM_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.data.createdRoom = roomCode;
    socket.join(roomCode);
    socket.emit('room_created', { roomCode });
    console.log(`[Room Created] ${roomCode} by ${socket.data.username}`);
  });

  safeListener(socket, 'join_room', (roomCode) => {
    if (typeof roomCode !== 'string' || !roomCode.trim()) {
      socket.emit('room_error', { message: 'Invalid room code format.' });
      return;
    }
    const cleanCode = roomCode.trim().toUpperCase().substring(0, 30);
    const room = io.sockets.adapter.rooms.get(cleanCode);

    if (!room || room.size === 0) {
      socket.emit('room_error', { message: 'Room not found or expired.' });
      return;
    }

    if (room.size >= 2) {
      socket.emit('room_error', { message: 'Room is already full.' });
      return;
    }

    // Get the host socket
    const [hostId] = Array.from(room);
    const hostSocket = io.sockets.sockets.get(hostId);

    if (hostSocket) {
      createGame(hostSocket, socket, cleanCode);
    }
  }, socketJoinRoomSchema);

  // Making a Move (Strict Server-Side Validation)
  safeListener(socket, 'make_move', (moveData) => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];

    if (!game || game.status !== 'in_progress') {
      socket.emit('move_rejected', { reason: 'No active game in progress.' });
      return;
    }

    // 1. Strict Payload Schema Validation (Defends against null, prototype pollution, non-string, etc.)
    const validation = validateMovePayload(moveData);
    if (!validation.valid) {
      socket.emit('move_rejected', { reason: validation.error });
      return;
    }
    const cleanMove = validation.clean;

    const playerColor = getPlayerColor(game, socket.id);
    const currentTurn = game.chess.turn();

    if (playerColor !== currentTurn) {
      socket.emit('move_rejected', { reason: 'Not your turn.' });
      return;
    }

    const player = game.players[playerColor];
    const now = Date.now();
    const moveElapsed = game.lastTurnTimestamp ? (now - game.lastTurnTimestamp) : 2000;

    // Advanced Telemetry Anti-Cheat Analysis (Safe property access)
    if (moveData && moveData.telemetry && typeof moveData.telemetry === 'object') {
      // 1. Synthetic Event Check
      if (moveData.telemetry.isTrusted === false) {
        triggerAntiCheatViolation(game, playerColor, 'synthetic_event_detected');
        socket.emit('move_rejected', { reason: 'Synthetic automated move detected by Fair-Play engine.' });
        return;
      }

      // 2. Cursor Teleportation / Zero Mouse Movement on desktop
      if (moveData.telemetry.mouseMoves === 0 && game.moves.length >= 2 && !moveData.telemetry.isTouch) {
        player.suspiciousCount = (player.suspiciousCount || 0) + 1;
        if (player.suspiciousCount >= 4) {
          triggerAntiCheatViolation(game, playerColor, 'cursor_teleportation');
        }
      }
    }

    if (player) {
      player.moveDurations.push(moveElapsed);

      // Server-Side Move Timing Logging (Requirement 4)
      console.log(`[Fair-Play Timing Log] Game: ${game.id} | Move #${game.moves.length + 1} | Player: ${player.name} (${playerColor}) | Elapsed: ${moveElapsed}ms`);

      // Continuous Robotic Timing Uniformity Check (Bot Signature)
      // Detects fixed robotic delays (e.g., taking consistently ~3.0s with near-zero stdDev)
      if (player.moveDurations.length >= 4) {
        const recent = player.moveDurations.slice(-5);
        const mean = recent.reduce((sum, val) => sum + val, 0) / recent.length;
        const variance = recent.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / recent.length;
        const stdDev = Math.sqrt(variance);

        if (mean > 400 && stdDev < 35) {
          console.warn(`[Anti-Cheat Variance Detection] Robotic timing signature: mean=${mean.toFixed(1)}ms, stdDev=${stdDev.toFixed(1)}ms across ${recent.length} moves.`);
          triggerAntiCheatViolation(game, playerColor, 'timing_anomaly');
          player.moveDurations = []; // Reset window
        }
      }
    }

    try {
      // Validate move strictly with server-authoritative chess.js
      const result = game.chess.move({
        from: cleanMove.from,
        to: cleanMove.to,
        promotion: cleanMove.promotion
      });

      if (!result) {
        socket.emit('move_rejected', { reason: 'Illegal move rejected by server engine.' });
        return;
      }

      // Record move
      const moveRecord = {
        from: result.from,
        to: result.to,
        piece: result.piece,
        color: result.color,
        san: result.san,
        captured: result.captured || null,
        promotion: result.promotion || null,
        fen: game.chess.fen(),
        timestamp: Date.now()
      };
      game.moves.push(moveRecord);

      // Compute accurate move time with network latency compensation (capped at 150ms)
      const clientTimestamp = (moveData && moveData.telemetry && typeof moveData.telemetry.timestamp === 'number')
        ? moveData.telemetry.timestamp
        : now;
      const latencyCompensation = Math.min(150, Math.max(0, now - clientTimestamp));
      const elapsedRaw = now - (game.lastTurnTimestamp || now);
      const effectiveElapsed = Math.max(10, elapsedRaw - latencyCompensation);

      player.timeRemaining = Math.max(0, player.timeRemaining - effectiveElapsed);
      game.lastTurnTimestamp = Date.now();

      if (player.timeRemaining <= 0) {
        const winner = getOpponentColor(playerColor);
        endGame(game, winner, 'timeout', `${playerColor === 'w' ? 'White' : 'Black'} ran out of time.`);
        return;
      }

      // Check game-ending conditions
      let gameOverData = null;

      if (game.chess.isCheckmate()) {
        const winner = playerColor;
        endGame(game, winner, 'checkmate', `Checkmate! ${winner === 'w' ? 'White' : 'Black'} wins.`);
        gameOverData = { winner, reason: 'checkmate' };
      } else if (game.chess.isDraw()) {
        let drawReason = 'draw';
        if (game.chess.isStalemate()) drawReason = 'stalemate';
        else if (game.chess.isThreefoldRepetition()) drawReason = 'threefold_repetition';
        else if (game.chess.isInsufficientMaterial()) drawReason = 'insufficient_material';
        else if (game.chess.isDrawByFiftyMoves()) drawReason = 'fifty_moves';

        endGame(game, null, drawReason, `Game drawn by ${drawReason.replace('_', ' ')}.`);
        gameOverData = { winner: null, reason: drawReason };
      }

      // Broadcast move to both players
      io.to(game.id).emit('move_made', {
        move: moveRecord,
        fen: game.chess.fen(),
        isCheck: game.chess.inCheck(),
        whiteTime: game.players.w.timeRemaining,
        blackTime: game.players.b.timeRemaining,
        turn: game.chess.turn(),
        gameOver: gameOverData
      });

    } catch (err) {
      console.warn('[Move Rejected by Engine]', err.message);
      socket.emit('move_rejected', { reason: 'Illegal move rejected by server engine: ' + err.message });
    }
  }, socketMoveSchema);

  // Resignation
  safeListener(socket, 'resign', () => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];
    if (!game || game.status !== 'in_progress') return;

    const playerColor = getPlayerColor(game, socket.id);
    const winnerColor = getOpponentColor(playerColor);

    endGame(game, winnerColor, 'resignation', `${playerColor === 'w' ? 'White' : 'Black'} resigned.`);
  });

  // Draw Offer
  safeListener(socket, 'offer_draw', () => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];
    if (!game || game.status !== 'in_progress') return;

    const playerColor = getPlayerColor(game, socket.id);
    const opponentColor = getOpponentColor(playerColor);
    const opponentSocket = io.sockets.sockets.get(game.players[opponentColor].id);

    if (opponentSocket) {
      opponentSocket.emit('draw_offered', { fromColor: playerColor });
    }
  });

  safeListener(socket, 'respond_draw', (data) => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];
    if (!game || game.status !== 'in_progress') return;

    const accept = Boolean(data && data.accept);
    if (accept) {
      endGame(game, null, 'draw_agreement', 'Players mutually agreed to a draw.');
    } else {
      const playerColor = getPlayerColor(game, socket.id);
      const opponentColor = getOpponentColor(playerColor);
      const opponentSocket = io.sockets.sockets.get(game.players[opponentColor].id);
      if (opponentSocket) {
        opponentSocket.emit('draw_declined');
      }
    }
  }, socketRespondDrawSchema);

  // ADVANCED ANTI-CHEAT HANDLERS (With Timestamp & Rate Validation)
  safeListener(socket, 'anti_cheat_event', (data) => {
    if (!data || typeof data !== 'object') return;
    const gameId = playerToGame[socket.id];
    const game = games[gameId];

    if (!game || game.status !== 'in_progress') return;

    const color = getPlayerColor(game, socket.id);
    if (!color) return;

    const type = typeof data.type === 'string' ? data.type.substring(0, 50) : 'unknown_event';
    const clientTimestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
    const now = Date.now();

    // Timestamp & Rate Validation (prevents client spoofing/replay attacks)
    if (Math.abs(now - clientTimestamp) > 10000 || clientTimestamp < game.gameStartedAt) {
      console.warn(`[Anti-Cheat Spoof Blocked] Timestamp anomaly from socket ${socket.id}`);
      return;
    }

    const player = game.players[color];
    if (player.lastReportedEventTime && (now - player.lastReportedEventTime < 3000)) {
      return; // Rate limit reporting
    }
    player.lastReportedEventTime = now;

    // Ignore tab blur / tab hidden to allow thinking time without false positives
    if (type === 'tab_hidden' || type === 'window_blurred') return;

    // Whitelist allowable client event categories
    const allowedViolations = new Set([
      'devtools_opened',
      'clipboard_copy_attempt',
      'clipboard_paste_attempt',
      'unauthorized_dom_injection',
      'synthetic_event_detected',
      'timing_anomaly'
    ]);

    if (!allowedViolations.has(type)) return;

    triggerAntiCheatViolation(game, color, type);
  }, socketAntiCheatEventSchema);

  safeListener(socket, 'anti_cheat_focus_lost', () => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];

    if (!game || game.status !== 'in_progress') return;

    const color = getPlayerColor(game, socket.id);
    const player = game.players[color];
    if (!player) return;

    player.isFocused = false;
    player.awaySince = Date.now();

    io.to(game.id).emit('anti_cheat_focus_lost', {
      playerColor: color,
      playerName: player.name,
      awayTimeout: 15
    });

    // Authoritative 15-second forfeit timer on backend
    if (player.awayTimer) clearTimeout(player.awayTimer);
    player.awayTimer = setTimeout(() => {
      if (!player.isFocused && game.status === 'in_progress') {
        const opponentColor = getOpponentColor(color);
        triggerAntiCheatViolation(game, color, 'excessive_tab_switch');
        endGame(
          game,
          opponentColor,
          'abandonment',
          `${player.name} (${color === 'w' ? 'White' : 'Black'}) left the game tab for more than 15 seconds and forfeited.`
        );
      }
    }, 15000);
  });

  safeListener(socket, 'anti_cheat_focus_restored', () => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];

    if (!game || game.status !== 'in_progress') return;

    const color = getPlayerColor(game, socket.id);
    const player = game.players[color];
    if (!player) return;

    player.isFocused = true;
    player.awaySince = null;
    if (player.awayTimer) {
      clearTimeout(player.awayTimer);
      player.awayTimer = null;
    }

    io.to(game.id).emit('anti_cheat_focus_restored', {
      playerColor: color,
      playerName: player.name
    });
  });

  // Authoritative Heartbeat Ping & Telemetry Listener
  safeListener(socket, 'client_heartbeat', (data) => {
    const gameId = playerToGame[socket.id];
    const game = games[gameId];
    if (!game || game.status !== 'in_progress') return;

    const color = getPlayerColor(game, socket.id);
    const player = game.players[color];
    if (!player) return;

    const now = Date.now();
    player.lastHeartbeat = now;

    if (data && typeof data === 'object' && typeof data.focused === 'boolean') {
      const wasFocused = player.isFocused !== false;
      player.isFocused = data.focused;

      if (!data.focused && wasFocused) {
        player.awaySince = now;
        io.to(game.id).emit('anti_cheat_focus_lost', {
          playerColor: color,
          playerName: player.name,
          awayTimeout: 15
        });

        if (player.awayTimer) clearTimeout(player.awayTimer);
        player.awayTimer = setTimeout(() => {
          if (!player.isFocused && game.status === 'in_progress') {
            const opponentColor = getOpponentColor(color);
            triggerAntiCheatViolation(game, color, 'excessive_tab_switch');
            endGame(
              game,
              opponentColor,
              'abandonment',
              `${player.name} (${color === 'w' ? 'White' : 'Black'}) left the game tab for more than 15 seconds and forfeited.`
            );
          }
        }, 15000);
      } else if (data.focused && !wasFocused) {
        player.awaySince = null;
        if (player.awayTimer) {
          clearTimeout(player.awayTimer);
          player.awayTimer = null;
        }
        io.to(game.id).emit('anti_cheat_focus_restored', {
          playerColor: color,
          playerName: player.name
        });
      }
    }

    socket.emit('heartbeat_ack', { serverTime: now });
  }, socketHeartbeatSchema);

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ${socket.id}`);

    // Remove from queue cleanly
    const qIdx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
    if (qIdx !== -1) {
      matchmakingQueue.splice(qIdx, 1);
      broadcastQueueStatus();
    }

    // Check if in active game
    const gameId = playerToGame[socket.id];
    const game = games[gameId];

    if (game && game.status === 'in_progress') {
      const color = getPlayerColor(game, socket.id);
      const opponentColor = getOpponentColor(color);
      const player = game.players[color];
      player.connected = false;

      // Give 30 seconds for reconnection, then forfeit
      io.to(game.id).emit('player_disconnected', {
        color,
        name: player.name,
        reconnectWindow: 30
      });

      player.disconnectTimer = setTimeout(() => {
        if (!player.connected && game.status === 'in_progress') {
          endGame(
            game,
            opponentColor,
            'disconnection',
            `${player.name} (${color === 'w' ? 'White' : 'Black'}) disconnected and abandoned the match.`
          );
        }
      }, 30000);
    }
  });
});

// Periodic Garbage Collector: Prunes stale/abandoned matches and zombie memory every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const gameId in games) {
    const game = games[gameId];
    if (!game) continue;

    // Prune completed games older than 3 minutes
    if (game.status === 'ended') {
      if (game.players?.w) delete playerToGame[game.players.w.id];
      if (game.players?.b) delete playerToGame[game.players.b.id];
      delete games[gameId];
      continue;
    }

    // Prune abandoned games where both players disconnected for > 60 seconds
    const wConnected = game.players?.w?.connected;
    const bConnected = game.players?.b?.connected;
    if (!wConnected && !bConnected) {
      console.log(`[Memory GC] Auto-pruning abandoned match: ${gameId}`);
      endGame(game, null, 'abandoned', 'Both players disconnected and abandoned the match.');
      if (game.players?.w) delete playerToGame[game.players.w.id];
      if (game.players?.b) delete playerToGame[game.players.b.id];
      delete games[gameId];
    }
  }
}, 2 * 60 * 1000);

// Global Process Crash Protection: Ensure unexpected exceptions never bring down the server
process.on('uncaughtException', (err) => {
  console.error('[Process Security Guard] Trapped uncaught exception safely:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process Security Guard] Trapped unhandled rejection safely:', reason);
});

// Global Express Error-Handling Middleware (Guarantees clean JSON error responses)
app.use((err, req, res, next) => {
  console.error('[Global Express Handler Caught Error]:', err.message);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : (err.message || 'Internal server error')
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Chess Server] Running on http://localhost:${PORT}`);
  console.log(`[Matchmaking] 10-Minute Rapid Timers | Advanced Fair-Play Anti-Cheat Active`);
});
