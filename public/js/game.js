import { Chess } from './chess.js';
import pieces from './pieces.js';
import { sounds } from './audio.js';

// Game state
let socket = null;
let chess = new Chess();
let gameId = null;
let playerColor = 'w'; // 'w' or 'b'
let opponentName = 'Opponent';
let gameStatus = 'lobby'; // 'lobby', 'in_progress', 'ended'
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let currentPremove = null; // { from, to, promotion: 'q' }
let pendingOptimisticMove = null; // { from, to, promotion, prevFen, localRes }
let pendingPromotion = null; // { from, to }
let isFlipped = false;
let isEngineRendering = false;
let recordedMoves = [];
const lastReportedTime = {};

// User Profile & Authentication State
let currentUser = null; // { id, email, username, elo, highestElo, gamesPlayed, wins, losses, draws, winRate, isGuest }
let myElo = 1200;
let opponentElo = 1200;
let otpResendTimer = null;
let otpCountdownSeconds = 60;

// Clocks (10 minutes = 600,000 ms)
let whiteTimeMs = 10 * 60 * 1000;
let blackTimeMs = 10 * 60 * 1000;
let clockInterval = null;
let currentTurn = 'w';

// Anti-Cheat State
let selfStrikes = 0;
let oppStrikes = 0;
let isTabFocused = true;

// DOM Elements
const boardEl = document.getElementById('chess-board');
const panelLobby = document.getElementById('panel-lobby');
const panelGame = document.getElementById('panel-game');

const selfNameEl = document.getElementById('self-name');
const oppNameEl = document.getElementById('opponent-name');
const selfColorBadge = document.getElementById('self-color-badge');
const oppColorBadge = document.getElementById('opponent-color-badge');

const selfClockEl = document.getElementById('self-clock');
const oppClockEl = document.getElementById('opponent-clock');

const selfCardEl = document.getElementById('self-card');
const oppCardEl = document.getElementById('opponent-card');

const selfCapturedEl = document.getElementById('self-captured');
const oppCapturedEl = document.getElementById('opponent-captured');

const turnBannerEl = document.getElementById('turn-banner');
const moveHistoryEl = document.getElementById('move-history-list');
const moveCountEl = document.getElementById('move-count-text');

// Toolbar buttons
const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
const btnFlipBoard = document.getElementById('btn-flip-board');
const matchModeTag = document.getElementById('match-mode-tag');

// Privacy & Fair-Play Policy DOM
const privacyModal = document.getElementById('privacy-modal');
const btnPrivacy = document.getElementById('btn-privacy');
const linkPrivacy = document.getElementById('link-privacy');
const btnClosePrivacy = document.getElementById('btn-close-privacy');
const btnPrivacyOk = document.getElementById('btn-privacy-ok');

// Auth Modal & Agreement Gate DOM
const authModal = document.getElementById('auth-modal');
const authStepEmail = document.getElementById('auth-step-email');
const authStepOtp = document.getElementById('auth-step-otp');
const authStepTerms = document.getElementById('auth-step-terms');
const inputAuthEmail = document.getElementById('auth-email');
const inputAuthUsername = document.getElementById('auth-username');
const btnSendCode = document.getElementById('btn-send-code');
const inputAuthOtp = document.getElementById('auth-otp-code');
const btnVerifyCode = document.getElementById('btn-verify-code');
const btnChangeEmail = document.getElementById('btn-change-email');
const btnResendCode = document.getElementById('btn-resend-code');
const authTargetEmail = document.getElementById('auth-target-email');
const authMsgStep1 = document.getElementById('auth-msg-step1');
const authMsgStep2 = document.getElementById('auth-msg-step2');
const authMsgStep3 = document.getElementById('auth-msg-step3');
const chkAcceptTerms = document.getElementById('chk-accept-terms');
const btnMandatoryAgree = document.getElementById('btn-mandatory-agree');
const linkAuthPolicy = document.getElementById('link-auth-policy');
const appContainer = document.getElementById('app-container');

// Header & Lobby Profile DOM
const btnHeaderSignin = document.getElementById('btn-header-signin');
const headerProfilePill = document.getElementById('header-profile-pill');
const headerAvatar = document.getElementById('header-avatar');
const headerUsername = document.getElementById('header-username');
const headerElo = document.getElementById('header-elo');

const lobbyProfileCard = document.getElementById('lobby-profile-card');
const lobbyAvatar = document.getElementById('lobby-avatar');
const lobbyUsername = document.getElementById('lobby-username');
const lobbyGuestTag = document.getElementById('lobby-guest-tag');
const lobbyEloVal = document.getElementById('lobby-elo-val');
const lobbyRecord = document.getElementById('lobby-record');
const btnLobbyAuth = document.getElementById('btn-lobby-auth');

// Profile Modal DOM
const profileModal = document.getElementById('profile-modal');
const btnCloseProfile = document.getElementById('btn-close-profile');
const profileBigAvatar = document.getElementById('profile-big-avatar');
const profileUsername = document.getElementById('profile-username');
const profileEmail = document.getElementById('profile-email');
const profileElo = document.getElementById('profile-elo');
const profileHighestElo = document.getElementById('profile-highest-elo');
const profileGamesCount = document.getElementById('profile-games-count');
const profileWinRate = document.getElementById('profile-win-rate');
const profileRecordText = document.getElementById('profile-record-text');
const btnSignOut = document.getElementById('btn-sign-out');

// Player Card & GameOver Elo Badges
const selfEloBadge = document.getElementById('self-elo-badge');
const oppEloBadge = document.getElementById('opponent-elo-badge');
const gameoverEloBox = document.getElementById('gameover-elo-box');
const gameoverEloChange = document.getElementById('gameover-elo-change');

const selfAnticheatBadge = document.getElementById('self-anticheat-badge');
const oppAnticheatBadge = document.getElementById('opponent-anticheat-badge');
const selfStrikesBadge = document.getElementById('self-strikes-badge');
const oppStrikesBadge = document.getElementById('opponent-strikes-badge');

const monSelfTab = document.getElementById('mon-self-tab');
const monOppTab = document.getElementById('mon-opp-tab');
const monSelfStrikes = document.getElementById('mon-self-strikes');
const monOppStrikes = document.getElementById('mon-opp-strikes');

// Matchmaking DOM
const btnFindMatch = document.getElementById('btn-find-match');
const queueStateEl = document.getElementById('queue-state');
const queueCountText = document.getElementById('queue-count-text');
const btnCancelQueue = document.getElementById('btn-cancel-queue');

const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const inputRoomCode = document.getElementById('input-room-code');
const roomCreatedInfo = document.getElementById('room-created-info');
const createdRoomCode = document.getElementById('created-room-code');
const btnCopyRoomCode = document.getElementById('btn-copy-room-code');

const inputUsername = document.getElementById('input-username');
const btnSaveUsername = document.getElementById('btn-save-username');
const headerOnlineCount = document.getElementById('header-online-count');

// Cloudflare Banner DOM
const cloudflareBanner = document.getElementById('cloudflare-banner');
const cfUrlText = document.getElementById('cf-url-text');
const btnCopyCfUrl = document.getElementById('btn-copy-cf-url');

// Modals
const promotionModal = document.getElementById('promotion-modal');
const promotionOptions = document.getElementById('promotion-options');
const gameoverModal = document.getElementById('gameover-modal');
const gameoverBadge = document.getElementById('gameover-badge');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverDetails = document.getElementById('gameover-details');
const gameoverAnticheatStatus = document.getElementById('gameover-anticheat-status');
const btnGameoverRematch = document.getElementById('btn-gameover-rematch');
const btnGameoverLobby = document.getElementById('btn-gameover-lobby');

// Game actions
const btnOfferDraw = document.getElementById('btn-offer-draw');
const btnResign = document.getElementById('btn-resign');
const drawOfferAlert = document.getElementById('draw-offer-alert');
const btnAcceptDraw = document.getElementById('btn-accept-draw');
const btnDeclineDraw = document.getElementById('btn-decline-draw');
const btnSoundToggle = document.getElementById('btn-sound-toggle');
const soundIcon = document.getElementById('sound-icon');

