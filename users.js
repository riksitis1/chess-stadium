const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabaseClient');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache of users: userId -> userObject
const usersCache = new Map();

// Load users from disk
function loadUsersFromDisk() {
  if (fs.existsSync(USERS_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach(u => usersCache.set(u.id, u));
        console.log(`[Database] Loaded ${usersCache.size} persistent user profiles from disk.`);
      }
    } catch (err) {
      console.error('[Database Error] Failed to read users.json:', err.message);
    }
  }
}

// Mutex queue to serialize critical multi-step user state mutations (prevents race conditions)
let mutationQueue = Promise.resolve();

function runAtomicMutation(task) {
  const result = mutationQueue.then(() => task());
  mutationQueue = result.catch(() => {});
  return result;
}

// Save users to disk atomically using temporary file + atomic rename
// Eliminates partial writes or 0-byte corruption during sudden crashes
function saveUsersToDisk() {
  try {
    const list = Array.from(usersCache.values());
    const tempFile = `${USERS_FILE}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tempFile, USERS_FILE); // Atomic filesystem replacement
  } catch (err) {
    console.error('[Database Error] Failed to write users.json atomically:', err.message);
  }
}

// Initial load
loadUsersFromDisk();

/**
 * Get user by unique ID
 */
function getUserById(id) {
  if (!id) return null;
  let user = usersCache.get(id);
  if (!user && fs.existsSync(USERS_FILE)) {
    loadUsersFromDisk();
    user = usersCache.get(id);
  }
  return user || null;
}

/**
 * Get user by email
 */
function getUserByEmail(email) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  for (const user of usersCache.values()) {
    if (user.email && user.email.toLowerCase() === normalized) {
      return user;
    }
  }
  if (fs.existsSync(USERS_FILE)) {
    loadUsersFromDisk();
    for (const user of usersCache.values()) {
      if (user.email && user.email.toLowerCase() === normalized) {
        return user;
      }
    }
  }
  return null;
}

/**
 * Create or update a persistent user account
 */
async function createOrUpdateUser({ id, email, username, isGuest = false, accepted_terms = false }) {
  return runAtomicMutation(async () => {
    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    let user = id ? getUserById(id) : (normalizedEmail ? getUserByEmail(normalizedEmail) : null);

  if (!user) {
    const newId = id || (isGuest ? 'gst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) : 'usr_' + Date.now());
    user = {
      id: newId,
      email: normalizedEmail || `guest_${newId}@chess.local`,
      username: username || (isGuest ? `Guest_${newId.slice(-4)}` : 'Grandmaster'),
      elo: 1200, // Standard Chess.com starting Elo
      highestElo: 1200,
      trustFactor: 100, // Hidden secret trust factor (0 to 100)
      isGuest: Boolean(isGuest),
      accepted_terms: Boolean(accepted_terms),
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      recentMatches: [],
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    };
    usersCache.set(user.id, user);
  } else {
    // Update existing user fields
    if (username && username.trim()) user.username = username.trim();
    if (normalizedEmail) user.email = normalizedEmail;
    if (accepted_terms !== undefined && accepted_terms !== null) user.accepted_terms = Boolean(accepted_terms);
    user.lastSeenAt = Date.now();
  }

  saveUsersToDisk();

  // Async sync to Supabase database if configured
  if (supabase && !user.isGuest) {
    try {
      supabase.from('profiles').upsert({
        id: user.id,
        email: user.email,
        username: user.username,
        elo: user.elo,
        games_played: user.gamesPlayed,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        updated_at: new Date().toISOString()
      }).catch(err => {
        // Silent fail if profiles table not created yet
      });
    } catch (e) {}
  }

    return user;
  });
}

/**
 * Standard Chess.com Elo Calculation Formula
 * @param {number} ratingA - Player A's Elo
 * @param {number} ratingB - Player B's Elo
 * @param {number} scoreA - 1 for Win, 0.5 for Draw, 0 for Loss
 * @param {number} gamesA - Games played by A
 * @param {number} gamesB - Games played by B
 */
function calculateEloChange(ratingA, ratingB, scoreA, gamesA = 20, gamesB = 20) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;

  // Provisional K=32 for early matches, standard K=20 for veterans
  const kA = gamesA < 20 ? 32 : 20;
  const kB = gamesB < 20 ? 32 : 20;

  const deltaA = Math.round(kA * (scoreA - expectedA));
  const deltaB = Math.round(kB * (scoreB - expectedB));

  return {
    deltaA,
    deltaB,
    newRatingA: Math.max(100, ratingA + deltaA),
    newRatingB: Math.max(100, ratingB + deltaB)
  };
}

/**
 * Record Match Outcome and Update Elo Ratings for White and Black
 */
async function recordMatchOutcome(whiteUserId, blackUserId, winnerColor, details = {}) {
  return runAtomicMutation(async () => {
    const whiteUser = getUserById(whiteUserId);
    const blackUser = getUserById(blackUserId);

  if (!whiteUser || !blackUser) {
    console.warn('[Database] Cannot update Elo: player user profile not found', { whiteUserId, blackUserId });
    return null;
  }

  // score: 1 if white won, 0 if black won, 0.5 if draw
  let whiteScore = 0.5;
  if (winnerColor === 'w') whiteScore = 1;
  else if (winnerColor === 'b') whiteScore = 0;

  const { deltaA, deltaB, newRatingA, newRatingB } = calculateEloChange(
    whiteUser.elo,
    blackUser.elo,
    whiteScore,
    whiteUser.gamesPlayed,
    blackUser.gamesPlayed
  );

  const whiteOld = whiteUser.elo;
  const blackOld = blackUser.elo;

  // Apply ratings
  whiteUser.elo = newRatingA;
  blackUser.elo = newRatingB;

  whiteUser.highestElo = Math.max(whiteUser.highestElo, newRatingA);
  blackUser.highestElo = Math.max(blackUser.highestElo, newRatingB);

  whiteUser.gamesPlayed++;
  blackUser.gamesPlayed++;

  if (winnerColor === 'w') {
    whiteUser.wins++;
    blackUser.losses++;
  } else if (winnerColor === 'b') {
    blackUser.wins++;
    whiteUser.losses++;
  } else {
    whiteUser.draws++;
    blackUser.draws++;
  }

  // Clean play reward: slight trust factor boost (+2) if match finished without cheating
  if (whiteUser.trustFactor < 100) whiteUser.trustFactor = Math.min(100, whiteUser.trustFactor + 2);
  if (blackUser.trustFactor < 100) blackUser.trustFactor = Math.min(100, blackUser.trustFactor + 2);

  saveUsersToDisk();

  console.log(`[Elo Update] White ${whiteUser.username}: ${whiteOld} -> ${newRatingA} (${deltaA >= 0 ? '+' : ''}${deltaA}) | Black ${blackUser.username}: ${blackOld} -> ${newRatingB} (${deltaB >= 0 ? '+' : ''}${deltaB})`);

  return {
    white: {
      userId: whiteUser.id,
      username: whiteUser.username,
      oldElo: whiteOld,
      newElo: newRatingA,
      delta: deltaA
    },
    black: {
      userId: blackUser.id,
      username: blackUser.username,
      oldElo: blackOld,
      newElo: newRatingB,
      delta: deltaB
    }
  };
  });
}

/**
 * Secret Trust Factor Adjustment (Never exposed to client UI)
 * @param {string} userId - Target player ID
 * @param {number} delta - Negative penalty (e.g. -20 for bot moves, -30 for DQ)
 * @param {string} reason - Log explanation for admin/server auditing
 */
function adjustSecretTrustFactor(userId, delta, reason) {
  return runAtomicMutation(async () => {
    const user = getUserById(userId);
    if (!user) return;

    const oldTrust = user.trustFactor !== undefined ? user.trustFactor : 100;
    user.trustFactor = Math.max(0, Math.min(100, oldTrust + delta));

    console.log(`🛡️ [SECRET TRUST FACTOR] User ${user.username} (${user.id}): ${oldTrust} -> ${user.trustFactor} (Delta: ${delta}, Reason: ${reason})`);
    saveUsersToDisk();
  });
}

/**
 * Get safe public profile (for opponents, leaderboards, matches)
 * STRICTLY OMITS: email, trustFactor, internal logs, IP, etc.
 */
function getPublicProfile(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const winRate = user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;

  return {
    id: user.id,
    username: user.username,
    elo: user.elo,
    highestElo: user.highestElo,
    gamesPlayed: user.gamesPlayed,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    winRate: winRate,
    isGuest: Boolean(user.isGuest),
    accepted_terms: Boolean(user.accepted_terms)
  };
}

/**
 * Get private user profile (ONLY for the authenticated owner)
 * Contains email and account metadata, but STILL omits internal secret trustFactor
 */
function getPrivateProfile(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  const winRate = user.gamesPlayed > 0 ? Math.round((user.wins / user.gamesPlayed) * 100) : 0;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    elo: user.elo,
    highestElo: user.highestElo,
    gamesPlayed: user.gamesPlayed,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    winRate: winRate,
    isGuest: Boolean(user.isGuest),
    accepted_terms: Boolean(user.accepted_terms),
    createdAt: user.createdAt
  };
}

module.exports = {
  getUserById,
  getUserByEmail,
  createOrUpdateUser,
  calculateEloChange,
  recordMatchOutcome,
  adjustSecretTrustFactor,
  getPublicProfile,
  getPrivateProfile
};
