// Studio-Grade Web Audio API Procedural Synthesizer for Chess
// Simulates weighted physical Staunton wooden pieces on a felted tournament board

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.noiseCache = new Map();
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.preloadBuffers();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  preloadBuffers() {
    if (!this.ctx) return;
    this.getNoiseBuffer(0.035, 5);
    this.getNoiseBuffer(0.045, 6);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  // Retrieve cached noise buffer or generate on first request
  getNoiseBuffer(duration, decayPower = 4) {
    if (!this.ctx) this.init();
    const key = `${duration}_${decayPower}`;
    if (this.noiseCache.has(key)) {
      return this.noiseCache.get(key);
    }
    const buf = this.createNoiseBuffer(duration, decayPower);
    this.noiseCache.set(key, buf);
    return buf;
  }

  // Create filtered noise buffer for realistic wooden transients
  createNoiseBuffer(duration, decayPower = 4) {
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayPower);
    }
    return buffer;
  }

  // Soft tactile piece lift / tap (when pressing a piece)
  playSelect() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.04);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Deep, Punchy, Weighted Wooden Piece Impact (Satisfying Staunton Thud)
  playMove() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    // 1. Sub-bass acoustic weight (solid wooden base with lead weight hitting felt)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(170, now);
    subOsc.frequency.exponentialRampToValueAtTime(55, now + 0.09);

    subGain.gain.setValueAtTime(0.65, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.1);

    // 2. Hollow wooden board body resonance (mid tone)
    const midOsc = this.ctx.createOscillator();
    const midGain = this.ctx.createGain();
    midOsc.type = 'triangle';
    midOsc.frequency.setValueAtTime(320, now);
    midOsc.frequency.exponentialRampToValueAtTime(120, now + 0.06);

    midGain.gain.setValueAtTime(0.35, now);
    midGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    midOsc.connect(midGain);
    midGain.connect(this.ctx.destination);
    midOsc.start(now);
    midOsc.stop(now + 0.07);

    // 3. Crisp wood grain contact click (transient)
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(0.035, 5);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.Q.value = 3.0;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start(now);
  }

  // Heavy, Crunchy Wooden Capture Strike (Piece knocking enemy piece off board)
  playCapture() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    // 1. Initial sharp wood crack (Piece-to-piece collision)
    const crackNoise = this.ctx.createBufferSource();
    crackNoise.buffer = this.getNoiseBuffer(0.045, 6);

    const crackFilter = this.ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(2200, now);
    crackFilter.Q.value = 2.0;

    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(0.7, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    crackNoise.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(this.ctx.destination);
    crackNoise.start(now);

    // 2. Heavy physical impact body (heavier weight)
    const bodyOsc = this.ctx.createOscillator();
    const bodyGain = this.ctx.createGain();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(280, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(45, now + 0.14);

    bodyGain.gain.setValueAtTime(0.85, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(this.ctx.destination);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.15);

    // 3. Secondary table knock (landing after knockback)
    const secondOsc = this.ctx.createOscillator();
    const secondGain = this.ctx.createGain();
    secondOsc.type = 'triangle';
    secondOsc.frequency.setValueAtTime(190, now + 0.035);
    secondOsc.frequency.exponentialRampToValueAtTime(70, now + 0.11);

    secondGain.gain.setValueAtTime(0.4, now + 0.035);
    secondGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    secondOsc.connect(secondGain);
    secondGain.connect(this.ctx.destination);
    secondOsc.start(now + 0.035);
    secondOsc.stop(now + 0.12);
  }

  // Castling Double-Thud (King & Rook sliding/landing in rapid sequence)
  playCastle() {
    if (this.muted) return;
    this.playMove();
    setTimeout(() => {
      this.playMove();
    }, 110);
  }

  // Crystal Clear Harmonic Check Bell
  playCheck() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    // First impact thump
    this.playMove();

    // Dual resonant crystal chime (A5 880Hz + E6 1318.5Hz)
    const freqs = [880, 1318.51, 1760];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + 0.02);

      const amp = 0.28 / (idx + 1);
      gain.gain.setValueAtTime(amp, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + 0.02);
      osc.stop(now + 0.48);
    });
  }

  // Triumphant Pawn Promotion Fanfare (Golden Shimmer)
  playPromotion() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);

      gain.gain.setValueAtTime(0.3, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.38);
    });
  }

  // Resonant Tournament Match Start Gong
  playMatchStart() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    // Deep warm gong fundamental + harmonics
    const gongPitches = [196, 392, 587.33, 783.99]; // G3, G4, D5, G5
    gongPitches.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = idx === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      const vol = 0.25 / (idx + 1);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 1.25);
    });
  }

  // High-Tech Cyber Anti-Cheat Warning Siren
  playStrikeAlert() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    const tones = [980, 520, 980, 520, 980];
    tones.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);

      gain.gain.setValueAtTime(0.3, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.09);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.095);
    });
  }

  // Game over sound (Victory Fanfare or Defeat Cadence)
  playGameOver(isWin) {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    if (isWin) {
      // Grand victory fanfare
      const melody = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      melody.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);

        gain.gain.setValueAtTime(0.32, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.55);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.6);
      });
    } else {
      // Somber defeat minor chord
      const chords = [440, 370, 329.63, 220];
      chords.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.14);

        gain.gain.setValueAtTime(0.18, now + i * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.6);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + i * 0.14);
        osc.stop(now + i * 0.14 + 0.65);
      });
    }
  }

  // Subtle clock low time tick
  playTick() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  }
}

export const sounds = new SoundEngine();