// Initialize Socket.io with mandatory token verification in handshake
function initSocket(token) {
  const authToken = token || localStorage.getItem('chess_auth_token');
  if (!authToken) {
    console.warn('[Socket] Refusing to connect: No auth token provided.');
    return;
  }

  if (socket && socket.connected) return;
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: {
      token: authToken
    },
    transports: ['websocket', 'polling']
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket Handshake Error]', err.message);
    if (err.message && err.message.toLowerCase().includes('auth')) {
      signOut();
    }
  });

  socket.on('connect', () => {
    console.log('[Socket] Authenticated connection established:', socket.id);
    socket.emit('auth_session', { userId: authToken });
    sendUsername();

    // Check URL parameters for room code invite (e.g. ?room=ROOM_ABC)
    const urlParams = new URLSearchParams(window.location.search);
    const joinCode = urlParams.get('room');
    if (joinCode) {
      inputRoomCode.value = joinCode.toUpperCase();
      socket.emit('join_room', joinCode);
    }
  });

  socket.on('auth_error', (data) => {
    console.warn('[Socket Auth Error]', data.message);
    signOut();
  });

  socket.on('auth_success', (data) => {
    if (data && data.profile) {
      localStorage.setItem('chess_auth_token', data.token);
      localStorage.setItem('chess_auth_user', JSON.stringify(data.profile));
      updateCurrentUser(data.profile);
    }
  });

  socket.on('username_error', (data) => {
    alert(data.message || 'Username already taken. Please choose another handle.');
    if (currentUser && currentUser.username && inputUsername) {
      inputUsername.value = currentUser.username;
    }
    if (btnSaveUsername) {
      btnSaveUsername.disabled = false;
      btnSaveUsername.textContent = 'Set';
    }
  });

  socket.on('username_updated', (data) => {
    if (data && data.profile) {
      currentUser = { ...currentUser, ...data.profile };
      localStorage.setItem('chess_auth_user', JSON.stringify(currentUser));
      updateCurrentUser(currentUser);
    }
    if (btnSaveUsername) {
      btnSaveUsername.disabled = false;
      btnSaveUsername.textContent = 'Saved!';
      setTimeout(() => { btnSaveUsername.textContent = 'Set'; }, 1500);
    }
  });

  socket.on('elo_updated', (data) => {
    handleEloUpdated(data);
  });

  socket.on('queue_status', (data) => {
    if (headerOnlineCount) {
      headerOnlineCount.textContent = `${data.playersOnline} Online`;
    }
    if (queueCountText) {
      queueCountText.textContent = `${data.inQueue} player${data.inQueue === 1 ? '' : 's'} in queue`;
    }
  });

  socket.on('queue_joined', () => {
    btnFindMatch.classList.add('hidden');
    queueStateEl.classList.remove('hidden');
  });

  socket.on('queue_left', () => {
    btnFindMatch.classList.remove('hidden');
    queueStateEl.classList.add('hidden');
  });

  socket.on('room_created', (data) => {
    roomCreatedInfo.classList.remove('hidden');
    createdRoomCode.textContent = data.roomCode;
  });

  socket.on('room_error', (data) => {
    alert(data.message);
  });

  socket.on('tunnel_updated', (data) => {
    if (cloudflareBanner && cfUrlText && data && data.url) {
      cloudflareBanner.classList.remove('hidden');
      cfUrlText.textContent = data.url;
      cfUrlText.href = data.url;
    }
  });

  // MATCH FOUND -> FULLSCREEN MATCH MODE
  socket.on('match_found', (data) => {
    console.log('[Game] Match found!', data);
    startMatch(data);
  });

  socket.on('match_reconnected', (data) => {
    console.log('[Game] Reconnected to match', data);
    startMatch(data);
  });

  // Server Move Broadcast with Smooth Animation
  socket.on('move_made', (data) => {
    handleServerMove(data);
  });

  socket.on('move_rejected', (data) => {
    console.warn('[Game] Move rejected:', data.reason);
    if (pendingOptimisticMove) {
      chess.load(pendingOptimisticMove.prevFen);
      pendingOptimisticMove = null;
    }
    isMoveInFlight = false;
    clearSelection();
    renderBoard();
  });

  // Time Sync from Server
  socket.on('time_sync', (data) => {
    whiteTimeMs = data.whiteTime;
    blackTimeMs = data.blackTime;
    currentTurn = data.turn;
    updateClockDisplays();
  });

  // Game Over
  socket.on('game_over', (data) => {
    handleGameOver(data);
  });

  // Draw Offer
  socket.on('draw_offered', () => {
    drawOfferAlert.classList.remove('hidden');
  });

  socket.on('draw_declined', () => {
    alert('Draw offer was declined.');
  });

  // Anti-Cheat Events from Server
  socket.on('anti_cheat_strike', (data) => {
    handleAntiCheatStrike(data);
  });

  socket.on('anti_cheat_log_entry', (data) => {
    appendAntiCheatLog(data.text, data.severity, data.time);
  });

  socket.on('anti_cheat_focus_lost', (data) => {
    if (data.playerColor !== playerColor) {
      monOppTab.textContent = 'AWAY';
      monOppTab.className = 'mon-val text-red';
      oppAnticheatBadge.textContent = '⚪ Tab Inactive';
      oppAnticheatBadge.className = 'telemetry-badge away';
      appendAntiCheatLog(`${data.playerName} (${data.playerColor === 'w' ? 'White' : 'Black'}) unfocused game tab.`, 'warning');
    }
  });

  socket.on('anti_cheat_focus_restored', (data) => {
    handleAntiCheatFocusRestored(data);
    appendAntiCheatLog(`${data.playerName} (${data.playerColor === 'w' ? 'White' : 'Black'}) resumed active tab focus.`, 'system');
  });

  socket.on('player_disconnected', (data) => {
    console.warn('[Game] Opponent disconnected:', data);
    if (data.color !== playerColor) {
      oppAnticheatBadge.textContent = `🔴 Disconnected (${data.reconnectWindow}s to forfeit)`;
      oppAnticheatBadge.className = 'telemetry-badge away';
    }
  });
}

function sendUsername() {
  const name = inputUsername.value.trim() || 'Player';
  socket.emit('set_username', name);
}

// Start Match Session (Enter Fullscreen Stadium Match Mode)
function startMatch(data) {
  gameId = data.gameId;
  playerColor = data.color;
  isFlipped = (playerColor === 'b'); // Automatically view from your perspective
  opponentName = data.opponentName || 'Opponent';
  gameStatus = 'in_progress';
  chess = new Chess();
  if (data.fen) {
    chess.load(data.fen);
  }

  whiteTimeMs = data.whiteTime !== undefined ? data.whiteTime : (data.timeRemaining || (10 * 60 * 1000));
  blackTimeMs = data.blackTime !== undefined ? data.blackTime : (data.timeRemaining || (10 * 60 * 1000));
  currentTurn = data.turn || chess.turn();

  selfStrikes = 0;
  oppStrikes = 0;
  lastMove = null;
  currentPremove = null;
  selectedSquare = null;
  legalMoves = [];

  // Activate FULLSCREEN MATCH MODE
  document.body.classList.add('match-active');

  // Update UI Elements
  panelLobby.classList.add('hidden');
  panelGame.classList.remove('hidden');
  gameoverModal.classList.add('hidden');
  queueStateEl.classList.add('hidden');
  btnFindMatch.classList.remove('hidden');

  selfNameEl.textContent = currentUser?.username || inputUsername.value.trim() || 'You';
  oppNameEl.textContent = opponentName;

  myElo = data.myElo || (currentUser?.elo || 1200);
  opponentElo = data.opponentElo || 1200;

  if (selfEloBadge) selfEloBadge.textContent = `${myElo} Elo`;
  if (oppEloBadge) oppEloBadge.textContent = `${opponentElo} Elo`;
  if (gameoverEloBox) gameoverEloBox.classList.add('hidden');

  selfColorBadge.textContent = playerColor === 'w' ? 'WHITE' : 'BLACK';
  oppColorBadge.textContent = playerColor === 'w' ? 'BLACK' : 'WHITE';

  if (matchModeTag) {
    matchModeTag.textContent = `● LIVE 10m MATCH • PLAYING ${playerColor === 'w' ? 'WHITE' : 'BLACK'}`;
  }

  // Anti-cheat badges reset
  updateTelemetryUI();

  // Clear move history
  recordedMoves = [];
  moveHistoryEl.innerHTML = '';
  moveCountEl.textContent = '0 moves';
  if (data.history && Array.isArray(data.history)) {
    data.history.forEach(m => addMoveToHistory(m));
  }

  renderBoard();
  updateClockDisplays();
  startLocalClockTicker();
  startHeartbeat();

  sounds.playMatchStart();
}

