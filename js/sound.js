// 駒音（音声ファイルを使わず Web Audio で合成する）
let ctx = null;

export function audio() {
  if (!ctx) {
    const AC = self.AudioContext || self.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// 盤に駒を打ちつける「ピシッ」という音
// 立ち上がりの鋭い高音のノイズと、木のような短い共鳴を重ねる。低音はほとんど入れない
export function playPieceSound() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.9;
  out.connect(ac.destination);

  // 1. 打った瞬間の「ピッ」: 15ミリ秒のノイズを高域だけ通す
  const len = Math.floor(ac.sampleRate * 0.015);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(1.0, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
  noise.connect(hp).connect(ng).connect(out);
  noise.start(t);

  // 2. 「シッ」と締まる木の響き: 高めの共鳴をごく短く
  for (const [f, g, dur] of [[2650, 0.35, 0.035], [1750, 0.25, 0.045], [4300, 0.12, 0.02]]) {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.92, t + dur);
    const og = ac.createGain();
    og.gain.setValueAtTime(g, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + dur + 0.01);
  }
}

// 時計の「ピッ」。high は最後の数秒用の高い音
export function playBeep(high = false) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.value = high ? 2000 : 1500;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.005);
  g.gain.setValueAtTime(0.35, t + 0.07);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + 0.12);
}

// 最初の操作で音を出せる状態にしておく（ブラウザの自動再生制限のため）
export function unlockAudio() {
  const fn = () => { audio(); document.removeEventListener('pointerdown', fn); };
  document.addEventListener('pointerdown', fn);
}
