// Programmatic sound synthesis via Web Audio API.
// No external audio files required — all sounds are generated at runtime.

let _ctx: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    if (!_ctx || _ctx.state === "closed") _ctx = new AudioContext();
    if (_ctx.state === "suspended") void _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

// Resume the AudioContext on the first user gesture so autoplay policies are satisfied.
export function unlockAudio() {
  ctx();
}

// ---------- Low-level helpers ----------

function osc(
  frequency: number,
  type: OscillatorType,
  gain: number,
  duration: number,
  offset = 0,
  freqEnd?: number,
) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + offset;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(frequency, t);
  if (freqEnd !== undefined) {
    o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + duration);
  }
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + duration);
}

function noise(gainVal: number, duration: number, offset = 0, filterFreq = 2000, filterQ = 1) {
  const c = ctx();
  if (!c) return;
  const t = c.currentTime + offset;
  const bufSize = c.sampleRate * duration;
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = filterFreq;
  filt.Q.value = filterQ;
  const g = c.createGain();
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filt);
  filt.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.stop(t + duration);
}

// ---------- Public sound effects ----------

/** Short UI tap — button press, card select */
export function playTap() {
  osc(900, "sine", 0.18, 0.06);
  osc(600, "sine", 0.08, 0.06, 0.01);
}

/** Dice rolling rattle */
export function playDiceRoll() {
  const offsets = [0, 0.06, 0.12, 0.19, 0.27, 0.36];
  offsets.forEach((off, i) => {
    const vol = 0.25 - i * 0.03;
    noise(vol, 0.06, off, 1800 - i * 100, 3);
  });
  osc(140, "sine", 0.35, 0.12, 0.42);
  noise(0.15, 0.08, 0.42, 500, 5);
}

/** Piece tapped / selected */
export function playPieceTap() {
  osc(520, "triangle", 0.22, 0.1);
  osc(780, "sine", 0.08, 0.06, 0.01);
}

/** Piece moved one step */
export function playPieceMove() {
  osc(320, "triangle", 0.20, 0.08);
  noise(0.06, 0.05, 0.02, 1200, 2);
}

/** Piece captured opponent */
export function playCapture() {
  osc(600, "sawtooth", 0.15, 0.04);
  osc(300, "sine", 0.30, 0.18, 0.04, 80);
  noise(0.12, 0.12, 0.04, 800, 4);
}

/** Piece reached home */
export function playPieceHome() {
  [[523, 0], [659, 0.13], [784, 0.26]].forEach(([f, off]) => {
    osc(f, "sine", 0.28, 0.22, off);
    osc(f * 2, "sine", 0.08, 0.15, off);
  });
}

/** Card selected in hand */
export function playCardSelect() {
  osc(700, "sine", 0.16, 0.07);
  osc(1050, "sine", 0.06, 0.05, 0.01);
}

/** Card played to pile */
export function playCardPlay() {
  noise(0.20, 0.14, 0, 3000, 1.5);
  osc(260, "triangle", 0.18, 0.14, 0.05, 140);
}

/** Draw a card from deck */
export function playCardDraw() {
  noise(0.18, 0.10, 0, 2200, 2);
  osc(380, "sine", 0.12, 0.09, 0.04, 300);
}

/** Victory fanfare — C4 E4 G4 C5 */
export function playWin() {
  [[262, 0], [330, 0.14], [392, 0.28], [523, 0.42], [523, 0.62]].forEach(([f, off]) => {
    osc(f, "sine", 0.30, 0.28, off);
    osc(f * 1.5, "sine", 0.08, 0.20, off);
  });
}

/** Lose — descending C4 A3 F3 */
export function playLose() {
  [[262, 0], [220, 0.22], [175, 0.44]].forEach(([f, off]) => {
    osc(f, "sine", 0.25, 0.30, off);
  });
  osc(110, "sine", 0.15, 0.40, 0.60, 80);
}

/** Harsh buzzer — negative result / wrong answer / mine hit */
export function playBuzzer() {
  osc(180, "square", 0.38, 0.22, 0, 85);
  osc(130, "sawtooth", 0.28, 0.28, 0.04, 60);
  osc(100, "square", 0.20, 0.20, 0.12, 50);
  noise(0.18, 0.25, 0, 350, 6);
}

// ---------- Mines game sounds ----------

/** Tile click — subtle tap when selecting a hidden tile */
export function playMinesTileClick() {
  noise(0.10, 0.035, 0, 3200, 2.5);
  osc(480, "sine", 0.09, 0.045);
}

/** Gem revealed — sparkling rising chime */
export function playMinesGemReveal() {
  osc(880, "sine", 0.22, 0.14);
  osc(1320, "sine", 0.13, 0.11, 0.04);
  osc(1760, "sine", 0.07, 0.09, 0.09);
  noise(0.06, 0.08, 0.02, 5000, 1.5);
}

/** Mine exploded — deep rumbling boom */
export function playMinesExplosion() {
  osc(80, "sawtooth", 0.42, 0.32, 0, 28);
  osc(55, "square", 0.30, 0.28, 0.03, 20);
  noise(0.55, 0.32, 0, 550, 1.2);
  noise(0.30, 0.22, 0.09, 180, 3);
  osc(220, "sawtooth", 0.18, 0.18, 0.02, 60);
}

/** Cashout — ascending coin cascade jingle */
export function playMinesCashout() {
  [[523, 0], [659, 0.07], [784, 0.14], [1047, 0.21], [1319, 0.30]].forEach(([f, off]) => {
    osc(f, "sine", 0.26, 0.18, off);
    osc(f * 1.5, "sine", 0.09, 0.12, off + 0.02);
  });
  noise(0.08, 0.18, 0.28, 4500, 1.2);
}