// Local Clock Ticker (smooth 100ms updates)
function startLocalClockTicker() {
  if (clockInterval) clearInterval(clockInterval);

  let lastTick = Date.now();
  clockInterval = setInterval(() => {
    if (gameStatus !== 'in_progress') {
      clearInterval(clockInterval);
      return;
    }

    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    if (currentTurn === 'w') {
      whiteTimeMs = Math.max(0, whiteTimeMs - delta);
    } else {
      blackTimeMs = Math.max(0, blackTimeMs - delta);
    }

    updateClockDisplays();
  }, 100);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateClockDisplays() {
  const whiteFormatted = formatTime(whiteTimeMs);
  const blackFormatted = formatTime(blackTimeMs);

  const isWhite = playerColor === 'w';
  const myClock = isWhite ? whiteFormatted : blackFormatted;
  const oppClock = isWhite ? blackFormatted : whiteFormatted;
  const myTime = isWhite ? whiteTimeMs : blackTimeMs;
  const oppTime = isWhite ? blackTimeMs : whiteTimeMs;

  selfClockEl.textContent = myClock;
  oppClockEl.textContent = oppClock;

  // Active clock glow
  const isMyTurn = currentTurn === playerColor;
  if (isMyTurn) {
    selfClockEl.classList.add('active-clock');
    oppClockEl.classList.remove('active-clock');
    selfCardEl.classList.add('active-turn');
    oppCardEl.classList.remove('active-turn');
    turnBannerEl.textContent = 'Your Turn (' + (playerColor === 'w' ? 'White' : 'Black') + ')';
    turnBannerEl.style.borderLeftColor = 'var(--accent-emerald)';
  } else {
    selfClockEl.classList.remove('active-clock');
    oppClockEl.classList.add('active-clock');
    selfCardEl.classList.remove('active-turn');
    oppCardEl.classList.add('active-turn');
    turnBannerEl.textContent = `${opponentName}'s Turn`;
    turnBannerEl.style.borderLeftColor = 'var(--accent-cyan)';
  }

  // Low time warning (< 60 seconds)
  if (myTime < 60000 && myTime > 0) {
    selfClockEl.classList.add('low-time');
    if (myTime % 1000 < 100 && isMyTurn) {
      sounds.playTick();
    }
  } else {
    selfClockEl.classList.remove('low-time');
  }

  if (oppTime < 60000 && oppTime > 0) {
    oppClockEl.classList.add('low-time');
  } else {
    oppClockEl.classList.remove('low-time');
  }
}

// Render Chessboard (8x8 Checker Board Green and White with Coordinates and Move Dots)
function renderBoard() {
  isEngineRendering = true;
  try {
    boardEl.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const effectiveFlipped = isFlipped;
    const ranks = effectiveFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = effectiveFlipped ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    const inCheck = chess.inCheck();
    let kingSquareInCheck = null;

    if (inCheck) {
      const turn = chess.turn();
      for (const r of [1, 2, 3, 4, 5, 6, 7, 8]) {
        for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
          const sq = f + r;
          const p = chess.get(sq);
          if (p && p.type === 'k' && p.color === turn) {
            kingSquareInCheck = sq;
            break;
          }
        }
      }
    }

    const currentActiveTurn = (gameStatus === 'in_progress') ? playerColor : chess.turn();

    for (let rIdx = 0; rIdx < 8; rIdx++) {
      for (let fIdx = 0; fIdx < 8; fIdx++) {
        const rank = ranks[rIdx];
        const file = files[fIdx];
        const square = file + rank;

        const squareEl = document.createElement('div');
        squareEl.className = 'square';
        squareEl.dataset.square = square;

        // Checker board coloring: (fileNum + rank)
        const fileNum = file.charCodeAt(0) - 'a'.charCodeAt(0);
        const isLight = (fileNum + (rank - 1)) % 2 !== 0;
        squareEl.classList.add(isLight ? 'light' : 'dark');

        // Rank Coordinates on the left edge (fIdx === 0)
        if (fIdx === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord-label coord-rank';
          rankLabel.textContent = rank;
          squareEl.appendChild(rankLabel);
        }
        // File Coordinates on the bottom edge (rIdx === 7)
        if (rIdx === 7) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord-label coord-file';
          fileLabel.textContent = file;
          squareEl.appendChild(fileLabel);
        }

        // Last move highlight
        if (lastMove && (lastMove.from === square || lastMove.to === square)) {
          squareEl.classList.add(isLight ? 'last-move-light' : 'last-move-dark');
        }

        // Pre-move highlight (Chess.com coral/crimson style)
        if (currentPremove) {
          if (currentPremove.from === square) {
            squareEl.classList.add('premove-src');
          } else if (currentPremove.to === square) {
            squareEl.classList.add('premove-dst');
          }
        }

        // Selected square highlight
        if (selectedSquare === square) {
          squareEl.classList.add('selected');
        }

        // King in Check pulse
        if (kingSquareInCheck === square) {
          squareEl.classList.add('in-check');
        }

        const pieceData = chess.get(square);

        if (pieceData && pieceData.color === currentActiveTurn) {
          squareEl.classList.add('has-friendly');
        }

        // ==========================================
        // LEGAL MOVE DOTS & CAPTURE TARGET RINGS
        // ==========================================
        const isLegalMove = legalMoves.some(m => m.to === square);
        if (isLegalMove) {
          if (pieceData) {
            // Capturable Enemy Piece: Crimson Target Ring
            const captureRing = document.createElement('div');
            captureRing.className = 'move-hint-capture';
            squareEl.appendChild(captureRing);
          } else {
            // Vacant Legal Destination: Glowing Emerald Dot
            const moveDot = document.createElement('div');
            moveDot.className = 'move-hint-dot';
            squareEl.appendChild(moveDot);
          }
        }

        // Piece rendering with Premium SVG
        if (pieceData) {
          const pieceCode = pieceData.color + pieceData.type;
          const pieceSvg = pieces[pieceCode];
          if (pieceSvg) {
            const pieceEl = document.createElement('div');
            pieceEl.className = 'piece';
            if (selectedSquare === square) {
              pieceEl.classList.add('selected-piece');
            }
            pieceEl.innerHTML = pieceSvg;
            pieceEl.dataset.square = square;

            // Drag-and-drop: can drag own pieces during turn OR to queue premove during opponent's turn
            const canDrag = (gameStatus === 'in_progress' && pieceData.color === playerColor) ||
                            (gameStatus !== 'in_progress');
            if (canDrag) {
              pieceEl.setAttribute('draggable', 'true');
              setupDragAndDrop(pieceEl, square);
              setupTouchDrag(pieceEl, square);
            }

            squareEl.appendChild(pieceEl);
          }
        }

        fragment.appendChild(squareEl);
      }
    }

    boardEl.appendChild(fragment);
    updateCapturedAndAdvantage();
  } finally {
    isEngineRendering = false;
  }
}

let draggedFromSquare = null;
let isMoveInFlight = false;
let activeTouchDrag = null;
let touchRafPending = false;
let currentTouchX = 0;
let currentTouchY = 0;

// Touch Drag Support for Mobile & Tablets (Hardware-Accelerated 120fps)
function setupTouchDrag(pieceEl, fromSquare) {
  pieceEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];

    selectSquare(fromSquare);

    const rect = pieceEl.getBoundingClientRect();
    const ghostEl = pieceEl.cloneNode(true);
    ghostEl.classList.add('touch-drag-avatar');
    ghostEl.style.width = `${rect.width}px`;
    ghostEl.style.height = `${rect.height}px`;
    ghostEl.style.transform = `translate3d(${touch.clientX - rect.width / 2}px, ${touch.clientY - rect.height / 2}px, 0)`;
    document.body.appendChild(ghostEl);

    pieceEl.classList.add('touch-dragging');

    activeTouchDrag = {
      pieceEl,
      fromSquare,
      ghostEl,
      width: rect.width,
      height: rect.height
    };

    e.preventDefault();
  }, { passive: false });
}

window.addEventListener('touchmove', (e) => {
  if (!activeTouchDrag) return;
  const touch = e.touches[0];
  currentTouchX = touch.clientX;
  currentTouchY = touch.clientY;

  if (!touchRafPending) {
    touchRafPending = true;
    requestAnimationFrame(() => {
      touchRafPending = false;
      if (!activeTouchDrag || !activeTouchDrag.ghostEl) return;
      const ghost = activeTouchDrag.ghostEl;
      const w = activeTouchDrag.width || 60;
      const h = activeTouchDrag.height || 60;
      ghost.style.transform = `translate3d(${currentTouchX - w / 2}px, ${currentTouchY - h / 2}px, 0)`;
    });
  }
  e.preventDefault();
}, { passive: false });

window.addEventListener('touchend', (e) => {
  if (!activeTouchDrag) return;
  const touch = e.changedTouches[0];
  const { pieceEl, fromSquare, ghostEl } = activeTouchDrag;

  if (ghostEl && ghostEl.parentNode) {
    ghostEl.parentNode.removeChild(ghostEl);
  }
  if (pieceEl) {
    pieceEl.classList.remove('touch-dragging');
  }
  activeTouchDrag = null;

  const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
  const targetSquareEl = elementBelow ? elementBelow.closest('.square') : null;

  if (targetSquareEl && targetSquareEl.dataset.square) {
    const toSquare = targetSquareEl.dataset.square;
    if (fromSquare !== toSquare) {
      if (gameStatus === 'in_progress' && chess.turn() !== playerColor) {
        // Pre-move via touch drag!
        const piece = chess.get(fromSquare);
        if (piece && piece.color === playerColor) {
          currentPremove = { from: fromSquare, to: toSquare, promotion: 'q' };
          clearSelection();
          renderBoard();
          sounds.playSelect();
        }
      } else {
        attemptMove(fromSquare, toSquare);
      }
    }
  }
});

window.addEventListener('touchcancel', () => {
  if (activeTouchDrag) {
    if (activeTouchDrag.ghostEl && activeTouchDrag.ghostEl.parentNode) {
      activeTouchDrag.ghostEl.parentNode.removeChild(activeTouchDrag.ghostEl);
    }
    if (activeTouchDrag.pieceEl) {
      activeTouchDrag.pieceEl.classList.remove('touch-dragging');
    }
    activeTouchDrag = null;
  }
});

// Drag & Drop Setup (Safe without wiping DOM)
function setupDragAndDrop(pieceEl, fromSquare) {
  pieceEl.addEventListener('dragstart', (e) => {
    if (!e.isTrusted) {
      reportAntiCheatEvent('synthetic_event_detected');
      e.preventDefault();
      return;
    }
    draggedFromSquare = fromSquare;
    e.dataTransfer.setData('text/plain', fromSquare);
    e.dataTransfer.effectAllowed = 'move';
    pieceEl.classList.add('dragging');
    selectSquare(fromSquare);
  });

  pieceEl.addEventListener('dragend', () => {
    pieceEl.classList.remove('dragging');
    draggedFromSquare = null;
  });
}

