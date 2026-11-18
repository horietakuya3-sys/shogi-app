// 駒音（音声ファイルを使わず Web Audio で合成する）
let ctx = null;

function audio() {
  if (!ctx) {
    const AC = self.AudioContext || self.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 盤に駒を打ちつける「パチッ」という音
export function playPieceSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  // 高めの乾いた打撃音（ノイズを帯域通過）
  const len = Math.floor(ac.sampleRate * 0.06);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  noise.connect(bp).connect(ng).connect(ac.destination);
  noise.start(t);
  // 盤の胴鳴り（低い短い音）
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.08);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

// 最初の操作で音を出せる状態にしておく（ブラウザの自動再生制限のため）
export function unlockAudio() {
  const fn = () => { audio(); document.removeEventListener('pointerdown', fn); };
  document.addEventListener('pointerdown', fn);
}
