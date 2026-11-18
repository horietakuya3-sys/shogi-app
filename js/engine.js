// やねうら王（WASM版）とのやりとり
// 検索中に新しい依頼が来たら stop → bestmove を待ってから次を始める

const SCRIPT = 'engine/yaneuraou.k-p.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('エンジンのファイルを読み込めませんでした'));
    document.head.appendChild(s);
  });
}

export function parseInfo(line) {
  const t = line.split(/\s+/);
  const r = { multipv: 1 };
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === 'depth') r.depth = Number(t[++i]);
    else if (k === 'seldepth') r.seldepth = Number(t[++i]);
    else if (k === 'multipv') r.multipv = Number(t[++i]);
    else if (k === 'nodes') r.nodes = Number(t[++i]);
    else if (k === 'nps') r.nps = Number(t[++i]);
    else if (k === 'time') r.time = Number(t[++i]);
    else if (k === 'score') {
      const kind = t[++i], v = t[++i];
      if (kind === 'cp') r.cp = Number(v);
      else if (kind === 'mate') {
        // "mate +" / "mate -" の形（手数不明）もある
        if (v === '+' || v === '-') r.mate = v === '+' ? 999 : -999;
        else r.mate = Number(v);
      }
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') r.bound = t[++i];
    } else if (k === 'pv') { r.pv = t.slice(i + 1); break; }
    else if (k === 'string') { r.string = t.slice(i + 1).join(' '); break; }
  }
  return r;
}

// 手番側から見た評価の大小比較用
function scoreKey(l) {
  if (l.mate != null) return l.mate > 0 ? 1e6 - l.mate : -1e6 - l.mate;
  return l.cp || 0;
}

export class Engine {
  constructor() {
    this.e = null;
    this.state = 'idle'; // idle / searching / stopping
    this.current = null;
    this.pending = null;
    this.listeners = [];
    this.ready = null;
    this.seq = 0;
    this.threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (!self.crossOriginIsolated) throw new Error('crossOriginIsolated');
      await loadScript(SCRIPT);
      this.e = await self.YaneuraOu_K_P();
      this.e.addMessageListener((line) => this._onLine(line));
      await this._wait('usi', 'usiok');
      this._post(`setoption name Threads value ${this.threads}`);
      this._post('setoption name USI_Hash value 64');
      this._post('setoption name PvInterval value 0');
      this._post('setoption name ConsiderationMode value true');
      this._post('setoption name USI_OwnBook value false');
      await this._wait('isready', 'readyok');
    })();
    return this.ready;
  }

  _post(cmd) { this.e.postMessage(cmd); }

  _wait(cmd, resp) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith(resp)) {
          this.listeners = this.listeners.filter((f) => f !== fn);
          resolve(line);
        }
      };
      this.listeners.push(fn);
      this._post(cmd);
    });
  }

  _onLine(line) {
    for (const f of this.listeners.slice()) f(line);
    if (line.startsWith('bestmove')) {
      const cur = this.current;
      this.current = null;
      this.state = 'idle';
      if (cur && cur.onDone && !cur.cancelled) cur.onDone(line.split(/\s+/)[1], cur.lines);
      if (this.pending) this._start();
      return;
    }
    if (line.startsWith('info') && this.state === 'searching' && this.current) {
      const info = parseInfo(line);
      if (!info.pv || info.string) return;
      const cur = this.current;
      // 深さが進んだら、前の深さの結果を控えに回して新しく集め直す
      if (info.multipv === 1 && info.depth !== cur.depth) {
        if (cur.fresh.length) cur.prev = cur.fresh;
        cur.fresh = [];
        cur.depth = info.depth;
      }
      info.seq = ++this.seq;
      cur.fresh[info.multipv - 1] = info;
      // 同じ手は、深いほう・新しいほうの結果だけを残す
      const best = new Map();
      for (const l of [...cur.prev, ...cur.fresh]) {
        if (!l) continue;
        const o = best.get(l.pv[0]);
        if (!o || l.depth > o.depth || (l.depth === o.depth && l.seq > o.seq)) best.set(l.pv[0], l);
      }
      const merged = [...best.values()];
      merged.sort((a, b) => (b.depth - a.depth) || (scoreKey(b) - scoreKey(a)));
      cur.lines = merged.slice(0, cur.multipv || 1);
      if (cur.onUpdate) cur.onUpdate(cur.lines, info);
    }
  }

  // req: { sfen, multipv, go: 'go infinite' など, onUpdate(lines), onDone(bestmove, lines) }
  search(req) {
    req.lines = [];
    req.fresh = [];
    req.prev = [];
    if (this.pending) this.pending.cancelled = true;
    this.pending = req;
    if (this.state === 'searching') {
      this.current.cancelled = true;
      this.state = 'stopping';
      this._post('stop');
    } else if (this.state === 'idle') {
      this._start();
    }
  }

  _start() {
    const r = this.pending;
    this.pending = null;
    if (!r) return;
    this.current = r;
    this.state = 'searching';
    this._post(`setoption name MultiPV value ${r.multipv || 1}`);
    this._post(`position sfen ${r.sfen}`);
    this._post(r.go || 'go infinite');
  }

  stop() {
    if (this.pending) { this.pending.cancelled = true; this.pending = null; }
    if (this.state === 'searching') {
      this.current.cancelled = true;
      this.state = 'stopping';
      this._post('stop');
    }
  }
}