// Setup board square drop listeners
boardEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

boardEl.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.isTrusted) {
    reportAntiCheatEvent('synthetic_event_detected');
    return;
  }
  const targetSquareEl = e.target.closest('.square');
  const from = e.dataTransfer.getData('text/plain') || draggedFromSquare;
  if (targetSquareEl && from) {
    const to = targetSquareEl.dataset.square;
    if (from !== to) {
      if (gameStatus === 'in_progress' && chess.turn() !== playerColor) {
        // Pre-move via drag-and-drop!
        const piece = chess.get(from);
        if (piece && piece.color === playerColor) {
          currentPremove = { from, to, promotion: 'q' };
          clearSelection();
          renderBoard();
          sounds.playSelect();
        }
      } else {
        attemptMove(from, to);
      }
    }
  }
});

// Single Unified Click Delegation on Chess Board (Never drops clicks on SVG or children)
boardEl.addEventListener('click', (e) => {
  if (!e.isTrusted) {
    console.warn('[Anti-Cheat] Synthetic click blocked!');
    reportAntiCheatEvent('synthetic_event_detected');
    return;
  }
  const squareEl = e.target.closest('.square');
  if (!squareEl) return;
  const square = squareEl.dataset.square;
  if (square) {
    handleSquareClick(square);
  }
});

// Clear highlights without DOM destruction
function clearSelection() {
  isEngineRendering = true;
  try {
    selectedSquare = null;
    legalMoves = [];
    boardEl.querySelectorAll('.square.selected').forEach(el => el.classList.remove('selected'));
    boardEl.querySelectorAll('.piece.selected-piece').forEach(el => el.classList.remove('selected-piece'));
    boardEl.querySelectorAll('.move-hint-dot, .move-hint-capture').forEach(el => el.remove());
  } finally {
    isEngineRendering = false;
  }
}

// Calculate piece moves (supports computing candidate squares for premove during opponent's turn)
function getPieceMoves(square, color) {
  if (chess.turn() === color) {
    return chess.moves({ square: square, verbose: true });
  }
  try {
    const fen = chess.fen();
    const parts = fen.split(' ');
    parts[1] = color;
    parts[3] = '-'; // reset en-passant square
    const tempChess = new Chess(parts.join(' '));
    return tempChess.moves({ square: square, verbose: true });
  } catch (e) {
    return [];
  }
}

// Update Highlights smoothly without destroying board elements
function selectSquare(square) {
  clearSelection();

  const isLive = gameStatus === 'in_progress';
  const currentActiveColor = isLive ? playerColor : chess.turn();
  const piece = chess.get(square);

  if (!piece || piece.color !== currentActiveColor) return;

  sounds.playSelect();

  selectedSquare = square;
  legalMoves = getPieceMoves(square, currentActiveColor);

  isEngineRendering = true;
  try {
    const squareEl = boardEl.querySelector(`[data-square="${square}"]`);
    if (squareEl) {
      squareEl.classList.add('selected');
      const pieceEl = squareEl.querySelector('.piece');
      if (pieceEl) pieceEl.classList.add('selected-piece');
    }

    legalMoves.forEach(m => {
      const destSquareEl = boardEl.querySelector(`[data-square="${m.to}"]`);
      if (destSquareEl) {
        const hasDestPiece = chess.get(m.to);
        if (hasDestPiece) {
          const ring = document.createElement('div');
          ring.className = 'move-hint-capture';
          destSquareEl.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'move-hint-dot';
          destSquareEl.appendChild(dot);
        }
      }
    });
  } finally {
    isEngineRendering = false;
  }
}

// Click-to-Move Logic (Supports standard moves AND Chess.com style Pre-moves)
function handleSquareClick(square) {
  if (isMoveInFlight) return;

  const isLive = gameStatus === 'in_progress';
  const myTurn = isLive ? (chess.turn() === playerColor) : true;

  // 1. PRE-MOVE QUEUING (when opponent's turn in live match)
  if (isLive && !myTurn) {
    const piece = chess.get(square);

    if (selectedSquare) {
      if (selectedSquare === square) {
        clearSelection();
        return;
      }
      if (piece && piece.color === playerColor) {
        selectSquare(square);
        return;
      }
      // Clicked destination square -> Queue premove!
      currentPremove = { from: selectedSquare, to: square, promotion: 'q' };
      clearSelection();
      renderBoard();
      sounds.playSelect();
      return;
    } else {
      // Nothing selected yet -> If clicked own piece, select it and show candidate premove dots!
      if (piece && piece.color === playerColor) {
        selectSquare(square);
      }
      return;
    }
  }

  // 2. NORMAL MOVE HANDLING (when player's turn or lobby)
  const currentActiveColor = isLive ? playerColor : chess.turn();
  const piece = chess.get(square);

  // If a piece is already selected
  if (selectedSquare) {
    // If clicking the same square, deselect
    if (selectedSquare === square) {
      clearSelection();
      return;
    }

    // If clicking another piece of the active color, switch selection smoothly
    if (piece && piece.color === currentActiveColor) {
      selectSquare(square);
      return;
    }

    // Check if clicked square is a valid destination dot
    const isLegal = legalMoves.some(m => m.to === square);
    if (isLegal) {
      const from = selectedSquare;
      clearSelection();
      attemptMove(from, square);
    } else {
      clearSelection();
    }
  } else {
    // Select piece if it's the active color
    if (piece && piece.color === currentActiveColor) {
      selectSquare(square);
    }
  }
}

// Smooth Piece Slide Animation
function animatePieceSlide(from, to, callback) {
  const fromSquareEl = boardEl.querySelector(`[data-square="${from}"]`);
  const toSquareEl = boardEl.querySelector(`[data-square="${to}"]`);

  if (!fromSquareEl || !toSquareEl) {
    callback();
    return;
  }

  const pieceEl = fromSquareEl.querySelector('.piece');
  const capturedEl = toSquareEl.querySelector('.piece');

  if (!pieceEl) {
    callback();
    return;
  }

  const fromRect = fromSquareEl.getBoundingClientRect();
  const toRect = toSquareEl.getBoundingClientRect();
  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  if (capturedEl) {
    capturedEl.classList.add('fade-capture');
  }

  pieceEl.classList.add('animating-slide');
  pieceEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;

  setTimeout(() => {
    callback();
    // After render, add bounce to landing piece
    const newSquareEl = boardEl.querySelector(`[data-square="${to}"] .piece`);
    if (newSquareEl) {
      newSquareEl.classList.add('landing-bounce');
    }
  }, 220);
}

// Attempt Move (Promotion Check)
function attemptMove(from, to) {
  const piece = chess.get(from);
  if (!piece) return;

  // Validate that this destination is actually a legal move
  const legal = chess.moves({ square: from, verbose: true });
  const isLegalTarget = legal.some(m => m.to === to);
  if (!isLegalTarget) {
    clearSelection();
    return;
  }

  const isPawn = piece.type === 'p';
  const targetRank = to[1];
  const isPromotion = isPawn && ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1'));

  if (isPromotion) {
    pendingPromotion = { from, to };
    openPromotionModal(piece.color);
    return;
  }

  executeMove(from, to, 'q');
}

// Open Promotion Dialog Modal
function openPromotionModal(color) {
  promotionOptions.innerHTML = '';
  const promoPieces = ['q', 'r', 'b', 'n'];

  promoPieces.forEach(p => {
    const opt = document.createElement('div');
    opt.className = 'promotion-opt';
    opt.innerHTML = pieces[color + p];
    opt.addEventListener('click', () => {
      promotionModal.classList.add('hidden');
      if (pendingPromotion) {
        executeMove(pendingPromotion.from, pendingPromotion.to, p);
        pendingPromotion = null;
      }
    });
    promotionOptions.appendChild(opt);
  });

  promotionModal.classList.remove('hidden');
}

// Dismiss promotion on backdrop click
if (promotionModal) {
  promotionModal.addEventListener('click', (e) => {
    if (e.target === promotionModal) {
      promotionModal.classList.add('hidden');
      pendingPromotion = null;
      clearSelection();
      renderBoard();
    }
  });
}

// Execute Move with Optimistic Rendering & Zero-Latency Audio
function executeMove(from, to, promotion = 'q') {
  clearSelection();

  if (gameStatus === 'in_progress') {
    isMoveInFlight = true;
    setTimeout(() => { isMoveInFlight = false; }, 2000);

    const prevFen = chess.fen();

    // Optimistically apply move to local chess engine
    const localRes = chess.move({ from, to, promotion });
    if (!localRes) {
      isMoveInFlight = false;
      renderBoard();
      return;
    }

    pendingOptimisticMove = { from, to, promotion, prevFen, localRes };
    lastMove = { from, to };
    currentTurn = chess.turn();

    // Instant zero-latency sound feedback using preloaded audio buffers
    if (chess.inCheck()) sounds.playCheck();
    else if (localRes.san && localRes.san.includes('O-O')) sounds.playCastle();
    else if (localRes.promotion) sounds.playPromotion();
    else if (localRes.captured) sounds.playCapture();
    else sounds.playMove();

    // Instant piece slide animation and snapping
    animatePieceSlide(from, to, () => {
      renderBoard();
      updateClockDisplays();
    });

    // Send move to server with rich anti-cheat telemetry
    socket.emit('make_move', {
      from,
      to,
      promotion,
      telemetry: {
        isTrusted: true,
        mouseMoves: mouseMovesInTurn,
        isTouch: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
        timestamp: Date.now()
      }
    });
    mouseMovesInTurn = 0;
  } else {
    // Practice / Lobby Mode move animation
    isMoveInFlight = true;
    animatePieceSlide(from, to, () => {
      isMoveInFlight = false;
      const res = chess.move({ from, to, promotion });
      if (res) {
        lastMove = { from, to };
        if (chess.inCheck()) sounds.playCheck();
        else if (res.san && res.san.includes('O-O')) sounds.playCastle();
        else if (res.promotion) sounds.playPromotion();
        else if (res.captured) sounds.playCapture();
        else sounds.playMove();
      }
      renderBoard();
    });
  }
}

// Handle Server Broadcast of Move
function handleServerMove(data) {
  const move = data.move;
  const isMyMove = (move.color === playerColor);

  if (isMyMove) {
    // Player's own move was already rendered optimistically with instant sound and snap
    isMoveInFlight = false;
    pendingOptimisticMove = null;
    clearSelection();
    lastMove = { from: move.from, to: move.to };
    chess.load(data.fen);
    currentTurn = data.turn;
    whiteTimeMs = data.whiteTime;
    blackTimeMs = data.blackTime;
    addMoveToHistory(move);
    renderBoard();
    updateClockDisplays();
    return;
  }

  // Opponent's move received from server: animate, sound, update clocks, and trigger premove
  animatePieceSlide(move.from, move.to, () => {
    isMoveInFlight = false;
    clearSelection();
    lastMove = { from: move.from, to: move.to };
    chess.load(data.fen);
    currentTurn = data.turn;
    whiteTimeMs = data.whiteTime;
    blackTimeMs = data.blackTime;

    if (data.isCheck) {
      sounds.playCheck();
    } else if (move.san && move.san.includes('O-O')) {
      sounds.playCastle();
    } else if (move.promotion) {
      sounds.playPromotion();
    } else if (move.captured) {
      sounds.playCapture();
    } else {
      sounds.playMove();
    }

    addMoveToHistory(move);
    renderBoard();
    updateClockDisplays();

    // Instant Pre-Move Trigger (0ms delay like Chess.com)
    if (gameStatus === 'in_progress' && chess.turn() === playerColor && currentPremove) {
      const pm = currentPremove;
      currentPremove = null; // Clear so it doesn't trigger twice

      // Validate legality of premove in the new position
      const legalNow = chess.moves({ square: pm.from, verbose: true });
      const isValid = legalNow.some(m => m.to === pm.to);

      if (isValid) {
        setTimeout(() => {
          if (pm.promotion) {
            executeMove(pm.from, pm.to, pm.promotion);
          } else {
            attemptMove(pm.from, pm.to);
          }
        }, 10);
      } else {
        // Premove was illegal in the resulting position, cancel quietly
        renderBoard();
      }
    }
  });
}

// Add Move to Move History Table
function addMoveToHistory(move) {
  if (!move || !move.san) return;

  // Avoid duplicate entries if called repeatedly for the same move
  const isDuplicate = recordedMoves.length > 0 &&
    recordedMoves[recordedMoves.length - 1].from === move.from &&
    recordedMoves[recordedMoves.length - 1].to === move.to &&
    recordedMoves[recordedMoves.length - 1].san === move.san;

  if (!isDuplicate) {
    recordedMoves.push(move);
  }

  const moveIndex = recordedMoves.length;
  moveCountEl.textContent = `${moveIndex} move${moveIndex === 1 ? '' : 's'}`;

  const moveNumber = Math.ceil(moveIndex / 2);
  let rowEl = document.getElementById(`history-turn-${moveNumber}`);

  if (!rowEl) {
    rowEl = document.createElement('div');
    rowEl.className = 'history-row';
    rowEl.id = `history-turn-${moveNumber}`;

    const numSpan = document.createElement('span');
    numSpan.className = 'history-num';
    numSpan.textContent = `${moveNumber}.`;
    rowEl.appendChild(numSpan);

    const whiteSpan = document.createElement('span');
    whiteSpan.className = 'history-white';
    rowEl.appendChild(whiteSpan);

    const blackSpan = document.createElement('span');
    blackSpan.className = 'history-black';
    rowEl.appendChild(blackSpan);

    moveHistoryEl.appendChild(rowEl);
  }

  if (move.color === 'w') {
    rowEl.querySelector('.history-white').textContent = move.san;
  } else {
    rowEl.querySelector('.history-black').textContent = move.san;
  }

  moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
}

// Calculate Captured Pieces and Material Advantage
function updateCapturedAndAdvantage() {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const initial = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }
  };

  const current = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }
  };

  chess.board().forEach(row => {
    row.forEach(p => {
      if (p) current[p.color][p.type]++;
    });
  });

  const capturedByWhite = [];
  const capturedByBlack = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const t of ['p', 'n', 'b', 'r', 'q']) {
    const bLost = initial.b[t] - current.b[t];
    for (let i = 0; i < bLost; i++) {
      capturedByWhite.push('b' + t);
      whiteMaterial += values[t];
    }

    const wLost = initial.w[t] - current.w[t];
    for (let i = 0; i < wLost; i++) {
      capturedByBlack.push('w' + t);
      blackMaterial += values[t];
    }
  }

  const isWhite = playerColor === 'w';
  const myCapturedPieces = isWhite ? capturedByWhite : capturedByBlack;
  const oppCapturedPieces = isWhite ? capturedByBlack : capturedByWhite;
  const myAdvantage = isWhite ? (whiteMaterial - blackMaterial) : (blackMaterial - whiteMaterial);

  renderCapturedTray(selfCapturedEl, myCapturedPieces, myAdvantage > 0 ? `+${myAdvantage}` : '');
  renderCapturedTray(oppCapturedEl, oppCapturedPieces, myAdvantage < 0 ? `+${Math.abs(myAdvantage)}` : '');
}

function renderCapturedTray(element, pieceList, diffText) {
  element.innerHTML = '';
  pieceList.forEach(code => {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'piece-icon';
    iconSpan.innerHTML = pieces[code];
    element.appendChild(iconSpan);
  });
  if (diffText) {
    const diffSpan = document.createElement('span');
    diffSpan.className = 'captured-diff';
    diffSpan.textContent = diffText;
    element.appendChild(diffSpan);
  }
}

// Game Over Handler
function handleGameOver(data) {
  gameStatus = 'ended';
  if (clockInterval) clearInterval(clockInterval);
  stopHeartbeat();

  const isWin = data.winner === playerColor;
  const isDraw = !data.winner;

  sounds.playGameOver(isWin);

  gameoverModal.classList.remove('hidden');

  if (isDraw) {
    gameoverBadge.textContent = 'DRAW';
    gameoverBadge.style.background = 'rgba(245, 158, 11, 0.2)';
    gameoverBadge.style.color = '#fbbf24';
    gameoverTitle.textContent = 'Game Drawn';
  } else if (isWin) {
    gameoverBadge.textContent = 'VICTORY';
    gameoverBadge.style.background = 'rgba(16, 185, 129, 0.2)';
    gameoverBadge.style.color = '#34d399';
    gameoverTitle.textContent = 'Victory!';
  } else {
    gameoverBadge.textContent = 'DEFEAT';
    gameoverBadge.style.background = 'rgba(239, 68, 68, 0.2)';
    gameoverBadge.style.color = '#f87171';
    gameoverTitle.textContent = 'Defeat';
  }

  gameoverDetails.textContent = data.details || `Game ended: ${data.reason}`;

  if (data.reason === 'anti_cheat_disqualification') {
    gameoverAnticheatStatus.textContent = 'Anti-Cheat Disqualification';
    gameoverAnticheatStatus.className = 'stat-val text-red';
  } else {
    gameoverAnticheatStatus.textContent = 'Verified Fair Play';
    gameoverAnticheatStatus.className = 'stat-val text-green';
  }
}

// ==========================================
// ADVANCED ANTI-CHEAT CLIENT SYSTEM
// ==========================================

// Authoritative Focus & Telemetry Heartbeat Ping (Requirement 4)
let heartbeatInterval = null;

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (socket && socket.connected && gameStatus === 'in_progress') {
      socket.emit('client_heartbeat', {
        focused: document.visibilityState === 'visible' && document.hasFocus(),
        timestamp: Date.now()
      });
    }
  }, 3000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Anti-Cheat State & Mouse Biometric Tracking
let mouseMovesInTurn = 0;
window.addEventListener('mousemove', () => {
  if (gameStatus === 'in_progress' && chess.turn() === playerColor) {
    mouseMovesInTurn++;
  }
});

function reportAntiCheatEvent(type) {
  if (gameStatus !== 'in_progress') return;

  const now = Date.now();
  if (lastReportedTime[type] && (now - lastReportedTime[type] < 6000)) {
    return;
  }
  lastReportedTime[type] = now;

  console.warn(`[Anti-Cheat Local Trigger] Event: ${type}`);
  sounds.playStrikeAlert();

  socket.emit('anti_cheat_event', {
    type: type,
    timestamp: now
  });

  // Local triggers only
}

function restoreFocus() {
  if (gameStatus !== 'in_progress') return;
  socket.emit('anti_cheat_focus_restored');
}

function handleAntiCheatStrike(data) {
  sounds.playStrikeAlert();

  if (data.playerColor === playerColor) {
    selfStrikes = data.strikes;
  } else {
    oppStrikes = data.strikes;
    monOppTab.textContent = `STRIKE ${oppStrikes}`;
    monOppTab.className = 'mon-val text-red';
    oppAnticheatBadge.textContent = `⚠️ Strike ${oppStrikes}/3 (${data.violationName || 'Fair-Play'})`;
    oppAnticheatBadge.className = 'telemetry-badge away';
  }
  updateTelemetryUI();
}

function handleAntiCheatFocusRestored(data) {
  if (data.playerColor !== playerColor) {
    monOppTab.textContent = 'ACTIVE';
    monOppTab.className = 'mon-val text-green';
    oppAnticheatBadge.textContent = '🟢 Tab Focused';
    oppAnticheatBadge.className = 'telemetry-badge';
  }
  updateTelemetryUI();
}

function updateTelemetryUI() {
  selfStrikesBadge.textContent = `${selfStrikes}/3 Strikes`;
  oppStrikesBadge.textContent = `${oppStrikes}/3 Strikes`;

  monSelfStrikes.textContent = `${selfStrikes} / 3`;
  monOppStrikes.textContent = `${oppStrikes} / 3`;

  if (selfStrikes > 0) {
    selfStrikesBadge.style.color = 'var(--accent-danger)';
  } else {
    selfStrikesBadge.style.color = 'var(--text-dim)';
  }

  if (oppStrikes > 0) {
    oppStrikesBadge.style.color = 'var(--accent-danger)';
  } else {
    oppStrikesBadge.style.color = 'var(--text-dim)';
  }
}

function appendAntiCheatLog(text, severity = 'system', time = null) {
  const logList = document.getElementById('anticheat-log-list');
  if (!logList) return;
  const timeStr = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `log-entry log-${severity}`;
  entry.textContent = `[${timeStr}] ${text}`;
  logList.appendChild(entry);
  logList.scrollTop = logList.scrollHeight;
}

// 1. Tab Visibility & Focus Grace Period (1.5-Second Anti-False-Positive Filter for OS Notifications & Screenshots)
let focusLossTimeout = null;
const FOCUS_GRACE_PERIOD_MS = 1500;

function handleFocusLost() {
  if (focusLossTimeout) clearTimeout(focusLossTimeout);

  focusLossTimeout = setTimeout(() => {
    if (document.visibilityState === 'hidden' || !document.hasFocus()) {
      isTabFocused = false;
      if (monSelfTab) {
        monSelfTab.textContent = 'AWAY';
        monSelfTab.className = 'mon-val text-red';
      }
      if (selfAnticheatBadge) {
        selfAnticheatBadge.textContent = '⚪ Tab Inactive';
        selfAnticheatBadge.className = 'telemetry-badge away';
      }
      if (gameStatus === 'in_progress') {
        socket.emit('anti_cheat_focus_lost', {
          timestamp: Date.now()
        });
      }
    }
  }, FOCUS_GRACE_PERIOD_MS);
}

function handleFocusGained() {
  if (focusLossTimeout) {
    clearTimeout(focusLossTimeout);
    focusLossTimeout = null;
  }

  const wasAway = !isTabFocused;
  isTabFocused = true;

  if (monSelfTab) {
    monSelfTab.textContent = 'ACTIVE';
    monSelfTab.className = 'mon-val text-green';
  }
  if (selfAnticheatBadge) {
    selfAnticheatBadge.textContent = '🟢 Tab Focused';
    selfAnticheatBadge.className = 'telemetry-badge';
  }

  if (wasAway && gameStatus === 'in_progress') {
    restoreFocus();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handleFocusLost();
  } else {
    handleFocusGained();
  }
});

window.addEventListener('blur', () => {
  handleFocusLost();
});

window.addEventListener('focus', () => {
  handleFocusGained();
});

// 3. DevTools, F12, and Cheat Shortcut Interception
window.addEventListener('keydown', (e) => {
  const key = e.key ? e.key.toUpperCase() : '';
  const isF12 = key === 'F12' || e.keyCode === 123;
  const isDevTools = (e.ctrlKey || e.metaKey) && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key);
  const isViewSource = (e.ctrlKey || e.metaKey) && ['U', 'S', 'P'].includes(key);

  if (isF12 || isDevTools || isViewSource) {
    e.preventDefault();
    e.stopPropagation();
    if (gameStatus === 'in_progress') {
      reportAntiCheatEvent('devtools_opened');
    }
    return false;
  }
}, true);

// 4. Anti-Cheat Clipboard Protection (Prevents FEN copying / engine move pasting)
document.addEventListener('copy', (e) => {
  if (gameStatus === 'in_progress') {
    e.preventDefault();
    reportAntiCheatEvent('clipboard_copy_attempt');
  }
});

document.addEventListener('paste', (e) => {
  if (gameStatus === 'in_progress') {
    e.preventDefault();
    reportAntiCheatEvent('clipboard_paste_attempt');
  }
});

// 5. Context Menu Blocker across Page (Prevents Element Inspection; Right-Click on board cancels Pre-Move)
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (currentPremove) {
    currentPremove = null;
    clearSelection();
    renderBoard();
  }
  return false;
});

// 6. Docked DevTools Detection (Checks window dimension shifts, avoiding sidebar false positives)
setInterval(() => {
  if (gameStatus === 'in_progress') {
    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    if ((heightDiff > 280 && widthDiff > 180) || heightDiff > 350) {
      reportAntiCheatEvent('devtools_opened');
    }
  }
}, 3000);

// ==========================================
// AUTHENTICATION & USER PROFILE CONTROLLER
// ==========================================

function showAuthMsg(el, msg, type = 'info') {
  if (!el) return;
  if (!msg || type === 'hidden') {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.className = `auth-message-box ${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function openAuthModal() {
  if (authModal) {
    authModal.classList.remove('hidden');
    if (!currentUser || !currentUser.accepted_terms) {
      authModal.classList.add('auth-lockout-backdrop');
      showAuthStep('email');
    }
    showAuthMsg(authMsgStep1, '', 'hidden');
    showAuthMsg(authMsgStep2, '', 'hidden');
    showAuthMsg(authMsgStep3, '', 'hidden');
    if (inputAuthUsername && currentUser) {
      inputAuthUsername.value = currentUser.username;
    }
    if (inputAuthEmail) inputAuthEmail.focus();
  }
}

function closeAuthModal() {
  if (currentUser && currentUser.accepted_terms) {
    if (authModal) {
      authModal.classList.add('hidden');
      authModal.classList.remove('auth-lockout-backdrop');
    }
  }
}

function lockAppForUnauthenticated() {
  if (appContainer) {
    appContainer.setAttribute('inert', '');
    appContainer.classList.add('auth-locked');
  }
  if (authModal) {
    authModal.classList.remove('hidden');
    authModal.classList.add('auth-lockout-backdrop');
  }
  showAuthStep('email');
}

function unlockApp() {
  if (appContainer) {
    appContainer.removeAttribute('inert');
    appContainer.classList.remove('auth-locked');
  }
  if (authModal) {
    authModal.classList.add('hidden');
    authModal.classList.remove('auth-lockout-backdrop');
  }
}

function showAuthStep(step) {
  if (authStepEmail) authStepEmail.classList.toggle('hidden', step !== 'email');
  if (authStepOtp) authStepOtp.classList.toggle('hidden', step !== 'otp');
  if (authStepTerms) authStepTerms.classList.toggle('hidden', step !== 'terms');
}

function completeAuthentication(token, profile) {
  updateCurrentUser(profile);
  unlockApp();
  initSocket(token);
}

function openProfileModal() {
  if (profileModal) {
    if (currentUser) updateCurrentUser(currentUser);
    profileModal.classList.remove('hidden');
  }
}

function closeProfileModal() {
  if (profileModal) profileModal.classList.add('hidden');
}

function startResendCountdown() {
  otpCountdownSeconds = 60;
  if (btnResendCode) {
    btnResendCode.disabled = true;
    btnResendCode.textContent = `Resend Code (${otpCountdownSeconds}s)`;
  }
  if (otpResendTimer) clearInterval(otpResendTimer);
  otpResendTimer = setInterval(() => {
    otpCountdownSeconds--;
    if (otpCountdownSeconds <= 0) {
      clearInterval(otpResendTimer);
      if (btnResendCode) {
        btnResendCode.disabled = false;
        btnResendCode.textContent = 'Resend Code';
      }
    } else {
      if (btnResendCode) {
        btnResendCode.textContent = `Resend Code (${otpCountdownSeconds}s)`;
      }
    }
  }, 1000);
}

async function sendAuthCode() {
  const email = inputAuthEmail.value.trim();
  const username = inputAuthUsername.value.trim() || 'Grandmaster';

  if (!email || !email.includes('@')) {
    showAuthMsg(authMsgStep1, 'Please enter a valid email address.', 'error');
    return;
  }

  btnSendCode.disabled = true;
  btnSendCode.innerHTML = '<span>⏳</span> Sending Code...';

  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username })
    });
    const data = await res.json();

    if (data.success) {
      showAuthStep('otp');
      if (authTargetEmail) authTargetEmail.textContent = email;
      showAuthMsg(authMsgStep2, data.message || 'Verification code sent to your Gmail inbox!', 'info');
      startResendCountdown();
      if (inputAuthOtp) inputAuthOtp.focus();
    } else {
      showAuthMsg(authMsgStep1, data.error || 'Failed to dispatch code.', 'error');
    }
  } catch (err) {
    showAuthMsg(authMsgStep1, 'Network error. Please try again.', 'error');
  } finally {
    btnSendCode.disabled = false;
    btnSendCode.innerHTML = '<span>📧</span> Send 6-Digit Verification Code';
  }
}

async function verifyAuthCode() {
  const email = inputAuthEmail.value.trim();
  const code = inputAuthOtp.value.trim();
  const username = inputAuthUsername.value.trim() || 'Grandmaster';

  if (!code || code.length < 4) {
    showAuthMsg(authMsgStep2, 'Please enter the 6-digit code.', 'error');
    return;
  }

  btnVerifyCode.disabled = true;
  btnVerifyCode.innerHTML = '<span>⏳</span> Verifying...';

  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, username })
    });
    const data = await res.json();

    if (data.success && data.profile) {
      currentUser = data.profile;
      localStorage.setItem('chess_auth_token', data.token);
      localStorage.setItem('chess_auth_user', JSON.stringify(data.profile));

      // Check if user has already accepted the Privacy & Fair-Play Agreement
      if (data.profile.accepted_terms) {
        localStorage.setItem('chess_accepted_terms', 'true');
        completeAuthentication(data.token, data.profile);
      } else {
        // Proceed to mandatory Step 3: Privacy & Fair-Play Agreement Gate
        showAuthStep('terms');
      }
    } else {
      showAuthMsg(authMsgStep2, data.error || 'Invalid code. Please try again.', 'error');
    }
  } catch (err) {
    showAuthMsg(authMsgStep2, 'Verification error. Please try again.', 'error');
  } finally {
    btnVerifyCode.disabled = false;
    btnVerifyCode.innerHTML = '<span>✓</span> Verify Code & Continue';
  }
}

async function acceptTermsAndEnter() {
  if (chkAcceptTerms && !chkAcceptTerms.checked) {
    showAuthMsg(authMsgStep3, 'You must check the agreement box to accept tournament terms.', 'error');
    return;
  }

  const token = localStorage.getItem('chess_auth_token');
  if (!token) {
    showAuthMsg(authMsgStep3, 'Authentication session lost. Please re-enter your email.', 'error');
    showAuthStep('email');
    return;
  }

  btnMandatoryAgree.disabled = true;
  btnMandatoryAgree.innerHTML = '<span>⏳</span> Recording Agreement...';

  try {
    const res = await fetch('/api/auth/accept-terms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (data.success && data.profile) {
      currentUser = data.profile;
      localStorage.setItem('chess_auth_user', JSON.stringify(data.profile));
      localStorage.setItem('chess_accepted_terms', 'true');
      completeAuthentication(token, data.profile);
    } else {
      showAuthMsg(authMsgStep3, data.error || 'Failed to record agreement.', 'error');
    }
  } catch (err) {
    showAuthMsg(authMsgStep3, 'Network error. Please try again.', 'error');
  } finally {
    btnMandatoryAgree.disabled = false;
    btnMandatoryAgree.innerHTML = '<span>🛡️</span> I Understand & Agree • Enter Stadium';
  }
}

function signOut() {
  localStorage.removeItem('chess_auth_token');
  localStorage.removeItem('chess_auth_user');
  localStorage.removeItem('chess_accepted_terms');
  currentUser = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  closeProfileModal();
  lockAppForUnauthenticated();
}

async function checkInitialAuth() {
  const savedToken = localStorage.getItem('chess_auth_token');
  const termsAccepted = localStorage.getItem('chess_accepted_terms') === 'true';

  if (!savedToken) {
    lockAppForUnauthenticated();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${savedToken}` }
    });
    const data = await res.json();

    if (data.success && data.profile && !data.profile.isGuest) {
      currentUser = data.profile;
      if (data.profile.accepted_terms || termsAccepted) {
        completeAuthentication(savedToken, data.profile);
      } else {
        lockAppForUnauthenticated();
        showAuthStep('terms');
      }
    } else {
      localStorage.removeItem('chess_auth_token');
      localStorage.removeItem('chess_auth_user');
      localStorage.removeItem('chess_accepted_terms');
      lockAppForUnauthenticated();
    }
  } catch (err) {
    const savedUserRaw = localStorage.getItem('chess_auth_user');
    let profile = null;
    try { profile = JSON.parse(savedUserRaw); } catch (e) {}
    if (profile && !profile.isGuest && termsAccepted) {
      completeAuthentication(savedToken, profile);
    } else {
      lockAppForUnauthenticated();
    }
  }
}

function updateCurrentUser(profile) {
  currentUser = profile;
  myElo = profile.elo || 1200;

  if (profile.username) {
    inputUsername.value = profile.username;
    if (selfNameEl) selfNameEl.textContent = profile.username;
  }

  const initial = (profile.username ? profile.username[0] : 'G').toUpperCase();

  // Header Widget
  if (profile.isGuest) {
    if (btnHeaderSignin) btnHeaderSignin.classList.remove('hidden');
    if (headerProfilePill) headerProfilePill.classList.add('hidden');
  } else {
    if (btnHeaderSignin) btnHeaderSignin.classList.add('hidden');
    if (headerProfilePill) headerProfilePill.classList.remove('hidden');
  }

  if (headerAvatar) headerAvatar.textContent = initial;
  if (headerUsername) headerUsername.textContent = profile.username;
  if (headerElo) headerElo.textContent = `${profile.elo} Elo`;

  // Lobby card
  if (lobbyAvatar) lobbyAvatar.textContent = initial;
  if (lobbyUsername) lobbyUsername.textContent = profile.username;
  if (lobbyGuestTag) {
    lobbyGuestTag.textContent = profile.isGuest ? 'Guest' : 'Verified';
    lobbyGuestTag.className = profile.isGuest ? 'badge-guest' : 'badge-guest badge-verified';
  }
  if (lobbyEloVal) lobbyEloVal.textContent = `${profile.elo} Elo`;
  if (lobbyRecord) lobbyRecord.textContent = `${profile.wins || 0}W • ${profile.losses || 0}L • ${profile.draws || 0}D`;

  if (btnLobbyAuth) {
    btnLobbyAuth.textContent = profile.isGuest ? 'Sign In' : 'Profile';
  }

  // Self card
  if (selfEloBadge) selfEloBadge.textContent = `${profile.elo} Elo`;

  // Profile modal fields
  if (profileBigAvatar) profileBigAvatar.textContent = initial;
  if (profileUsername) profileUsername.textContent = profile.username;
  if (profileEmail) profileEmail.textContent = profile.email || 'guest@chess.local';
  if (profileElo) profileElo.textContent = profile.elo;
  if (profileHighestElo) profileHighestElo.textContent = profile.highestElo || profile.elo;
  if (profileGamesCount) profileGamesCount.textContent = profile.gamesPlayed || 0;
  if (profileWinRate) profileWinRate.textContent = `${profile.winRate || 0}%`;
  if (profileRecordText) profileRecordText.textContent = `${profile.wins || 0} Wins • ${profile.losses || 0} Losses • ${profile.draws || 0} Draws`;
}

function handleEloUpdated(data) {
  const isWhite = playerColor === 'w';
  const myData = isWhite ? data.white : data.black;

  if (myData) {
    if (currentUser) {
      currentUser.elo = myData.newElo;
      currentUser.highestElo = Math.max(currentUser.highestElo || 0, myData.newElo);
      localStorage.setItem('chess_auth_user', JSON.stringify(currentUser));
      updateCurrentUser(currentUser);
    }

    if (gameoverEloBox && gameoverEloChange) {
      gameoverEloBox.classList.remove('hidden');
      const sign = myData.delta >= 0 ? '+' : '';
      const isPositive = myData.delta >= 0;
      gameoverEloChange.textContent = `${sign}${myData.delta} Elo (${myData.oldElo} → ${myData.newElo})`;
      gameoverEloChange.className = `elo-box-value ${isPositive ? 'text-green' : 'text-red'}`;
    }
  }
}

// Attach Auth & Profile Event Listeners
if (btnHeaderSignin) btnHeaderSignin.addEventListener('click', openAuthModal);
if (headerProfilePill) headerProfilePill.addEventListener('click', openProfileModal);
if (btnCloseProfile) btnCloseProfile.addEventListener('click', closeProfileModal);
if (btnLobbyAuth) btnLobbyAuth.addEventListener('click', () => {
  if (currentUser && !currentUser.isGuest) openProfileModal();
  else openAuthModal();
});
if (authModal) {
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });
}
if (profileModal) {
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) closeProfileModal();
  });
}
if (linkAuthPolicy) {
  linkAuthPolicy.addEventListener('click', () => {
    openPrivacyModal();
  });
}
if (btnSendCode) btnSendCode.addEventListener('click', sendAuthCode);
if (btnVerifyCode) btnVerifyCode.addEventListener('click', verifyAuthCode);
if (btnMandatoryAgree) btnMandatoryAgree.addEventListener('click', acceptTermsAndEnter);
if (btnChangeEmail) {
  btnChangeEmail.addEventListener('click', () => {
    showAuthStep('email');
    showAuthMsg(authMsgStep1, '', 'hidden');
  });
}
if (btnResendCode) {
  btnResendCode.addEventListener('click', () => {
    if (otpCountdownSeconds <= 0) sendAuthCode();
  });
}
if (btnSignOut) btnSignOut.addEventListener('click', signOut);

if (inputAuthEmail) {
  inputAuthEmail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendAuthCode();
  });
}
if (inputAuthOtp) {
  inputAuthOtp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyAuthCode();
  });
}

// Global Escape Key Gatekeeper: Prevents dismissing the auth gate modal
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!currentUser || !currentUser.accepted_terms) {
      e.preventDefault();
      e.stopPropagation();
    } else {
      closeAuthModal();
      closePrivacyModal();
      closeProfileModal();
    }
  }
});

// Privacy & Fair-Play Modal event listeners
function openPrivacyModal() {
  if (privacyModal) privacyModal.classList.remove('hidden');
}

function closePrivacyModal() {
  if (privacyModal) privacyModal.classList.add('hidden');
}

if (btnPrivacy) btnPrivacy.addEventListener('click', openPrivacyModal);
if (linkPrivacy) linkPrivacy.addEventListener('click', (e) => {
  e.preventDefault();
  openPrivacyModal();
});
if (btnClosePrivacy) btnClosePrivacy.addEventListener('click', closePrivacyModal);
if (btnPrivacyOk) btnPrivacyOk.addEventListener('click', closePrivacyModal);
if (privacyModal) {
  privacyModal.addEventListener('click', (e) => {
    if (e.target === privacyModal) closePrivacyModal();
  });
}

btnFindMatch.addEventListener('click', () => {
  sounds.init();
  sendUsername();
  socket.emit('join_matchmaking');
});

btnCancelQueue.addEventListener('click', () => {
  socket.emit('leave_matchmaking');
});

btnCreateRoom.addEventListener('click', () => {
  sounds.init();
  sendUsername();
  socket.emit('create_room');
});

btnJoinRoom.addEventListener('click', () => {
  const code = inputRoomCode.value.trim();
  if (!code) {
    alert('Please enter a room code');
    return;
  }
  sounds.init();
  sendUsername();
  socket.emit('join_room', code);
});

btnCopyRoomCode.addEventListener('click', () => {
  const code = createdRoomCode.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btnCopyRoomCode.textContent = 'Copied!';
    setTimeout(() => { btnCopyRoomCode.textContent = 'Copy'; }, 2000);
  });
});

btnSaveUsername.addEventListener('click', () => {
  const newName = inputUsername.value.trim();
  if (!newName) return;
  if (currentUser && currentUser.username === newName) {
    btnSaveUsername.textContent = 'Saved!';
    setTimeout(() => { btnSaveUsername.textContent = 'Set'; }, 1500);
    return;
  }
  btnSaveUsername.disabled = true;
  btnSaveUsername.textContent = 'Saving...';
  socket.emit('set_username', newName);
});

btnOfferDraw.addEventListener('click', () => {
  socket.emit('offer_draw');
  btnOfferDraw.disabled = true;
  btnOfferDraw.textContent = 'Draw Offered...';
  setTimeout(() => {
    btnOfferDraw.disabled = false;
    btnOfferDraw.textContent = 'Offer Draw';
  }, 10000);
});

btnResign.addEventListener('click', () => {
  if (confirm('Are you sure you want to resign this match?')) {
    socket.emit('resign');
  }
});

btnAcceptDraw.addEventListener('click', () => {
  socket.emit('respond_draw', { accept: true });
  drawOfferAlert.classList.add('hidden');
});

btnDeclineDraw.addEventListener('click', () => {
  socket.emit('respond_draw', { accept: false });
  drawOfferAlert.classList.add('hidden');
});

btnGameoverRematch.addEventListener('click', () => {
  gameoverModal.classList.add('hidden');
  panelGame.classList.add('hidden');
  panelLobby.classList.remove('hidden');
  document.body.classList.remove('match-active');
  gameStatus = 'lobby';
  sounds.init();
  sendUsername();
  socket.emit('join_matchmaking');
});

btnGameoverLobby.addEventListener('click', () => {
  gameoverModal.classList.add('hidden');
  panelGame.classList.add('hidden');
  panelLobby.classList.remove('hidden');
  document.body.classList.remove('match-active');
  gameStatus = 'lobby';
});

btnSoundToggle.addEventListener('click', () => {
  const isMuted = sounds.toggleMute();
  soundIcon.textContent = isMuted ? '🔇' : '🔊';
});

if (btnCopyCfUrl && cfUrlText) {
  btnCopyCfUrl.addEventListener('click', () => {
    const url = cfUrlText.textContent;
    navigator.clipboard.writeText(url).then(() => {
      btnCopyCfUrl.textContent = 'Link Copied!';
      setTimeout(() => { btnCopyCfUrl.textContent = 'Copy Share Link'; }, 2000);
    });
  });
}

// Fullscreen & Flip Toolbar buttons
if (btnToggleFullscreen) {
  btnToggleFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      btnToggleFullscreen.textContent = '⛶ Exit Full';
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      btnToggleFullscreen.textContent = '⛶ Fullscreen';
    }
  });
}

if (btnFlipBoard) {
  btnFlipBoard.addEventListener('click', () => {
    isFlipped = !isFlipped;
    renderBoard();
  });
}

// Check if Cloudflare Tunnel is already configured on load
fetch('/api/tunnel-info')
  .then(res => res.json())
  .then(data => {
    if (cloudflareBanner && cfUrlText && data.cloudflareUrl) {
      cloudflareBanner.classList.remove('hidden');
      cfUrlText.textContent = data.cloudflareUrl;
      cfUrlText.href = data.cloudflareUrl;
    }
  })
  .catch(() => {});

// DOM Integrity Observer: Detects and removes foreign extension cheat overlays / injected canvas/svg
function initDomIntegrityObserver() {
  const allowedClasses = new Set([
    'square', 'light', 'dark', 'square-light', 'square-dark',
    'piece', 'selected', 'selected-piece', 'last-move-src', 'last-move-dst',
    'last-move-light', 'last-move-dark', 'in-check',
    'move-hint-dot', 'move-hint-capture', 'coord-label', 'coord-rank', 'coord-file',
    'rank-label', 'file-label', 'has-friendly', 'dragging',
    'animating-slide', 'landing-bounce', 'fade-capture',
    'premove-src', 'premove-dst'
  ]);

  const observer = new MutationObserver((mutations) => {
    if (gameStatus !== 'in_progress' || isEngineRendering) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          // External cheat extensions inject canvases, iframes, or custom overlay divs/svgs
          if (tag === 'canvas' || tag === 'iframe' || tag === 'embed') {
            node.remove();
            reportAntiCheatEvent('unauthorized_dom_injection');
            return;
          }

          // If injected div or svg has unrecognized classes
          const classes = Array.from(node.classList);
          const isKnown = classes.length === 0 || classes.some(c => allowedClasses.has(c));
          const isPieceSvg = node.closest('.piece') !== null || tag === 'svg' || tag === 'path' || tag === 'g';

          if (!isKnown && !isPieceSvg) {
            console.warn('[Anti-Cheat] Foreign DOM Node detected:', node);
            node.remove();
            reportAntiCheatEvent('unauthorized_dom_injection');
            return;
          }
        }
      }
    }
  });

  observer.observe(boardEl, { childList: true, subtree: true });
}

// DevTools, Console & Anti-Tamper Security Shield
function initDevtoolsDetection() {
  // Neutralize console tampering hooks
  try {
    const banner = () => {
      console.clear();
      console.log('%c🔒 CHESS FAIR-PLAY SECURITY ACTIVE', 'color: #00e676; font-size: 16px; font-weight: bold;');
      console.log('%cDevTools cheats, console scripting, and automated bots are strictly forbidden.', 'color: #94a3b8; font-size: 12px;');
    };
    window.console.warn = () => {};
    window.console.debug = () => {};
    window.console.info = () => {};
    window.console.clear = banner;
    banner();
  } catch (err) {}

  const devtoolsTrap = new Image();
  Object.defineProperty(devtoolsTrap, 'id', {
    get: function() {
      if (gameStatus === 'in_progress') {
        reportAntiCheatEvent('devtools_opened');
      }
    }
  });

  setInterval(() => {
    if (gameStatus === 'in_progress') {
      console.log('%c', devtoolsTrap);
    }
  }, 3500);
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  // Mobile & Cross-Device AudioContext Pre-Warm (unlocks procedural sound buffers on first gesture)
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, () => {
      sounds.init();
    }, { once: true, passive: true });
  });

  renderBoard();
  initDomIntegrityObserver();
  initDevtoolsDetection();
  checkInitialAuth();
});
