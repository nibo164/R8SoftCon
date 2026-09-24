// ============================================================
// 下水道インスペクター ドット絵疑似3D版（pixel.html 用）
// Three.js を使わず、Canvas 2D だけで疑似3Dを描画する。
//   - 下水管：低解像度画面の1ピクセルごとに視線と管の交点を計算して
//             ドット絵テクスチャを貼る（トンネル描画）。管は曲がりくねる
//   - 水面　：高さを持った水平な面。増水イベントで水位が上がる
//   - 壁の異常：管の壁面に直接描き込むデカール（遠近が正しくつく）
//   - 障害物：距離に応じて拡大縮小するスプライト（スペースハリアー方式）
//   - ドローン：少し後ろから追いかける視点で画面に表示する
// 動画映えする演出（破片・フラッシュ・ヒットストップ・BGM など）もここで行う。
// ============================================================

// 画面設定（縦180ピクセル固定。横幅はウィンドウの縦横比に合わせる）
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const SCREEN_H = 180;
const FOV = 75; // 縦方向の視野角（元の3D版と同じ）
const BASE_FOCAL = SCREEN_H / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
let focal = BASE_FOCAL; // スピードが上がると小さくして視野を広げる（ワープ感）
let SCREEN_W = 320;
let frameImage = null; // 管を描き込む画像バッファ
let frameBuf32 = null; // 上のバッファを32bit単位で書き込むためのビュー
let idBuf = null; // ピクセルごとに「どのデカール（壁の異常）が映っているか」
let depthBuf = null; // ピクセルごとの奥行き

function setupScreen() {
  SCREEN_W = Math.round(
    SCREEN_H * (window.innerWidth / Math.max(1, window.innerHeight)),
  );
  SCREEN_W = Math.max(200, Math.min(480, SCREEN_W));
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  ctx.imageSmoothingEnabled = false; // ドットをにじませない
  frameImage = ctx.createImageData(SCREEN_W, SCREEN_H);
  frameBuf32 = new Uint32Array(frameImage.data.buffer);
  idBuf = new Int16Array(SCREEN_W * SCREEN_H);
  depthBuf = new Float32Array(SCREEN_W * SCREEN_H);
}
setupScreen();

// ドローンの位置（「まっすぐな管」の座標系。管の曲がりは描画のときだけ加える）
//   x: 右が正 / y: 上が正 / z: 奥へ進むほど負
const cam = { x: 0, y: 0, z: 0 };

// ============================================================
// サウンドシステム（WebAudio APIで効果音を合成・外部ファイル不要）
// ============================================================
const AudioSys = {
  ctx: null,
  master: null,
  droneGain: null,
  muted: false,

  // ユーザー操作（スペースキー）後に初期化する必要がある
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // ドローンのプロペラ音（近い周波数の2つの波でうなりを作る）
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    [64, 66.5].forEach((f) => {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(filter);
      o.start();
    });
    filter.connect(this.droneGain);
    this.droneGain.connect(this.master);
  },

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  // プロペラ音のON/OFF（飛行中のみ鳴らす）
  setDrone(on) {
    if (!this.droneGain) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.cancelScheduledValues(t);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
    this.droneGain.gain.linearRampToValueAtTime(on ? 0.08 : 0, t + 0.3);
  },

  // 単音（周波数スイープ付き）
  tone(f0, f1, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  // ノイズ（衝突・接触音用）
  noise(dur, freq, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  },

  playScan(combo) {
    this.tone(650 + combo * 80, 1500, 0.16, "sine", 0.25);
  },
  // 空振り（何も捉えていない状態でスキャンした）
  playMiss() {
    this.tone(320, 200, 0.08, "square", 0.06);
  },
  playDamage() {
    this.noise(0.3, 500, 0.5);
    this.tone(150, 45, 0.35, "square", 0.3);
  },
  playScrape() {
    this.noise(0.08, 900, 0.12);
  },
  playHeal() {
    this.tone(660, 660, 0.12, "sine", 0.2);
    this.tone(990, 990, 0.25, "sine", 0.2, 0.12);
  },
  playClear() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, f, 0.35, "triangle", 0.25, i * 0.16),
    );
  },
  playGameOver() {
    [330, 262, 196, 131].forEach((f, i) =>
      this.tone(f, f * 0.9, 0.4, "sawtooth", 0.2, i * 0.2),
    );
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  },
};


// 演出用の効果音（AudioSys に追加）
Object.assign(AudioSys, {
  // カウントダウンの「ピッ」（最後の GO は高い音）
  playBeep(high) {
    this.tone(high ? 1320 : 660, high ? 1320 : 660, high ? 0.35 : 0.15, "square", 0.14);
  },
  // 大雨警報のサイレン
  playSiren() {
    this.tone(600, 1100, 0.35, "sawtooth", 0.1);
    this.tone(1100, 600, 0.35, "sawtooth", 0.1, 0.35);
  },
  // 水しぶき
  playSplash() {
    this.noise(0.25, 1400, 0.22);
  },
  // チェックポイント通過
  playCheckpoint() {
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.tone(f, f, 0.12, "triangle", 0.2, i * 0.06),
    );
  },
  // 区間（ゾーン）が変わった
  playZone() {
    [523, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, "square", 0.1, i * 0.09));
  },
  // 障害物を点検して取りのぞいた
  playBreak() {
    this.noise(0.18, 2600, 0.25);
    this.tone(400, 120, 0.15, "square", 0.12);
  },
  // 墜落
  playExplode() {
    this.noise(0.7, 700, 0.6);
    this.tone(140, 30, 0.7, "sawtooth", 0.3);
  },
});

// ============================================================
// BGM（Web Audio でその場で合成するチップチューン。外部ファイル不要）
//   Am - F - C - G / F - G - Em - Am の8小節をくり返す
//   増水中は intense = true でテンポアップ＋音を重ねる
// ============================================================
const Music = {
  gain: null,
  noiseBuf: null,
  timer: null,
  on: false,
  intense: false,
  step: 0,
  nextTime: 0,
  // 各小節の和音（MIDI ノート番号）
  CHORDS: [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
    [53, 57, 60],
    [55, 59, 62],
    [52, 55, 59],
    [57, 60, 64],
  ],
  // メロディのリズム（1 = 鳴らす）と、和音のどの音を鳴らすか（3 = 1オクターブ上の根音）
  RHYTHM: [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1],
  ARP: [0, 1, 2, 1, 2, 3, 2, 1, 0, 2, 1, 3, 2, 1, 0, 2],
  BASS: [0, 0, 12, 0, 0, 12, 7, 12],

  setup() {
    const ctx = AudioSys.ctx;
    if (!ctx || this.gain) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.5;
    this.gain.connect(AudioSys.master);
    // ドラム用のノイズ（毎回作ると重いので1回だけ作る）
    const len = Math.floor(ctx.sampleRate * 0.3);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  start() {
    if (!AudioSys.ctx) return;
    this.setup();
    this.stop();
    this.on = true;
    this.step = 0;
    this.resume();
  },
  stop() {
    this.on = false;
    this.intense = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  resume() {
    if (!this.on || this.timer || !AudioSys.ctx) return;
    this.nextTime = AudioSys.ctx.currentTime + 0.06;
    // 少し先の音まで予約しておく（setInterval のぶれで音がよれないように）
    this.timer = setInterval(() => this.tick(), 25);
  },

  tick() {
    const ctx = AudioSys.ctx;
    const bpm = this.intense ? 172 : 150;
    const d16 = 60 / bpm / 4; // 16分音符の長さ
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, d16);
      this.nextTime += d16;
      this.step++;
    }
  },

  note(midi, t, dur, type, vol) {
    const ctx = AudioSys.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.gain);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  drum(kind, t) {
    const ctx = AudioSys.ctx;
    if (kind === "kick") {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g);
      g.connect(this.gain);
      o.start(t);
      o.stop(t + 0.17);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const snare = kind === "snare";
    f.type = snare ? "bandpass" : "highpass";
    f.frequency.value = snare ? 1800 : 7000;
    const dur = snare ? 0.12 : 0.035;
    g.gain.setValueAtTime(snare ? 0.3 : kind === "hatAccent" ? 0.12 : 0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.gain);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  playStep(step, t, d16) {
    const bar = Math.floor(step / 16) % this.CHORDS.length;
    const s = step % 16;
    const ch = this.CHORDS[bar];

    // ドラム
    if (s === 0 || s === 8 || s === 10) this.drum("kick", t);
    if (s === 4 || s === 12) this.drum("snare", t);
    if (s % 2 === 0 || this.intense) this.drum(s % 4 === 2 ? "hatAccent" : "hat", t);

    // ベース（8分音符でオクターブを行き来する）
    if (s % 2 === 0) {
      this.note(ch[0] - 24 + this.BASS[s / 2], t, d16 * 1.8, "triangle", 0.32);
    }

    // メロディ（和音の音を上下するアルペジオ）
    if (this.RHYTHM[s]) {
      const idx = this.ARP[(s + bar * 3) % 16];
      const m = idx === 3 ? ch[0] + 12 : ch[idx];
      this.note(m + 12, t, d16 * 0.9, "square", 0.1);
    }

    // 増水中：16分音符の速いアルペジオを重ねて緊張感を出す
    if (this.intense) {
      this.note(ch[s % 3] + 24, t, d16 * 0.5, "square", 0.045);
    }
  },
};

// ============================================================
// 異常・障害物の図鑑データ（土木PR: 実際の下水道点検項目に基づく）
// ============================================================
const ANOMALY_INFO = {
  corrosion: {
    name: "腐食（ふしょく）",
    short: "腐食",
    icon: "◍",
    desc: "下水から発生する硫化水素がコンクリートを溶かしてボロボロに！下水道管の一番の大敵なんだ。",
  },
  crack: {
    name: "ひび割れ（クラック）",
    short: "ひび割れ",
    icon: "⚡",
    desc: "ひびを放っておくと管がこわれて、道路が陥没する原因に！小さいうちに見つけるのが大切。",
  },
  rebar: {
    name: "鉄筋露出（てっきんろしゅつ）",
    short: "鉄筋露出",
    icon: "≡",
    desc: "コンクリートの中の鉄筋がむき出しに！管の強度がグッと落ちてしまう危険なサインだよ。",
  },
  leak: {
    name: "浸入水（しんにゅうすい）",
    short: "浸入水",
    icon: "◆",
    desc: "すき間から地下水が入りこむと、下水処理場の負担が増えてしまう。流れを直さないと！",
  },
  sediment: {
    name: "堆積物（たいせきぶつ）",
    short: "堆積物",
    icon: "▲",
    desc: "土砂がたまると水があふれる原因に。しゅんせつ（そうじ）して流れを守ろう！",
  },
  roots: {
    name: "木の根の侵入",
    short: "木の根",
    icon: "⚘",
    desc: "木の根は管の継ぎ目のすき間から入りこんで水の流れをふさぐ。実はよくあるトラブル！",
  },
};

// 図鑑のグリッド表示順
const CODEX_ORDER = [
  "corrosion",
  "crack",
  "rebar",
  "leak",
  "sediment",
  "roots",
];

// 図鑑の発見記録
//   codexSession: ページを開いてからの累計（連続プレイでコンプリートを狙わせる）
//   codexRun:     今回のプレイでの発見数
const codexSession = {};
const codexRun = {};
CODEX_ORDER.forEach((k) => {
  codexSession[k] = 0;
  codexRun[k] = 0;
});

function recordCodex(type) {
  if (!(type in codexSession)) return;
  codexSession[type]++;
  codexRun[type]++;
}

// マンホール通過時に表示する土木豆知識
const TRIVIA = [
  "日本の下水道管は全部つなぐと約49万km！地球を12周できる長さなんだ。",
  "古くなった下水道管がどんどん増えていて、点検できる人やロボットが大活躍中！",
  "本物の下水道点検でも、ドローンやカメラロボットが実際に使われているよ。",
  "マンホールのふたが丸いのは、どの向きでも穴に落ちないようにするためなんだ。",
  "下水道のおかげで、まちが清潔に保たれて川や海もきれいになっているよ。",
  "下水道管の点検は、道路陥没などの事故を防ぐとても大事な仕事なんだ。",
];
let triviaIdx = 0;

// ============================================================
// ドット絵生成の共通道具
// ============================================================
const pipeRadius = 10;
const pipeLength = 3000;
const TAU = Math.PI * 2;

// 明るさの段階数（段階ごとにくっきり色が変わるのがドット絵らしさ）
const LIGHT_LEVELS = 6;
// 4x4 のディザ（網点）パターン。段階の境目をザラッとした網目にする
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 小さなキャンバスを作る
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// ドット描画用の画素配列（RGBA）を持つ小さな画像
function makePixels(w, h) {
  return { w: w, h: h, data: new Uint8ClampedArray(w * h * 4) };
}
function setPx(img, x, y, hex, alpha = 255) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const [r, g, b] = hexToRgb(hex);
  const p = (y * img.w + x) * 4;
  img.data[p] = r;
  img.data[p + 1] = g;
  img.data[p + 2] = b;
  img.data[p + 3] = alpha;
}
function getA(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return 0;
  return img.data[(y * img.w + x) * 4 + 3];
}

// ドット絵のふちに1ピクセルの輪郭線をつける
function addOutline(img, hex) {
  const edge = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (getA(img, x, y)) continue;
      if (
        getA(img, x - 1, y) ||
        getA(img, x + 1, y) ||
        getA(img, x, y - 1) ||
        getA(img, x, y + 1)
      ) {
        edge.push([x, y]);
      }
    }
  }
  edge.forEach(([x, y]) => setPx(img, x, y, hex));
}

// 画素配列をキャンバスに変換する
function pixelsToCanvas(img) {
  const c = makeCanvas(img.w, img.h);
  const cctx = c.getContext("2d");
  const id = cctx.createImageData(img.w, img.h);
  id.data.set(img.data);
  cctx.putImageData(id, 0, 0);
  return c;
}

// 明るさの段階ごとに暗くしたスプライトを用意しておく（描画時に選ぶだけで済む）
function makeShadedVariants(img) {
  const variants = [];
  for (let lv = 0; lv <= LIGHT_LEVELS; lv++) {
    const k = lv / LIGHT_LEVELS;
    const copy = makePixels(img.w, img.h);
    for (let i = 0; i < img.data.length; i += 4) {
      copy.data[i] = img.data[i] * k;
      copy.data[i + 1] = img.data[i + 1] * k;
      copy.data[i + 2] = img.data[i + 2] * k;
      copy.data[i + 3] = img.data[i + 3];
    }
    variants.push(pixelsToCanvas(copy));
  }
  return variants;
}

function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// 下水管のドット絵テクスチャ（32x32。管1周に6枚、奥行き10ごとに1枚）
//   区間（ゾーン）ごとに別のテクスチャを使う
// ============================================================
const TEX = 32;
const TEX_U_SCALE = (6 * TEX) / TAU; // 角度 → テクスチャの横位置
const TEX_V_SCALE = TEX / 10; // 奥行き → テクスチャの縦位置

// ZONE 1：汚れたコンクリート管
function createPipeTexture() {
  const img = makePixels(TEX, TEX);
  const base = ["#3f3226", "#4e3f30", "#4e3f30", "#57473a", "#4a3b2d"];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) setPx(img, x, y, pick(base));
  }
  // 汚れ・染み（暗い斑点のかたまり）
  for (let i = 0; i < 5; i++) {
    const cx = randInt(3, TEX - 4);
    const cy = randInt(3, TEX - 4);
    const r = randInt(2, 4);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r && Math.random() < 0.8) {
          setPx(img, cx + x, cy + y, Math.random() < 0.5 ? "#33281e" : "#2b2119");
        }
      }
    }
  }
  // 明るい粒（骨材のつぶつぶ）
  for (let i = 0; i < 18; i++) setPx(img, randInt(0, TEX - 1), randInt(0, TEX - 1), "#6b5843");
  // 目地（継ぎ目）：暗い溝＋片側に明るいふち（ドット絵の立体表現）
  for (let i = 0; i < TEX; i++) {
    setPx(img, i, 0, "#1c140c");
    setPx(img, i, 1, "#6b5843");
    setPx(img, 0, i, "#1c140c");
    setPx(img, 1, i, "#5e4c3a");
  }
  return img.data;
}

// ZONE 2：レンガ積みの下水道（互い違いに積んだレンガ＋目地）
function createBrickTexture() {
  const img = makePixels(TEX, TEX);
  const bricks = ["#7a3b24", "#8a4429", "#6e3420", "#914d2e", "#7f3f26"];
  const BW = 16; // レンガ1個の幅
  const BH = 8; // レンガ1個の高さ
  for (let row = 0; row < TEX / BH; row++) {
    const shift = row % 2 === 0 ? 0 : BW / 2;
    for (let col = -1; col < TEX / BW + 1; col++) {
      const base = pick(bricks);
      const x0 = col * BW + shift;
      for (let y = 0; y < BH; y++) {
        for (let x = 0; x < BW; x++) {
          const px = (((x0 + x) % TEX) + TEX) % TEX;
          const py = row * BH + y;
          let c = base;
          if (y === 0 || x === 0) c = "#2a1a12"; // 目地
          else if (y === 1) c = "#a8603a"; // 上のふちの明るい線
          else if (y === BH - 1) c = "#4e2415"; // 下のふちの影
          else if (Math.random() < 0.12) c = "#5a2a18"; // ざらつき
          setPx(img, px, py, c);
        }
      }
    }
  }
  // 苔（こけ）のしみ
  for (let i = 0; i < 12; i++) {
    setPx(img, randInt(0, TEX - 1), randInt(0, TEX - 1), "#3d4a22");
  }
  return img.data;
}

// ZONE 3：太い幹線下水道（青みがかった新しいコンクリートのパネル）
function createTrunkTexture() {
  const img = makePixels(TEX, TEX);
  const base = ["#4a5561", "#525e6b", "#4e5966", "#56626f"];
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) setPx(img, x, y, pick(base));
  }
  // パネルの継ぎ目とボルト
  for (let i = 0; i < TEX; i++) {
    setPx(img, i, 0, "#1e252c");
    setPx(img, i, 1, "#6f7d8b");
    setPx(img, 0, i, "#1e252c");
    setPx(img, 1, i, "#6f7d8b");
  }
  [
    [5, 5],
    [26, 5],
    [5, 26],
    [26, 26],
  ].forEach(([x, y]) => {
    setPx(img, x, y, "#8d9baa");
    setPx(img, x + 1, y + 1, "#2a323a");
  });
  return img.data;
}

const zoneTextures = [createPipeTexture(), createBrickTexture(), createTrunkTexture()];

// 流れる下水（16x16。時間とともに流れる）
const WATER_TEX = 16;
function createWaterTexture() {
  const img = makePixels(WATER_TEX, WATER_TEX);
  for (let y = 0; y < WATER_TEX; y++) {
    for (let x = 0; x < WATER_TEX; x++) {
      setPx(img, x, y, Math.random() < 0.7 ? "#23312a" : "#1b2721");
    }
  }
  // 波の光（短い横線）
  for (let i = 0; i < 6; i++) {
    const x = randInt(0, WATER_TEX - 1);
    const y = randInt(0, WATER_TEX - 1);
    const len = randInt(2, 4);
    for (let k = 0; k < len; k++) setPx(img, (x + k) % WATER_TEX, y, "#4f6a55");
    setPx(img, (x + 1) % WATER_TEX, y, "#7fa088");
  }
  return img.data;
}
const waterTex = createWaterTexture();

// ============================================================
// オブジェクト管理
// ============================================================
const hazards = []; // 衝突ダメージのある障害物（漏水・堆積物・木の根）
const anomalies = []; // スキャンでスコアになる異常（腐食・ひび割れ・鉄筋露出）

// オブジェクトを登録する
function registerObject(list, obj, type) {
  obj.type = type;
  obj.active = true;
  obj.counted = false;
  obj.visible = true;
  obj.helper = false; // スキャン済みの水色の枠を出すか
  list.push(obj);
}

// ------------------------------------------------------------
// 障害物：漏水（天井から底まで流れる水柱）… 4コマのアニメーション
// ------------------------------------------------------------
const LEAK_W = 12;
const LEAK_H = 40;
function createLeakFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const img = makePixels(LEAK_W, LEAK_H);
    for (let y = 0; y < LEAK_H; y++) {
      // 上が細く下が太い水柱
      const hw = 1.5 + (y / (LEAK_H - 1)) * 4.5;
      const left = Math.round(LEAK_W / 2 - hw);
      const right = Math.round(LEAK_W / 2 + hw) - 1;
      for (let x = left; x <= right; x++) {
        let col = "#2f93e0";
        const band = (y - f * 3 + (x - left) * 7 + 40) % 9;
        if (band < 2) col = "#8fd8ff";
        if (x === left || x === right) col = "#1a5f9e";
        setPx(img, x, y, col);
      }
    }
    // 底の水しぶき
    for (let i = 0; i < 6; i++) {
      setPx(img, randInt(0, LEAK_W - 1), randInt(LEAK_H - 5, LEAK_H - 1), "#e0f6ff");
    }
    frames.push(makeShadedVariants(img));
  }
  return frames;
}
const leakFrames = createLeakFrames();

function createLeak(z) {
  const x = (Math.random() * 2 - 1) * (pipeRadius - 3);
  const height = Math.sqrt(pipeRadius * pipeRadius - x * x) * 2;
  return {
    kind: "sprite",
    x: x,
    y: 0,
    z: z,
    w: 4, // 横幅（ワールド単位）
    h: height,
    box: { x0: x - 2, x1: x + 2, y0: -height / 2, y1: height / 2, z0: z - 2, z1: z + 2 },
  };
}

// ------------------------------------------------------------
// 障害物：堆積物（床の茶色い土砂山）
// ------------------------------------------------------------
function createSedimentSprite() {
  const w = 32;
  const h = 12;
  const img = makePixels(w, h);
  const cols = ["#5c4033", "#5c4033", "#4a3328", "#735238"];
  for (let x = 0; x < w; x++) {
    const t = (x + 0.5 - w / 2) / (w / 2);
    const top = Math.round(h - h * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let y = top; y < h; y++) {
      setPx(img, x, y, y === top ? "#8a6a4a" : pick(cols));
    }
  }
  // 小石
  for (let i = 0; i < 8; i++) {
    const x = randInt(4, w - 5);
    const y = randInt(6, h - 1);
    if (getA(img, x, y)) setPx(img, x, y, "#8a7a6a");
  }
  addOutline(img, "#1e140c");
  return makeShadedVariants(img);
}

function createSediment(z) {
  const hVal = Math.random() * 6 + 2; // 2〜8のランダム（元の3D版と同じ）
  return {
    kind: "sprite",
    x: 0,
    y: -pipeRadius + hVal / 2,
    z: z,
    w: 14,
    h: hVal,
    sprite: createSedimentSprite(),
    // 元の3D版と同じ当たり判定（楕円体を包む箱）
    box: {
      x0: -7,
      x1: 7,
      y0: -pipeRadius - hVal,
      y1: -pipeRadius + hVal,
      z0: z - 4,
      z1: z + 4,
    },
  };
}

// ------------------------------------------------------------
// 障害物：木の根の侵入（継ぎ目から垂れ下がる根の束）
// ------------------------------------------------------------
function createRootsSprite() {
  const w = 20;
  const h = 24;
  const img = makePixels(w, h);
  const n = randInt(5, 7);
  for (let i = 0; i < n; i++) {
    let x = w / 2 + randInt(-3, 3);
    const len = randInt(12, h - 2);
    for (let y = 1; y < len; y++) {
      if (y % 3 === 0) x += randInt(-1, 1);
      const thick = y < len * 0.45;
      setPx(img, x, y, y > len - 3 ? "#a07a50" : "#6b4423");
      if (thick) setPx(img, x + 1, y, "#8a5a30");
    }
  }
  // 根元（管の継ぎ目のすき間）
  for (let x = 5; x < w - 5; x++) {
    setPx(img, x, 0, "#4a2e17");
    setPx(img, x, 1, "#4a2e17");
  }
  addOutline(img, "#1e120a");
  return makeShadedVariants(img);
}

function createRoots(z) {
  const angle = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7; // 上側の壁面
  const r = pipeRadius - 0.2;
  const bx = Math.cos(angle) * r;
  const by = Math.sin(angle) * r;
  // 管の中心へ向かう方向
  const nx = -Math.cos(angle);
  const ny = -Math.sin(angle);
  const len = 5.5; // 根の長さの最大値
  // 根元から先端までを包む箱（横方向に1.5の広がり）
  const px = [bx - nx * 0.5, bx + nx * (len - 0.5)];
  const py = [by - ny * 0.5, by + ny * (len - 0.5)];
  return {
    kind: "sprite",
    x: bx + nx * 2.8,
    y: by + ny * 2.8,
    z: z,
    w: 6,
    h: 6,
    // 画面上で根元が壁側、先端が中心側になるよう回転させる
    rot: Math.PI / 2 - angle,
    sprite: createRootsSprite(),
    box: {
      x0: Math.min(px[0], px[1]) - 1.5,
      x1: Math.max(px[0], px[1]) + 1.5,
      y0: Math.min(py[0], py[1]) - 1.5,
      y1: Math.max(py[0], py[1]) + 1.5,
      z0: z - 2,
      z1: z + 2,
    },
  };
}

// ------------------------------------------------------------
// 壁の異常（デカール）：管の壁面に直接描き込む
//   ang: 管の断面上の角度 / size: 一辺の長さ（ワールド単位）
// ------------------------------------------------------------
function makeDecal(z, size, img) {
  return {
    kind: "decal",
    ang: Math.random() * TAU - Math.PI,
    z: z,
    size: size,
    half: size / 2,
    img: img,
    texel: img.w / size, // ワールド単位 → 画素
  };
}

// スコアアノマリー：壁面の腐食・苔
function createCorrosion(z) {
  const n = 16;
  const img = makePixels(n, n);
  const isRust = Math.random() > 0.5;
  const cols = isRust
    ? ["#8b4513", "#a0522d", "#6b3410", "#c46a2a"]
    : ["#4d5d2f", "#5f7236", "#3a4722", "#7a8c45"];
  const r0 = 6.5;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      // ふちをギザギザにする
      if (d < r0 - 1.5 || (d < r0 + 0.5 && Math.random() < 0.55)) {
        setPx(img, x, y, d > r0 - 2 ? cols[2] : pick(cols));
      }
    }
  }
  return makeDecal(z, 3.8, img);
}

// スコアアノマリー：ひび割れ（ジグザグの亀裂）
function createCrack(z) {
  const n = 24;
  const img = makePixels(n, n);
  const line = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      setPx(img, x + 2, y, "#2a2018"); // 亀裂の影
      setPx(img, x, y, "#0a0806");
      setPx(img, x + 1, y, "#0a0806");
    }
  };
  let x = randInt(7, 16);
  let y = 1;
  while (y < n - 2) {
    const nx = Math.max(1, Math.min(n - 2, x + randInt(-4, 4)));
    const ny = Math.min(n - 1, y + randInt(2, 4));
    line(x, y, nx, ny);
    // 枝分かれ
    if (Math.random() < 0.45) {
      line(nx, ny, nx + randInt(-6, 6), ny + randInt(1, 5));
    }
    x = nx;
    y = ny;
  }
  return makeDecal(z, 5, img);
}

// スコアアノマリー：鉄筋露出（欠けたコンクリートから錆びた鉄筋が見える）
function createRebar(z) {
  const n = 20;
  const img = makePixels(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 7.5) setPx(img, x, y, Math.random() < 0.8 ? "#2a2a2a" : "#333030");
      else if (d < 9.5 && Math.random() < 0.6) setPx(img, x, y, "#3a3530");
    }
  }
  // 錆びた鉄筋3本（管の円周方向）
  [5, 10, 15].forEach((row) => {
    const tilt = Math.random() - 0.5;
    for (let x = 2; x < n - 2; x++) {
      const y = row + Math.round(((x - n / 2) * tilt) / 4);
      setPx(img, x, y - 1, "#b0552a");
      setPx(img, x, y, "#8b3a1a");
      setPx(img, x, y + 1, "#4a1a0a");
    }
  });
  return makeDecal(z, 3.6, img);
}

// ランダム配置（奥へ進むほど密度が上がる難易度カーブ付き）
const objectCount = 80;
for (let i = 0; i < objectCount; i++) {
  // pow(rand, 0.75) で奥側（大きいz）に偏らせて配置
  const z = -(50 + Math.pow(Math.random(), 0.75) * (pipeLength - 150));
  const rand = Math.random();

  if (rand < 0.17) {
    registerObject(hazards, createLeak(z), "leak");
  } else if (rand < 0.34) {
    registerObject(hazards, createSediment(z), "sediment");
  } else if (rand < 0.46) {
    registerObject(hazards, createRoots(z), "roots");
  } else if (rand < 0.65) {
    registerObject(anomalies, createCorrosion(z), "corrosion");
  } else if (rand < 0.84) {
    registerObject(anomalies, createCrack(z), "crack");
  } else {
    registerObject(anomalies, createRebar(z), "rebar");
  }
}
const totalInspectable = hazards.length + anomalies.length;

// ============================================================
// マンホール整備ポイント（実際の下水道と同様に一定間隔で設置）
// 通過するとドローンが回復し、土木豆知識が表示される
//   天井の穴は管の描画で、差し込む光の柱はスプライトで描く
// ============================================================
const manholes = [];
const MANHOLE_HOLE_R = 2.2;
const MANHOLE_LIGHT_RANGE = 60;

function createBeamSprite() {
  const w = 12;
  const h = 48;
  const img = makePixels(w, h);
  for (let y = 0; y < h; y++) {
    const hw = 3.9 + (y / (h - 1)) * 2.1; // 上が細く下が太い
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x + 0.5 - w / 2) / hw;
      if (d >= 1) continue;
      // 中心ほど明るく、網目状に間引いて半透明っぽく見せる
      const a = (1 - d) * (1 - (y / h) * 0.5);
      if (a > BAYER4[(y & 3) * 4 + (x & 3)] * 0.9) setPx(img, x, y, "#fff3c0", 255);
    }
  }
  return pixelsToCanvas(img);
}
const beamSprite = createBeamSprite();

function createManhole(z) {
  manholes.push({ z: z, passed: false });
}
[-750, -1500, -2250].forEach(createManhole);

// ============================================================
// コース：曲がりくねる管・区間（ゾーン）・増水イベント
// ============================================================
const ZONE_LEN = 1000; // 100m（ワールド単位で1000）ごとに区間が変わる
const ZONES = [
  {
    name: "ZONE 1",
    sub: "CONCRETE PIPE",
    jp: "ZONE 1：コンクリートの下水道管",
    lamp: null,
  },
  {
    name: "ZONE 2",
    sub: "BRICK SEWER",
    jp: "ZONE 2：レンガの下水道",
    desc: "明治時代にレンガでつくられた下水道には、今も使われているものがあるよ。",
    // 壁のランプ（間隔・色・取りつけ角度）
    lamp: { every: 40, color: [255, 180, 80], angs: [0.85, Math.PI - 0.85] },
  },
  {
    name: "ZONE 3",
    sub: "TRUNK SEWER",
    jp: "ZONE 3：太い幹線（かんせん）下水道",
    desc: "まちじゅうの下水が集まる、太くて大事なトンネルだよ。",
    lamp: { every: 20, color: [110, 225, 255], angs: [0.7, Math.PI - 0.7] },
  },
];
function zoneIndexAt(wz) {
  return wz > -ZONE_LEN ? 0 : wz > -2 * ZONE_LEN ? 1 : 2;
}

// 管の中心線のずれ（まっすぐな管の z → 実際の管の横・縦のずれ）
// 最初の25mはまっすぐで、そこから少しずつカーブが強くなる
function courseCenter(z, out) {
  const d = -z;
  const env = Math.min(1, Math.max(0, (d - 250) / 400));
  out.x = env * (14 * Math.sin(d * 0.0105) + 6 * Math.sin(d * 0.0231 + 1.3));
  out.y = env * (4 * Math.sin(d * 0.0083 + 0.7));
  return out;
}
// カーブのきつさ（中心線の2階微分）。遠心力の計算に使う
const _cc = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
function courseCurvature(z) {
  courseCenter(z - 2, _cc[0]);
  courseCenter(z, _cc[1]);
  courseCenter(z + 2, _cc[2]);
  return {
    x: (_cc[0].x - 2 * _cc[1].x + _cc[2].x) / 4,
    y: (_cc[0].y - 2 * _cc[1].y + _cc[2].y) / 4,
  };
}

// 増水イベント（距離[m]で決まる）：160mで警報 → 170〜182mで水位上昇
// → 222mまで満水 → 236mまでに引いていく
const FLOOD_WARN_AT = 160;
const WATER_BASE = -pipeRadius + 0.55; // ふだんの水位（管の中心からの高さ）
const FLOOD_RISE = 4.2; // 増水で上がる高さ
function floodAmountAt(dist) {
  let k = 0;
  if (dist < 170) k = 0;
  else if (dist < 182) k = (dist - 170) / 12;
  else if (dist < 222) k = 1;
  else if (dist < 236) k = 1 - (dist - 222) / 14;
  return k * k * (3 - 2 * k);
}
let floodK = 0; // 0〜1：いまの増水の度合い
let waterLevel = WATER_BASE;

// ------------------------------------------------------------
// 管の曲がりの前計算
//   カメラから奥行き t の位置で、管の中心がどれだけずれて見えるか（bendX/Y）。
//   カメラは管の進行方向を向くので、1次の傾きぶんは差し引く。
// ------------------------------------------------------------
const BEND_MAX = 420;
const bendX = new Float32Array(BEND_MAX + 2);
const bendY = new Float32Array(BEND_MAX + 2);
let courseCurving = false;
let BX = 0; // bendAt の結果：中心のずれ
let BY = 0;
let BDX = 0; // bendAt の結果：奥行き1あたりのずれの変化
let BDY = 0;
const _b0 = { x: 0, y: 0 };
const _b1 = { x: 0, y: 0 };
const _b2 = { x: 0, y: 0 };

function updateBend(cz) {
  courseCenter(cz, _b0);
  courseCenter(cz - 1, _b1);
  courseCenter(cz + 1, _b2);
  const sx = (_b1.x - _b2.x) / 2;
  const sy = (_b1.y - _b2.y) / 2;
  let maxAbs = 0;
  for (let t = 0; t <= BEND_MAX + 1; t++) {
    courseCenter(cz - t, _b1);
    bendX[t] = _b1.x - _b0.x - sx * t;
    bendY[t] = _b1.y - _b0.y - sy * t;
    maxAbs = Math.max(maxAbs, Math.abs(bendX[t]), Math.abs(bendY[t]));
  }
  courseCurving = maxAbs > 0.05;
}

function bendAt(t) {
  if (!courseCurving) {
    BX = BY = BDX = BDY = 0;
    return;
  }
  if (t < 0) t = 0;
  if (t >= BEND_MAX) {
    BX = bendX[BEND_MAX];
    BY = bendY[BEND_MAX];
    BDX = BDY = 0;
    return;
  }
  const ti = t | 0;
  const f = t - ti;
  BDX = bendX[ti + 1] - bendX[ti];
  BDY = bendY[ti + 1] - bendY[ti];
  BX = bendX[ti] + BDX * f;
  BY = bendY[ti] + BDY * f;
}

// ============================================================
// ドット文字（5x7 のビットマップフォント）
// ============================================================
const FONT_ROWS = {
  0: "01110,10001,10011,10101,11001,10001,01110",
  1: "00100,01100,00100,00100,00100,00100,01110",
  2: "01110,10001,00001,00010,00100,01000,11111",
  3: "11111,00010,00100,00010,00001,10001,01110",
  4: "00010,00110,01010,10010,11111,00010,00010",
  5: "11111,10000,11110,00001,00001,10001,01110",
  6: "00110,01000,10000,11110,10001,10001,01110",
  7: "11111,00001,00010,00100,01000,01000,01000",
  8: "01110,10001,10001,01110,10001,10001,01110",
  9: "01110,10001,10001,01111,00001,00010,01100",
  A: "01110,10001,10001,11111,10001,10001,10001",
  B: "11110,10001,10001,11110,10001,10001,11110",
  C: "01110,10001,10000,10000,10000,10001,01110",
  D: "11100,10010,10001,10001,10001,10010,11100",
  E: "11111,10000,10000,11110,10000,10000,11111",
  F: "11111,10000,10000,11110,10000,10000,10000",
  G: "01110,10001,10000,10111,10001,10001,01111",
  H: "10001,10001,10001,11111,10001,10001,10001",
  I: "01110,00100,00100,00100,00100,00100,01110",
  J: "00111,00010,00010,00010,00010,10010,01100",
  K: "10001,10010,10100,11000,10100,10010,10001",
  L: "10000,10000,10000,10000,10000,10000,11111",
  M: "10001,11011,10101,10101,10001,10001,10001",
  N: "10001,10001,11001,10101,10011,10001,10001",
  O: "01110,10001,10001,10001,10001,10001,01110",
  P: "11110,10001,10001,11110,10000,10000,10000",
  Q: "01110,10001,10001,10001,10101,10010,01101",
  R: "11110,10001,10001,11110,10100,10010,10001",
  S: "01111,10000,10000,01110,00001,00001,11110",
  T: "11111,00100,00100,00100,00100,00100,00100",
  U: "10001,10001,10001,10001,10001,10001,01110",
  V: "10001,10001,10001,10001,10001,01010,00100",
  W: "10001,10001,10001,10101,10101,10101,01010",
  X: "10001,10001,01010,00100,01010,10001,10001",
  Y: "10001,10001,10001,01010,00100,00100,00100",
  Z: "11111,00001,00010,00100,01000,10000,11111",
  "+": "00000,00100,00100,11111,00100,00100,00000",
  "-": "00000,00000,00000,11111,00000,00000,00000",
  "!": "00100,00100,00100,00100,00100,00000,00100",
  x: "00000,00000,10001,01010,00100,01010,10001", // かけ算の ×
  ".": "00000,00000,00000,00000,00000,01100,01100",
  "%": "11000,11001,00010,00100,01000,10011,00011",
  " ": "00000,00000,00000,00000,00000,00000,00000",
};
const FONT = {};
Object.keys(FONT_ROWS).forEach((ch) => {
  FONT[ch] = FONT_ROWS[ch].split(",").map((r) => parseInt(r, 2));
});

function textWidth(str, scale) {
  return str.length * 6 * scale - scale;
}
function drawTextRaw(str, x0, y0, scale, color) {
  for (let i = 0; i < str.length; i++) {
    const g = FONT[str[i]];
    if (!g) continue;
    // color に配列を渡すと1文字ずつ色を変えられる（虹色の文字など）
    ctx.fillStyle = Array.isArray(color) ? color[i % color.length] : color;
    for (let r = 0; r < 7; r++) {
      const bits = g[r];
      if (!bits) continue;
      for (let c = 0; c < 5; c++) {
        if (bits & (16 >> c)) {
          ctx.fillRect(x0 + (i * 6 + c) * scale, y0 + r * scale, scale, scale);
        }
      }
    }
  }
}
// 縁取りつきのドット文字を描く
function drawText(str, x, y, scale, color, align = "center") {
  const w = textWidth(str, scale);
  const x0 = Math.round(align === "center" ? x - w / 2 : align === "right" ? x - w : x);
  const y0 = Math.round(y);
  const o = Math.max(1, Math.floor(scale / 2));
  drawTextRaw(str, x0 - o, y0, scale, "#000");
  drawTextRaw(str, x0 + o, y0, scale, "#000");
  drawTextRaw(str, x0, y0 - o, scale, "#000");
  drawTextRaw(str, x0, y0 + o + scale, scale, "#000");
  drawTextRaw(str, x0, y0, scale, color);
}
const RAINBOW = ["#ff4d6d", "#ffa94d", "#ffe14d", "#6dff7a", "#4dd8ff", "#b77dff"];
function rainbowShift(k) {
  const n = RAINBOW.length;
  return RAINBOW.map((_, i) => RAINBOW[(i + k) % n]);
}

// ============================================================
// ドローンのドット絵（ローターの回転を2コマで表現）
// ============================================================
function createDroneFrames() {
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const img = makePixels(26, 13);
    [5, 20].forEach((cx) => {
      const half = f === 0 ? 4 : 2;
      for (let x = cx - half; x <= cx + half; x++) setPx(img, x, 1, "#dfe7ea");
      if (f === 1) {
        setPx(img, cx - 1, 0, "#9aa6ab");
        setPx(img, cx + 1, 2, "#9aa6ab");
      }
      setPx(img, cx, 2, "#555a60");
    });
    for (let x = 5; x <= 20; x++) setPx(img, x, 3, "#6b7178");
    for (let x = 9; x <= 16; x++) setPx(img, x, 4, "#ffd84a");
    for (let y = 5; y <= 8; y++) {
      for (let x = 8; x <= 17; x++) setPx(img, x, y, y === 6 ? "#c98f00" : "#f0b400");
    }
    for (let x = 9; x <= 16; x++) setPx(img, x, 9, "#8a6300");
    setPx(img, 12, 7, "#00e5ff");
    setPx(img, 13, 7, "#00e5ff");
    setPx(img, 12, 8, "#0088aa");
    setPx(img, 13, 8, "#0088aa");
    setPx(img, 8, 5, "#ff3344"); // 左の航行灯（赤）
    setPx(img, 17, 5, "#33ff66"); // 右の航行灯（緑）
    [9, 10, 15, 16].forEach((x) => setPx(img, x, 10, "#555a60"));
    [8, 9, 10, 11, 14, 15, 16, 17].forEach((x) => setPx(img, x, 11, "#555a60"));
    addOutline(img, "#101418");
    frames.push(pixelsToCanvas(img));
  }
  return frames;
}
const droneFrames = createDroneFrames();
const DRONE_W = 2.2; // 画面に描くドローンの大きさ（ワールド単位）
const DRONE_H = 1.1;
const CAM_UP = 1.6; // カメラはドローンの少し上・後ろから追いかける
const CAM_BACK = 6;
let droneBank = 0; // ドローン機体の傾き（カメラより大きく傾けて動きを見せる）
let hurtBlink = 0; // ぶつかったあと機体を点滅させる残り時間
let droneVisible = true; // 墜落したら false

// ============================================================
// 演出（パーティクル・フラッシュ・文字・スピード線など）
// ============================================================
const FX = {
  parts: [], // 破片・しぶき（ワールド座標）
  rings: [], // 点検したときの広がる輪（画面座標）
  pops: [], // 「+300」などの飛び出す数字（画面座標）
  cracks: [], // 衝突で画面に入るヒビ
  lines: [], // スピード線
  flashA: 0,
  flashRGB: "255,255,255",
  banner: null, // 画面中央の大きな文字
  comboPop: 0, // コンボが増えた瞬間に文字を大きくする残り時間

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.pops.length = 0;
    this.cracks.length = 0;
    this.flashA = 0;
    this.banner = null;
    this.comboPop = 0;
  },

  // 破片を飛び散らせる
  burst(x, y, z, colors, n, spd, life = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const e = Math.random() * 2 - 1;
      const v = spd * (0.4 + Math.random() * 0.8);
      const r = Math.sqrt(1 - e * e);
      this.parts.push({
        x: x,
        y: y,
        z: z,
        vx: Math.cos(a) * r * v,
        vy: e * v + spd * 0.3,
        vz: Math.sin(a) * r * v,
        life: life * (0.6 + Math.random() * 0.6),
        color: pick(colors),
        size: 0.12 + Math.random() * 0.18,
        grav: 14,
      });
    }
  },
  // 重力なしでその場に漂う粒（ドローンの噴射など）
  mote(x, y, z, vx, vy, vz, color, life, size) {
    this.parts.push({ x, y, z, vx, vy, vz, life, color, size, grav: 0 });
  },
  ring(sx, sy, color) {
    this.rings.push({ x: sx, y: sy, age: 0, color: color });
  },
  pop(sx, sy, text, color) {
    this.pops.push({ x: sx, y: sy, age: 0, text: text, color: color });
  },
  flash(rgb, a) {
    this.flashRGB = rgb;
    this.flashA = Math.max(this.flashA, a);
  },
  showBanner(text, sub, color, dur = 1.6, scale = 4) {
    this.banner = { text, sub, color, dur, scale, age: 0 };
  },
  // 画面の端から内側へ走るヒビ
  crack() {
    const W = SCREEN_W;
    const H = SCREEN_H;
    const side = randInt(0, 3);
    let x = side === 0 ? 0 : side === 1 ? W - 1 : randInt(0, W - 1);
    let y = side === 2 ? 0 : side === 3 ? H - 1 : randInt(0, H - 1);
    const pts = [[x, y]];
    let ang = Math.atan2(H / 2 - y, W / 2 - x);
    for (let i = 0; i < 7; i++) {
      ang += (Math.random() - 0.5) * 0.9;
      x += Math.cos(ang) * randInt(6, 14);
      y += Math.sin(ang) * randInt(6, 14);
      pts.push([x, y]);
    }
    this.cracks.push({ pts: pts, age: 0 });
  },

  update(dt, speedFactor) {
    // 破片
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    this.rings = this.rings.filter((r) => (r.age += dt) < 0.4);
    this.pops = this.pops.filter((p) => (p.age += dt) < 0.9);
    this.cracks = this.cracks.filter((c) => (c.age += dt) < 1.4);
    this.flashA = Math.max(0, this.flashA - dt * 3.5);
    this.comboPop = Math.max(0, this.comboPop - dt);
    if (this.banner && (this.banner.age += dt) > this.banner.dur) this.banner = null;

    // スピード線：速いほど本数を増やし、速く流す
    const want = Math.round(speedFactor * 26);
    while (this.lines.length < want) {
      this.lines.push({ ang: Math.random() * TAU, r: 30 + Math.random() * 120, len: 6 + Math.random() * 14 });
    }
    if (this.lines.length > want) this.lines.length = want;
    const maxR = Math.hypot(SCREEN_W, SCREEN_H) / 2;
    this.lines.forEach((l) => {
      l.r += dt * (160 + 320 * speedFactor) * (l.r / 80);
      if (l.r > maxR) {
        l.ang = Math.random() * TAU;
        l.r = 45 + Math.random() * 30;
      }
    });
  },
};

// ============================================================
// 描画：投影
//   スプライトは傾き（ロール）なしで計算し、最後にキャンバスを回転させて描く。
//   管のピクセルは逆回転して求める。
// ============================================================
let camRoll = 0;
let camPitch = 0;
let renderCam = { x: 0, y: 0, z: 0 }; // 画面ブレ込みの描画用カメラ位置
let frameSprites = []; // 直前のフレームで描いたスプライト（点検判定に使う）
let frameDecals = []; // 直前のフレームで見えていたデカール

// ワールド座標 → 画面座標（ロールなし）。奥行き dz も返す
function project(x, y, z) {
  const dz = renderCam.z - z;
  if (dz < 0.5) return null;
  bendAt(dz);
  const s = focal / dz;
  return {
    x: SCREEN_W / 2 + (x - renderCam.x + BX) * s,
    y: SCREEN_H / 2 - (y - renderCam.y + BY) * s + camPitch * focal,
    s: s,
    dz: dz,
  };
}

// 奥行き dz の位置での水面の高さ（画面の y 座標）
function waterlineY(dz) {
  bendAt(dz);
  return SCREEN_H / 2 - (waterLevel - renderCam.y + BY) * (focal / dz) + camPitch * focal;
}

// ヘッドライト（スポットライト）の当たり具合
//   cosTheta: 視線と正面のなす角の cos / dist: 距離
function headlight(cosTheta, dist) {
  if (dist >= 150) return 0;
  let spot = (cosTheta - 0.62) / (0.9 - 0.62);
  if (spot <= 0) return 0;
  if (spot > 1) spot = 1;
  spot = spot * spot * (3 - 2 * spot);
  return spot * Math.pow(1 - dist / 150, 0.8);
}
const AMBIENT = 0.12;
function ambientAt(dist) {
  return dist < 400 ? AMBIENT * (1 - dist / 400) : 0;
}

// スプライト用：画面上の位置と距離から明るさの段階を決める
function spriteLevel(sx, sy, dz, z) {
  const ox = (sx - SCREEN_W / 2) / focal;
  const oy = (sy - SCREEN_H / 2) / focal;
  const cosT = 1 / Math.sqrt(1 + ox * ox + oy * oy);
  let lum = 1.1 * headlight(cosT, dz) + ambientAt(dz);
  manholes.forEach((m) => {
    const d = Math.abs(m.z - z);
    if (d < MANHOLE_LIGHT_RANGE) {
      const k = 1 - d / MANHOLE_LIGHT_RANGE;
      lum += 0.9 * k * k;
    }
  });
  const lamp = ZONES[zoneIndexAt(z)].lamp;
  if (lamp) lum += 0.25;
  return Math.max(0, Math.min(LIGHT_LEVELS, Math.round(lum * LIGHT_LEVELS)));
}

// ============================================================
// 描画：下水管（1ピクセルずつ視線と管の交点を求める）
// ============================================================
// 奥行き t の点が管の内側か（曲がった管用）
function insideTube(t, du, dv, cx, cy, R2) {
  bendAt(t);
  const x = cx + t * du - BX;
  const y = cy + t * dv - BY;
  return x * x + y * y < R2;
}
// 曲がった管との交点：まっすぐな管としての交点 t0 を手がかりに二分探索する
function curvedHit(du, dv, t0, cx, cy, R2) {
  // その奥行きで管がほとんどずれていなければ、まっすぐな管の答えで十分
  bendAt(t0);
  if (Math.abs(BX) + Math.abs(BY) < 0.03) return t0;
  let lo = 0;
  let hi = t0;
  if (insideTube(hi, du, dv, cx, cy, R2)) {
    // 管がこちらへ曲がってきている → もっと先で壁に当たる
    lo = hi;
    hi = hi * 1.5 + 4;
    while (hi < BEND_MAX && insideTube(hi, du, dv, cx, cy, R2)) {
      lo = hi;
      hi = hi * 1.5 + 4;
    }
    if (hi >= BEND_MAX) {
      if (insideTube(BEND_MAX, du, dv, cx, cy, R2)) return 1e5;
      hi = BEND_MAX;
    }
  } else if (insideTube(hi * 0.6, du, dv, cx, cy, R2)) {
    lo = hi * 0.6; // 探す範囲をせばめて回数を減らす
  }
  // 遠いピクセルほど粗い精度で打ち切る（画面上では違いが見えない）
  for (let k = 0; k < 8 && hi - lo > hi * 0.02 + 0.05; k++) {
    const m = (lo + hi) * 0.5;
    if (insideTube(m, du, dv, cx, cy, R2)) lo = m;
    else hi = m;
  }
  return hi;
}

function renderTunnel(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  const R = pipeRadius;
  const R2 = R * R;
  const invR = 1 / R;
  const cx = renderCam.x;
  const cy = renderCam.y;
  const cz = renderCam.z;
  const cr = Math.cos(camRoll);
  const sr = Math.sin(camRoll);
  const pitchOff = camPitch * focal;
  const invF = 1 / focal;
  const cc = cx * cx + cy * cy - R2; // 管の内側なら負
  const L = waterLevel;
  const camAboveWater = cy > L + 0.05;

  // 見えている範囲のデカール（壁の異常）を集める
  frameDecals = anomalies.filter(
    (o) => o.visible && o.z < cz + o.half + 1 && o.z > cz - 170,
  );
  const nd = frameDecals.length;

  // 近くのマンホール（天井の穴と照明）
  let mh = null;
  manholes.forEach((m) => {
    if (m.z < cz + MANHOLE_LIGHT_RANGE && m.z > cz - 220) mh = mh || m;
  });
  const mhz = mh ? mh.z : 0;
  const lightY = R - 2;

  // 増水中は水が速く流れ、茶色くにごる
  const waterShift = now * 0.01 * (1 + 3 * floodK);
  const buf = frameBuf32;

  let i = 0;
  for (let py = 0; py < H; py++) {
    const oy = py - H / 2 + 0.5;
    const bayerRow = (py & 3) * 4;
    for (let px = 0; px < W; px++, i++) {
      const ox = px - W / 2 + 0.5;
      // 画面の傾きを戻して、視線の向きを求める
      const ux = ox * cr + oy * sr;
      const uy = -ox * sr + oy * cr;
      const du = ux * invF;
      const dv = (pitchOff - uy) * invF;
      const a = du * du + dv * dv;

      // まっすぐな円柱 (x^2 + y^2 = R^2) との交点までの奥行き t
      let t = 1e5;
      if (a > 1e-10) {
        const b = cx * du + cy * dv;
        let disc = b * b - a * cc;
        if (disc < 0) disc = 0;
        t = (-b + Math.sqrt(disc)) / a;
      }
      // 管が曲がっているときは、曲がりを考慮して交点を探し直す
      if (courseCurving && t < 1e4) t = curvedHit(du, dv, t, cx, cy, R2);
      idBuf[i] = 0;

      // 遠すぎる場所は真っ暗
      if (t > 400) {
        depthBuf[i] = t;
        buf[i] = 0xff000000;
        continue;
      }

      bendAt(t);
      let hx = cx + t * du - BX;
      let hy = cy + t * dv - BY;
      let wz = cz - t;
      let ldu = du - BDX; // 管に対する視線の向き（曲がりを考慮）
      let ldv = dv - BDY;

      // 水面との交点（壁に当たる前に水面に当たるか）
      let isWater = false;
      if (camAboveWater && hy < L) {
        let tw;
        if (!courseCurving) {
          tw = (L - cy) / dv;
        } else {
          let lo = 0;
          let hi = t;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) * 0.5;
            bendAt(m);
            if (cy + m * dv - BY > L) lo = m;
            else hi = m;
          }
          tw = hi;
        }
        t = tw;
        bendAt(t);
        hx = cx + t * du - BX;
        hy = L;
        wz = cz - t;
        ldu = du - BDX;
        ldv = dv - BDY;
        isWater = true;
      }
      depthBuf[i] = t;
      const zi = zoneIndexAt(wz);
      const lamp = ZONES[zi].lamp;

      let ang = 0;
      let tr, tg, tb;
      let addR = 0;
      let addG = 0;
      let addB = 0;

      if (isWater) {
        const wu = Math.floor(hx * 3) & (WATER_TEX - 1);
        const wv = Math.floor(wz * 3 + waterShift) & (WATER_TEX - 1);
        const p = (wv * WATER_TEX + wu) * 4;
        tr = waterTex[p];
        tg = waterTex[p + 1];
        tb = waterTex[p + 2];
        if (floodK > 0) {
          // 増水中の濁った水（茶色に寄せる）
          const k = floodK * 0.7;
          tr += (96 - tr) * k;
          tg += (78 - tg) * k;
          tb += (48 - tb) * k;
        }
      } else {
        ang = Math.atan2(hy, hx);

        // マンホールの穴（地上の光がそのまま見える）
        if (mh && hy > 0) {
          const dzm = wz - mhz;
          const rr = hx * hx + dzm * dzm;
          if (rr < MANHOLE_HOLE_R * MANHOLE_HOLE_R) {
            buf[i] = BAYER4[bayerRow + (px & 3)] < 0.25 ? 0xffd8f4ff : 0xffb0ecff;
            continue;
          }
          if (rr < 7) {
            buf[i] = 0xff282c30; // 鉄のふち
            continue;
          }
        }

        // 壁のランプ（光っている部分はそのまま明るく描く）
        if (lamp) {
          const P = lamp.every;
          const dzl = (((wz % P) + P) % P) - P / 2;
          if (dzl > -0.45 && dzl < 0.45) {
            let onLamp = false;
            for (let k = 0; k < lamp.angs.length; k++) {
              const da = (ang - lamp.angs[k]) * R;
              if (da > -0.7 && da < 0.7) onLamp = true;
            }
            if (onLamp) {
              const c = lamp.color;
              buf[i] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
              continue;
            }
          }
        }

        const tex = zoneTextures[zi];
        const tu = Math.floor(ang * TEX_U_SCALE) & (TEX - 1);
        const tv = Math.floor(wz * TEX_V_SCALE) & (TEX - 1);
        const p = (tv * TEX + tu) * 4;
        tr = tex[p];
        tg = tex[p + 1];
        tb = tex[p + 2];

        // 壁の異常（デカール）を重ねる
        for (let k = 0; k < nd; k++) {
          const o = frameDecals[k];
          const dzd = wz - o.z;
          if (dzd <= -o.half || dzd >= o.half) continue;
          let da = ang - o.ang;
          if (da > Math.PI) da -= TAU;
          else if (da < -Math.PI) da += TAU;
          const s = da * R;
          if (s <= -o.half || s >= o.half) continue;
          const img = o.img;
          const iu = ((s + o.half) * o.texel) | 0;
          const iv = ((dzd + o.half) * o.texel) | 0;
          const q = (iv * img.w + iu) * 4;
          if (img.data[q + 3]) {
            tr = img.data[q];
            tg = img.data[q + 1];
            tb = img.data[q + 2];
            idBuf[i] = k + 1;
          }
        }
      }

      // 明るさ：ヘッドライト（スポット＋面への当たる角度）＋環境光
      const invLen = 1 / Math.sqrt(1 + a);
      const lInv = 1 / Math.sqrt(1 + ldu * ldu + ldv * ldv);
      let ndl = isWater ? -ldv * lInv : (hx * ldu + hy * ldv) * invR * lInv;
      if (ndl < 0) ndl = 0;
      let lum = 2.4 * headlight(invLen, t) * ndl + ambientAt(t);
      if (isWater) lum = lum * 1.2 + 0.04;

      // マンホールから差し込む光（暖色）
      if (mh) {
        const ly = hy - lightY;
        const lz = wz - mhz;
        const d2 = hx * hx + ly * ly + lz * lz;
        if (d2 < MANHOLE_LIGHT_RANGE * MANHOLE_LIGHT_RANGE) {
          const k = 1 - Math.sqrt(d2) / MANHOLE_LIGHT_RANGE;
          const w = k * k;
          lum += w;
          addR += w * 40;
          addG += w * 28;
        }
      }

      // 壁のランプの光（ランプの近くだけ色つきで明るくなる）
      if (lamp) {
        const P = lamp.every;
        const dzl = (((wz % P) + P) % P) - P / 2;
        const k = 1 - Math.abs(dzl) / 5;
        if (k > 0) {
          // 遠くのランプの光は少し弱める（重なって画面が白く飛ばないように）
          const w = k * k * 0.4 * (t < 250 ? 1 - t / 350 : 0.3);
          lum += w * 0.5;
          addR += w * lamp.color[0] * 0.22;
          addG += w * lamp.color[1] * 0.22;
          addB += w * lamp.color[2] * 0.22;
        }
      }

      // 明るさを段階化（ディザで境目を網目にする）
      const q =
        Math.floor(lum * LIGHT_LEVELS + BAYER4[bayerRow + (px & 3)]) / LIGHT_LEVELS;
      let r = tr * q + addR;
      let g = tg * q + addG;
      let b = tb * q + addB;
      if (!camAboveWater) {
        // カメラが水中：青緑にくもらせる
        r = r * 0.4;
        g = g * 0.6 + 20;
        b = b * 0.6 + 30;
      }
      if (r > 255) r = 255;
      if (g > 255) g = 255;
      if (b > 255) b = 255;
      buf[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }
  ctx.putImageData(frameImage, 0, 0);
}

// ============================================================
// 描画：スプライト（障害物・光の柱・ドローン・破片）
// ============================================================
// 点検済みを示す水色のカギ括弧型の枠
function drawBracket(x0, y0, x1, y1, color) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const L = Math.max(2, Math.min(6, Math.round((x1 - x0) / 4)));
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, L, 1);
  ctx.fillRect(x0, y0, 1, L);
  ctx.fillRect(x1 - L + 1, y0, L, 1);
  ctx.fillRect(x1, y0, 1, L);
  ctx.fillRect(x0, y1, L, 1);
  ctx.fillRect(x0, y1 - L + 1, 1, L);
  ctx.fillRect(x1 - L + 1, y1, L, 1);
  ctx.fillRect(x1, y1 - L + 1, 1, L);
}

// デカールの画面上の範囲（壁面上の9点を投影して囲む）
function decalRect(o) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = -1; i <= 1; i++) {
    const ang = o.ang + (i * o.half) / pipeRadius;
    const wx = Math.cos(ang) * pipeRadius;
    const wy = Math.sin(ang) * pipeRadius;
    for (let j = -1; j <= 1; j++) {
      const p = project(wx, wy, o.z + j * o.half);
      if (!p) return null;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return { x0: x0, y0: y0, x1: x1, y1: y1 };
}

// 破片・しぶきを描く（minDz〜maxDz の奥行きのものだけ）
function drawParticles(minDz, maxDz) {
  FX.parts.forEach((p) => {
    const q = project(p.x, p.y, p.z);
    if (!q || q.dz < minDz || q.dz >= maxDz) return;
    const s = Math.max(1, Math.min(4, Math.round(p.size * q.s)));
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s);
  });
}

function renderWorld(now) {
  frameSprites = [];
  const list = [];

  hazards.forEach((o) => {
    if (!o.visible || o.z > renderCam.z - 3 || o.z < renderCam.z - 170) return;
    const p = project(o.x, o.y, o.z);
    if (!p) return;
    const w = o.w * p.s;
    const h = o.h * p.s;
    list.push({
      obj: o,
      dz: p.dz,
      x0: p.x - w / 2,
      y0: p.y - h / 2,
      x1: p.x + w / 2,
      y1: p.y + h / 2,
      cx: p.x,
      cy: p.y,
      w: w,
      h: h,
    });
  });

  manholes.forEach((m) => {
    const p = project(0, 0, m.z);
    if (!p || p.dz > 220) return;
    const w = 5.6 * p.s;
    const h = pipeRadius * 2 * p.s;
    list.push({ beam: true, dz: p.dz, cx: p.x, cy: p.y, w: w, h: h });
  });

  // 奥から順に描く（手前のものが上に重なる）
  list.sort((a, b) => b.dz - a.dz);

  // 画面全体をドローンの傾きに合わせて回転させて描く
  ctx.save();
  ctx.translate(SCREEN_W / 2, SCREEN_H / 2);
  ctx.rotate(camRoll);
  ctx.translate(-SCREEN_W / 2, -SCREEN_H / 2);

  drawParticles(170, 1e9);

  list.forEach((s) => {
    const x = Math.round(s.cx - s.w / 2);
    const y = Math.round(s.cy - s.h / 2);
    const w = Math.max(1, Math.round(s.w));
    const h = Math.max(1, Math.round(s.h));

    if (s.beam) {
      // 光の柱：加算合成でうっすら光らせる
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.35, 0.35 * (1 - s.dz / 220) + 0.05);
      ctx.drawImage(beamSprite, x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      return;
    }

    const o = s.obj;
    const lv = spriteLevel(s.cx, s.cy, s.dz, o.z);
    if (o.rot) {
      // 木の根：天井側なので水にはつからない
      ctx.save();
      ctx.translate(Math.round(s.cx), Math.round(s.cy));
      ctx.rotate(o.rot);
      ctx.drawImage(o.sprite[lv], -Math.round(w / 2), -Math.round(h / 2), w, h);
      ctx.restore();
    } else {
      // 水面より下の部分は切り取って描く（水につかって見える）
      const wl = Math.round(waterlineY(s.dz));
      const visH = Math.min(h, wl - y);
      if (visH <= 0) return;
      s.y1 = Math.min(s.y1, wl);
      const src = o.type === "leak" ? leakFrames[Math.floor(now / 90) % leakFrames.length][Math.max(1, lv)] : o.sprite[lv];
      if (o.type === "leak") ctx.globalAlpha = 0.8;
      ctx.drawImage(src, 0, 0, src.width, (src.height * visH) / h, x, y, w, visH);
      ctx.globalAlpha = 1;
    }
    frameSprites.push(s);
  });

  // 点検済みの壁の異常に水色の枠
  frameDecals.forEach((o) => {
    if (!o.helper) return;
    const r = decalRect(o);
    if (r) drawBracket(r.x0, r.y0, r.x1, r.y1, "#00e5ff");
  });

  drawParticles(CAM_BACK + 0.5, 170);

  // ドローン本体（点滅中は1コマおきに消す）
  const dp = project(cam.x, cam.y, cam.z);
  if (dp && droneVisible && !(hurtBlink > 0 && Math.floor(now / 60) % 2 === 0)) {
    const w = Math.round(DRONE_W * dp.s);
    const h = Math.round(DRONE_H * dp.s);
    const bob = Math.round(Math.sin(now * 0.008) * 1);
    ctx.save();
    ctx.translate(Math.round(dp.x), Math.round(dp.y) + bob);
    ctx.rotate(droneBank - camRoll * 0.5);
    ctx.drawImage(droneFrames[Math.floor(now / 40) % 2], -Math.round(w / 2), -Math.round(h / 2), w, h);
    ctx.restore();
  }

  drawParticles(0, CAM_BACK + 0.5);

  // 点検したときの広がる輪
  FX.rings.forEach((r) => {
    const k = r.age / 0.4;
    const rad = 3 + k * 22;
    const n = Math.max(12, Math.round(rad * 2.5));
    ctx.fillStyle = r.color;
    for (let j = 0; j < n; j++) {
      if ((j + Math.floor(k * 6)) % 3 === 0) continue;
      const a = (j / n) * TAU;
      ctx.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad), 1, 1);
    }
  });
  // 飛び出す数字
  FX.pops.forEach((p) => {
    const rise = Math.min(1, p.age / 0.5);
    drawText(p.text, p.x, p.y - 8 - rise * 14, 1, p.color);
  });

  ctx.restore();
}

// ============================================================
// 描画：画面に重ねる演出（スピード線・コンボ・大きな文字・フラッシュなど）
// ============================================================
// ドット単位の直線
function pixelLine(x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) {
    ctx.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
  }
}

function renderOverlay(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;

  // スピード線
  ctx.fillStyle = "rgba(220, 240, 255, 0.55)";
  FX.lines.forEach((l) => {
    const c = Math.cos(l.ang);
    const s = Math.sin(l.ang);
    pixelLine(W / 2 + c * l.r, H / 2 + s * l.r, W / 2 + c * (l.r + l.len), H / 2 + s * (l.r + l.len));
  });

  // 大雨警報中：画面の上下に赤と青の警告灯
  if (sirenTime > 0) {
    const on = Math.floor(now / 180) % 2 === 0;
    ctx.fillStyle = on ? "rgba(255, 40, 60, 0.55)" : "rgba(40, 120, 255, 0.55)";
    for (let x = 0; x < W; x += 2) {
      ctx.fillRect(x, 0, 1, 3);
      ctx.fillRect(x + 1, H - 3, 1, 3);
    }
  }

  // コンボ ×5：画面のふちを虹色に光らせる
  if (combo >= COMBO_MAX_MULT && isGameStarted && !isGameOver) {
    const k = Math.floor(now / 80);
    for (let x = 0; x < W; x += 3) {
      ctx.fillStyle = RAINBOW[(Math.floor(x / 6) + k) % RAINBOW.length];
      ctx.fillRect(x, 0, 2, 2);
      ctx.fillRect(W - 1 - x, H - 2, 2, 2);
    }
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = RAINBOW[(Math.floor(y / 6) + k) % RAINBOW.length];
      ctx.fillRect(0, H - 1 - y, 2, 2);
      ctx.fillRect(W - 2, y, 2, 2);
    }
  }

  // 体力が少ないとき：画面のふちが赤く脈打つ
  if (isGameStarted && !isGameOver && hp < 30) {
    const a = 0.25 + 0.2 * Math.sin(now * 0.012);
    ctx.fillStyle = `rgba(255, 30, 40, ${a})`;
    for (let d = 0; d < 6; d += 2) {
      ctx.fillRect(d, d, W - d * 2, 1);
      ctx.fillRect(d, H - 1 - d, W - d * 2, 1);
      ctx.fillRect(d, d, 1, H - d * 2);
      ctx.fillRect(W - 1 - d, d, 1, H - d * 2);
    }
  }

  // コンボ表示（段階が上がるほど大きく・派手に・揺れる）
  if (combo >= 2 && isGameStarted && !isGameOver) {
    const lv = Math.min(combo, COMBO_MAX_MULT);
    const scale = lv >= 4 ? 2 : 1;
    const pop = FX.comboPop > 0 ? 1 : 0;
    const shake = lv >= 3 ? (lv - 2) * 0.8 : 0;
    const colors =
      lv >= 5 ? rainbowShift(Math.floor(now / 70)) : lv >= 4 ? "#ff9a3c" : lv >= 3 ? "#ffe14d" : "#ffffff";
    drawText(
      `COMBO x${lv}`,
      W / 2 + (Math.random() - 0.5) * shake * 2,
      H - 20 - pop * 3 + (Math.random() - 0.5) * shake * 2,
      scale + pop,
      colors,
    );
  }

  // 画面中央の大きな文字（カウントダウン・ゾーン・警報など）
  const bn = FX.banner;
  if (bn) {
    const popIn = bn.age < 0.12 ? 1 : 0;
    const fade = bn.age > bn.dur - 0.25;
    if (!fade || Math.floor(now / 50) % 2 === 0) {
      const color = bn.color === "rainbow" ? rainbowShift(Math.floor(now / 70)) : bn.color;
      drawText(bn.text, W / 2, H * 0.3 - popIn * 2, bn.scale + popIn, color);
      if (bn.sub) drawText(bn.sub, W / 2, H * 0.3 + bn.scale * 9 + 4, 1, "#ffffff");
    }
  }

  // 衝突で入った画面のヒビ
  FX.cracks.forEach((c) => {
    const a = Math.max(0, 1 - c.age / 1.4);
    ctx.fillStyle = `rgba(230, 245, 255, ${a})`;
    for (let k = 1; k < c.pts.length; k++) {
      pixelLine(c.pts[k - 1][0], c.pts[k - 1][1], c.pts[k][0], c.pts[k][1]);
    }
  });

  // フラッシュ（点検は白、衝突は赤）
  if (FX.flashA > 0) {
    ctx.fillStyle = `rgba(${FX.flashRGB}, ${Math.min(1, FX.flashA)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ============================================================
// ゴール後の演出：マンホールから地上へ飛び出し、晴れた街が見える
// ============================================================
let cityStart = -1; // 地上の場面が始まった時刻（-1 なら下水道の中）
const cityBuildings = { far: [], near: [] };
(function createCity() {
  let x = 0;
  while (x < 520) {
    const w = randInt(12, 26);
    cityBuildings.far.push({ x: x, w: w, h: randInt(30, 70), lit: Math.random() });
    x += w + randInt(0, 3);
  }
  x = -10;
  while (x < 520) {
    const w = randInt(18, 34);
    cityBuildings.near.push({ x: x, w: w, h: randInt(40, 90), lit: Math.random() });
    x += w + randInt(2, 8);
  }
})();
const cityConfetti = [];
for (let i = 0; i < 90; i++) {
  cityConfetti.push({
    x: Math.random(),
    vx: (Math.random() - 0.5) * 40,
    vy: -60 - Math.random() * 90,
    ph: Math.random() * TAU,
    color: pick(RAINBOW),
  });
}

function drawBuildings(list, color, winColor, groundY) {
  list.forEach((b) => {
    const x = Math.round(b.x - (520 - SCREEN_W) / 2);
    if (x > SCREEN_W || x + b.w < 0) return;
    ctx.fillStyle = color;
    ctx.fillRect(x, groundY - b.h, b.w, b.h);
    // 窓（建物ごとに決まった並びで明かりをつける）
    ctx.fillStyle = winColor;
    let n = 0;
    for (let wy = groundY - b.h + 4; wy < groundY - 4; wy += 5) {
      for (let wx = x + 3; wx < x + b.w - 3; wx += 4) {
        n++;
        if ((n * 7919 + Math.floor(b.lit * 97)) % 5 < 2) ctx.fillRect(wx, wy, 2, 2);
      }
    }
  });
}

function renderCity(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  const t = (now - cityStart) / 1000;
  const groundY = H - 16;

  // 空（上ほど濃い青。段階の境目をディザでつなぐ）
  const sky = [
    [34, 84, 196],
    [60, 120, 226],
    [96, 158, 242],
    [146, 196, 250],
    [206, 228, 255],
  ];
  const buf = frameBuf32;
  for (let y = 0; y < H; y++) {
    const f = Math.min(1, y / groundY) * (sky.length - 1);
    for (let x = 0; x < W; x++) {
      const k = Math.min(sky.length - 1, Math.floor(f + BAYER4[(y & 3) * 4 + (x & 3)]));
      const c = sky[k];
      buf[y * W + x] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }
  ctx.putImageData(frameImage, 0, 0);

  // 太陽
  const sunX = Math.round(W * 0.8);
  const sunY = 30;
  ctx.fillStyle = "#fff4b0";
  for (let dy = -11; dy <= 11; dy++) {
    const hw = Math.round(Math.sqrt(121 - dy * dy));
    ctx.fillRect(sunX - hw, sunY + dy, hw * 2, 1);
  }
  ctx.fillStyle = "#ffe066";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + t * 0.5;
    ctx.fillRect(Math.round(sunX + Math.cos(a) * 16), Math.round(sunY + Math.sin(a) * 16), 2, 2);
  }

  // 雲（ゆっくり流れる）
  ctx.fillStyle = "#ffffff";
  [
    [20, 24, 30],
    [150, 40, 38],
    [260, 18, 26],
  ].forEach(([bx, by, bw]) => {
    const x = Math.round(((bx + t * 8) % (W + 60)) - 40);
    ctx.fillRect(x, by, bw, 4);
    ctx.fillRect(x + 5, by - 3, bw - 12, 3);
    ctx.fillRect(x + 3, by + 4, bw - 6, 2);
  });

  // ビル（奥と手前の2列）
  drawBuildings(cityBuildings.far, "#3a4c86", "#ffe9a8", groundY);
  drawBuildings(cityBuildings.near, "#222b52", "#ffd070", groundY);

  // 道路と、開いたマンホール
  ctx.fillStyle = "#3b3b44";
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.fillStyle = "#e8e8e8";
  for (let x = 4; x < W; x += 24) ctx.fillRect(x, groundY + 9, 12, 2);
  ctx.fillStyle = "#111";
  ctx.fillRect(Math.round(W / 2 - 14), groundY + 3, 28, 5);
  ctx.fillStyle = "#6a6f78";
  ctx.fillRect(Math.round(W / 2 + 22), groundY + 5, 20, 3); // ふた

  // 紙吹雪
  cityConfetti.forEach((c) => {
    const x = c.x * W + c.vx * t + Math.sin(t * 4 + c.ph) * 6;
    const y = groundY + c.vy * t + 45 * t * t;
    if (y > groundY) return;
    ctx.fillStyle = c.color;
    ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
  });

  // マンホールから飛び出すドローン（大きく表示）
  const rise = 1 - Math.pow(1 - Math.min(1, t / 1.2), 3);
  const dy = groundY - 10 - rise * 78 + Math.sin(now * 0.006) * 2;
  const dw = 78;
  const dh = 39;
  ctx.save();
  ctx.translate(Math.round(W / 2), Math.round(dy));
  ctx.rotate(Math.sin(now * 0.004) * 0.08);
  ctx.drawImage(droneFrames[Math.floor(now / 40) % 2], -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // MISSION CLEAR!（上から落ちてきて弾む）
  const drop = t < 0.5 ? (1 - t / 0.5) * -40 : Math.abs(Math.sin((t - 0.5) * 6)) * Math.max(0, 1 - (t - 0.5)) * -6;
  drawText("MISSION CLEAR!", W / 2, 16 + drop, 3, rainbowShift(Math.floor(now / 90)));
}

// 1フレーム分を描画する（shakeX/Y: 画面ブレのずれ）
function renderFrame(shakeX = 0, shakeY = 0) {
  const now = performance.now();
  if (cityStart >= 0) {
    renderCity(now);
    renderOverlay(now);
    return;
  }
  // カメラはドローンの少し上・後ろ（管の外にはみ出さないようにおさえる）
  let rx = cam.x + shakeX;
  let ry = cam.y + CAM_UP + shakeY;
  const rr = Math.hypot(rx, ry);
  const maxR = pipeRadius - 0.8;
  if (rr > maxR) {
    rx *= maxR / rr;
    ry *= maxR / rr;
  }
  renderCam.x = rx;
  renderCam.y = ry;
  renderCam.z = cam.z + CAM_BACK;
  updateBend(renderCam.z);
  renderTunnel(now);
  renderWorld(now);
  renderOverlay(now);
}

// ============================================================
// ゲーム状態
// ============================================================
let hp = 100;
let score = 0;
let distance = 0;
const goalDistance = 300; // メートル換算
const zToMeterRatio = 10; // Z座標10単位 = 1メートル
const baseSpeed = 1.3;
let isGameOver = false;
let isGameStarted = false;
let isPaused = false;
let shakeIntensity = 0.0; // 画面ブレ（カメラシェイク）の強度

// 点検成績の集計
let inspectedCount = 0; // スキャン成功数
let missedCount = 0; // 見逃し（スキャンせず通過）数
let collidedCount = 0; // 障害物への衝突数

// コンボ状態
let combo = 0;
let maxCombo = 0;
let comboExpire = 0; // このミリ秒時刻までに次を発見しないとコンボが切れる
const COMBO_WINDOW = 4000;
const COMBO_MAX_MULT = 5;

// カメラの傾き（ドローンの機体挙動演出）は描画セクションの camRoll / camPitch を使う

// 演出・進行の状態
let anomalyFound = 0; // 見つけた壁の異常の数（発見率・ランクはこれで決める）
let hitStop = 0; // >0 のあいだ時間を止める（当たった瞬間の強調）
let countdown = 0; // >0 のあいだはスタート前のカウントダウン
let goalAnim = -1; // >=0 のときゴール演出中（経過秒）
let gameOverDelay = 0; // 墜落してからゲームオーバー画面を出すまでの残り時間
let resultShown = false; // クリア／ゲームオーバー画面が出ているか
let speedFactor = 0; // 0〜1：スピード演出の強さ
let currentZone = 0;
let floodWarned = false;
let sirenTime = 0; // 大雨警報の警告灯を出す残り時間

// 入力状態
const keys = {};
function normalizeKey(e) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}
// ゲーム開始（スペースキー / ゲームパッドのAボタン から呼ばれる）
function startGame() {
  if (isGameStarted || isGameOver) return;
  isGameStarted = true;
  AudioSys.init();
  AudioSys.resume();
  AudioSys.setDrone(true);
  Music.setup();
  updatePauseBtn();
  // 3・2・1・GO! のカウントダウンから始める
  countdown = 3;
  FX.showBanner("3", null, "#ffffff", 0.9, 7);
  AudioSys.playBeep(false);
  addLog("DRONE READY: COUNTDOWN");
  const startScreen = document.getElementById("startScreen");
  if (startScreen) {
    startScreen.style.opacity = 0;
    setTimeout(() => {
      startScreen.style.display = "none";
    }, 500);
  }
}

window.addEventListener("keydown", (e) => {
  keys[normalizeKey(e)] = true;
  // スペースキーで起動
  if (e.key === " " && !isGameStarted && !isGameOver) {
    startGame();
  }
  // 一時停止中のメニュー操作（↑↓ / W・S で選び、Enter / スペースで決定）
  if (isPaused && !isGameOver) {
    const k = normalizeKey(e);
    if (k === "ArrowUp" || k === "w") {
      e.preventDefault();
      setPauseSel(pauseSel - 1);
    } else if (k === "ArrowDown" || k === "s") {
      e.preventDefault();
      setPauseSel(pauseSel + 1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      decidePauseSel();
      return;
    }
  }
  // ESCキーで一時停止トグル
  if (e.key === "Escape" && isGameStarted && !isGameOver) {
    togglePause();
  }
  // Mキーでサウンドのミュート切り替え
  if (normalizeKey(e) === "m") {
    AudioSys.init();
    const muted = AudioSys.toggleMute();
    addLog(muted ? "SOUND: OFF" : "SOUND: ON");
  }
});
window.addEventListener("keyup", (e) => (keys[normalizeKey(e)] = false));

// ============================================================
// ゲームパッド対応（Gamepad API）
// 展示会でコントローラーを使って遊べるようにする。
//   左スティック / 十字キー : 移動
//   A(0) / R2(7)            : 点検スキャン（画面中央のレティクルで狙う）
//   START(9)                : 一時停止
//   A(0)                    : スタート・リスタート
//   一時停止中              : 上下で選択、A で決定、START / B(1) ですぐ再開
// ============================================================
const Pad = {
  connected: false,
  index: null,
  prevButtons: [],
  prevMenuDir: 0, // 一時停止メニューの上下入力（押した瞬間だけ反応させる）
  axisX: 0,
  axisY: 0,
  DEADZONE: 0.22,

  // ブラウザによっては getGamepads() が毎回新しいオブジェクトを返すのでフレーム毎に取得する
  get() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    // 記憶しているindexを優先し、なければ最初に見つかったものを使う
    if (this.index !== null && pads[this.index]) return pads[this.index];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        this.index = i;
        return pads[i];
      }
    }
    return null;
  },

  setConnected(on, label) {
    if (this.connected === on) return;
    this.connected = on;

    const item = document.getElementById("padStatusItem");
    if (item) item.style.display = on ? "flex" : "none";
    const status = document.getElementById("padStatus");
    if (status) status.innerText = on ? "GAMEPAD" : "KEYBOARD";

    // スタート画面の操作説明をパッド用に切り替える
    const padInfo = document.getElementById("padInstructions");
    if (padInfo) padInfo.style.display = on ? "block" : "none";
    const prompt = document.getElementById("startPrompt");
    if (prompt) {
      prompt.innerText = on
        ? "PRESS [A] BUTTON TO LAUNCH DRONE"
        : "PRESS [SPACE] TO LAUNCH DRONE";
    }

    if (on) addLog(`GAMEPAD CONNECTED: ${label || "CONTROLLER"}`);
    else addLog("GAMEPAD DISCONNECTED", "warning");
  },

  // 押した瞬間だけ true を返す（エッジ検出）
  pressed(pad, i) {
    const now = !!(pad.buttons[i] && pad.buttons[i].pressed);
    const before = !!this.prevButtons[i];
    return now && !before;
  },

  // 毎フレーム呼ぶ。移動量を this.axisX / this.axisY に入れる
  poll() {
    const pad = this.get();
    if (!pad) {
      this.setConnected(false);
      this.axisX = 0;
      this.axisY = 0;
      this.prevButtons = [];
      return;
    }
    this.setConnected(true, pad.id);

    // --- スティック入力（デッドゾーン処理つき） ---
    let ax = pad.axes[0] || 0;
    let ay = pad.axes[1] || 0;
    if (Math.abs(ax) < this.DEADZONE) ax = 0;
    if (Math.abs(ay) < this.DEADZONE) ay = 0;

    // --- 十字キー（D-pad: 12=上 13=下 14=左 15=右） ---
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (btn(14)) ax = -1;
    if (btn(15)) ax = 1;
    if (btn(12)) ay = -1;
    if (btn(13)) ay = 1;

    this.axisX = Math.max(-1, Math.min(1, ax));
    // Gamepad APIのY軸は下が正。ゲーム内の上下と合わせるため反転する
    this.axisY = -Math.max(-1, Math.min(1, ay));

    // --- ボタン処理 ---
    const aPressed = this.pressed(pad, 0);
    const r2Pressed = this.pressed(pad, 7);
    const startPressed = this.pressed(pad, 9);
    const bPressed = this.pressed(pad, 1);
    // メニュー用の上下（-1: 上 / 1: 下）。スティックは大きく倒したときだけ
    const menuDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
    const menuMoved = menuDir !== 0 && menuDir !== this.prevMenuDir;
    this.prevMenuDir = menuDir;

    if (aPressed || r2Pressed) {
      AudioSys.init();
      AudioSys.resume();
    }

    if (!isGameStarted && !isGameOver) {
      // タイトル画面：Aボタンで発進
      if (aPressed) startGame();
    } else if (isGameOver) {
      // クリア／ゲームオーバー画面：Aボタンでタイトルへ戻る
      // （結果画面が出てから。演出の途中で押してもタイトルへは戻らない）
      if (aPressed && resultShown) resetGame();
    } else if (isPaused) {
      // 一時停止中：上下で選んで A で決定。START / B はすぐ再開
      if (menuMoved) setPauseSel(pauseSel + menuDir);
      if (startPressed || bPressed) togglePause();
      else if (aPressed) decidePauseSel();
    } else {
      if (startPressed) togglePause();
      // 画面中央（レティクル位置）に向けてスキャン
      if (aPressed || r2Pressed) {
        if (!tryScan(0, 0)) AudioSys.playMiss();
      }
    }

    // 次フレームのエッジ検出用に押下状態を保存
    this.prevButtons = pad.buttons.map((b) => b.pressed);
  },
};

window.addEventListener("gamepadconnected", (e) => {
  Pad.index = e.gamepad.index;
});
window.addEventListener("gamepaddisconnected", () => {
  Pad.index = null;
});

// ============================================================
// 一時停止メニュー
//   0: つづける / 1: やめてタイトルへもどる
//   マウス・キーボード（↑↓＋Enter）・ゲームパッド（上下＋A）で選べる
// ============================================================
const pauseBtnEl = document.getElementById("pauseBtn");
const pauseMenuBtns = [
  document.getElementById("resumeBtn"),
  document.getElementById("restartBtn"),
];
let pauseSel = 0;
let pausedAt = 0; // 一時停止した時刻（止めている間にコンボが切れないようにする）

function setPauseSel(i) {
  const n = pauseMenuBtns.length;
  pauseSel = (i + n) % n;
  pauseMenuBtns.forEach((b, k) => b.classList.toggle("selected", k === pauseSel));
}

function decidePauseSel() {
  if (pauseSel === 0) togglePause();
  else resetGame();
}

// プレイ中だけ画面上のポーズボタンを出す
function updatePauseBtn() {
  if (!pauseBtnEl) return;
  pauseBtnEl.style.display = isGameStarted && !isGameOver ? "block" : "none";
}

// ボタンに残ったフォーカスを外す（あとでスペースキーを押したときに
// フォーカスの残ったボタンが勝手に押されるのを防ぐ）
function blurActiveButton() {
  const el = document.activeElement;
  if (el && el.tagName === "BUTTON") el.blur();
}

// 一時停止切り替え
function togglePause() {
  isPaused = !isPaused;
  AudioSys.setDrone(!isPaused && isGameStarted && !isGameOver);
  blurActiveButton();
  if (isPaused) {
    pausedAt = performance.now();
    setPauseSel(0); // 開いたときは「つづける」を選んでおく
    Music.pause();
  } else {
    if (comboExpire > 0) {
      // 止めていた時間のぶんだけコンボの制限時間をのばす
      comboExpire += performance.now() - pausedAt;
    }
    Music.resume();
  }
  const pauseScreen = document.getElementById("pauseScreen");
  if (pauseScreen) {
    if (isPaused) {
      pauseScreen.style.display = "flex";
      pauseScreen.offsetHeight; // リフロー強制
      pauseScreen.style.opacity = 1;
    } else {
      pauseScreen.style.opacity = 0;
      setTimeout(() => {
        if (!isPaused) pauseScreen.style.display = "none";
      }, 300);
    }
  }
}

// ゲーム開始時点に戻る（リセット）
function resetGame() {
  hp = 100;
  score = 0;
  distance = 0;
  isGameOver = false;
  isGameStarted = false;
  isPaused = false;
  shakeIntensity = 0.0;
  inspectedCount = 0;
  missedCount = 0;
  collidedCount = 0;
  combo = 0;
  maxCombo = 0;
  comboExpire = 0;
  camRoll = 0;
  camPitch = 0;
  AudioSys.setDrone(false);

  // 演出・進行の状態を初期化
  Music.stop();
  FX.clear();
  anomalyFound = 0;
  hitStop = 0;
  countdown = 0;
  goalAnim = -1;
  gameOverDelay = 0;
  resultShown = false;
  speedFactor = 0;
  currentZone = 0;
  floodWarned = false;
  sirenTime = 0;
  floodK = 0;
  waterLevel = WATER_BASE;
  focal = BASE_FOCAL;
  cityStart = -1;
  droneBank = 0;
  hurtBlink = 0;
  droneVisible = true;
  setHudVisible(true);

  updatePauseBtn();
  blurActiveButton();

  // 今回のプレイぶんの図鑑記録だけリセット（累計 codexSession は保持する）
  CODEX_ORDER.forEach((k) => (codexRun[k] = 0));

  // カメラを初期位置へ
  cam.x = 0;
  cam.y = 0;
  cam.z = 0;

  // 障害物とアノマリーの再アクティブ化と点検済みの枠の解除
  hazards.concat(anomalies).forEach((o) => {
    o.active = true;
    o.counted = false;
    o.visible = true;
    o.helper = false;
  });

  // マンホール通過状態のリセット
  manholes.forEach((m) => (m.passed = false));

  // ログのクリア
  const logArea = document.getElementById("logArea");
  if (logArea) {
    logArea.innerHTML = "";
  }

  // 図鑑カード・コンボ表示を隠す
  hideInfoCard();
  updateComboUI();

  // UI更新
  updateUI();

  // スタート画面再表示
  const startScreen = document.getElementById("startScreen");
  if (startScreen) {
    startScreen.style.display = "flex";
    startScreen.offsetHeight;
    startScreen.style.opacity = 1;
  }

  // 一時停止画面非表示
  const pauseScreen = document.getElementById("pauseScreen");
  if (pauseScreen) {
    pauseScreen.style.opacity = 0;
    pauseScreen.style.display = "none";
  }

  // クリア画面非表示
  const clearScreen = document.getElementById("clearScreen");
  if (clearScreen) {
    clearScreen.style.opacity = 0;
    clearScreen.style.display = "none";
  }

  // ゲームオーバー画面非表示
  const gameOverScreen = document.getElementById("gameOverScreen");
  if (gameOverScreen) {
    gameOverScreen.style.opacity = 0;
    gameOverScreen.style.display = "none";
  }
}

// メニューボタンイベント設定
document.getElementById("resumeBtn").addEventListener("click", () => {
  if (isPaused) togglePause();
});
document.getElementById("restartBtn").addEventListener("click", () => {
  resetGame();
});
document.getElementById("clearBackBtn").addEventListener("click", () => {
  resetGame();
});
document.getElementById("gameOverBackBtn").addEventListener("click", () => {
  resetGame();
});
// プレイ中のポーズボタン
pauseBtnEl.addEventListener("click", () => {
  if (isGameStarted && !isGameOver && !isPaused) togglePause();
  blurActiveButton();
});
// マウスを乗せたボタンを選択中にする（キー操作の選択と表示をそろえる）
pauseMenuBtns.forEach((b, i) => {
  b.addEventListener("mouseenter", () => setPauseSel(i));
});

// システムログ出力関数
function addLog(text, type = "info") {
  const logArea = document.getElementById("logArea");
  if (!logArea) return;
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
  logArea.appendChild(entry);

  // 古いログの削除
  while (logArea.children.length > 5) {
    logArea.removeChild(logArea.firstChild);
  }

  // フェードアウト自動消去
  setTimeout(() => {
    if (entry.parentNode === logArea) {
      entry.style.opacity = 0;
      entry.style.transition = "opacity 0.5s ease";
      setTimeout(() => {
        if (entry.parentNode === logArea) logArea.removeChild(entry);
      }, 500);
    }
  }, 4000);
}

// ============================================================
// 通知カード（発見・区間・警報などを短く知らせる。テンポを止めないよう小さく短く）
//   desc が空なら1行だけの通知になる。詳しい解説は結果画面で読める
// ============================================================
let infoCardTimer = null;
function showInfoCard(title, desc, extraClass = "", duration = 1800) {
  const card = document.getElementById("infoCard");
  document.getElementById("infoTitle").innerText = title;
  const descEl = document.getElementById("infoDesc");
  descEl.innerText = desc;
  descEl.style.display = desc ? "block" : "none";
  card.className = extraClass;
  card.style.display = "block";
  card.offsetHeight; // リフロー強制
  card.classList.add("show");

  if (infoCardTimer) clearTimeout(infoCardTimer);
  infoCardTimer = setTimeout(hideInfoCard, duration);
}

function hideInfoCard() {
  const card = document.getElementById("infoCard");
  if (!card) return;
  card.classList.remove("show");
  if (infoCardTimer) clearTimeout(infoCardTimer);
  infoCardTimer = setTimeout(() => {
    card.style.display = "none";
  }, 300);
}

// コンボ表示の更新（表示そのものは renderOverlay でドット文字として描く）
function updateComboUI() {
  if (combo >= 2) FX.comboPop = 0.15; // 増えた瞬間だけ文字を大きくする
  else FX.comboPop = 0;
}

// ============================================================
// 点検判定（画面上の1点に映っているものを調べる）
//   壁の異常：管の描画時に記録した idBuf / depthBuf を見る
//   障害物　：直前のフレームで描いたスプライトの範囲に入っているか
// ============================================================
const SCAN_RANGE = 140; // これ以上遠い異常はスキャンできない

// 指定した正規化デバイス座標(NDC)に映っている点検対象を返す（なければ null）
function pickTarget(ndcX, ndcY) {
  const sx = ((ndcX + 1) / 2) * SCREEN_W;
  const sy = ((1 - ndcY) / 2) * SCREEN_H;
  let best = null;
  let bestDist = SCAN_RANGE;

  // 壁の異常（デカール）
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  if (ix >= 0 && iy >= 0 && ix < SCREEN_W && iy < SCREEN_H) {
    const i = iy * SCREEN_W + ix;
    const id = idBuf[i];
    if (id > 0) {
      const o = frameDecals[id - 1];
      if (o && o.active && depthBuf[i] <= bestDist) {
        best = o;
        bestDist = depthBuf[i];
      }
    }
  }

  // 障害物（スプライト）：画面の傾きを戻した座標で比べる
  const cr = Math.cos(camRoll);
  const sr = Math.sin(camRoll);
  const ox = sx - SCREEN_W / 2;
  const oy = sy - SCREEN_H / 2;
  const ux = ox * cr + oy * sr + SCREEN_W / 2;
  const uy = -ox * sr + oy * cr + SCREEN_H / 2;
  frameSprites.forEach((s) => {
    if (!s.obj.active || s.dz > bestDist) return;
    if (ux >= s.x0 && ux <= s.x1 && uy >= s.y0 && uy <= s.y1) {
      best = s.obj;
      bestDist = s.dz;
    }
  });

  return best;
}

// 指定した正規化デバイス座標(NDC)に向けてスキャンを試みる。
// マウスクリックとゲームパッド（画面中央固定）の両方から呼ばれる。
function tryScan(ndcX, ndcY) {
  if (!isGameStarted || isPaused || isGameOver || countdown > 0) return false;

  const target = pickTarget(ndcX, ndcY);
  if (!target) return false;

  // コンボ判定：一定時間以内の連続発見で倍率アップ
  const now = performance.now();
  combo = now < comboExpire ? combo + 1 : 1;
  comboExpire = now + COMBO_WINDOW;
  maxCombo = Math.max(maxCombo, combo);
  const mult = Math.min(combo, COMBO_MAX_MULT);
  const gained = 100 * mult;

  score += gained;
  inspectedCount++;
  target.active = false;
  target.counted = true;
  recordCodex(target.type);
  AudioSys.playScan(mult);
  updateComboUI();

  // ---- 演出：ヒットストップ・フラッシュ・広がる輪・飛び出す数字・破片 ----
  hitStop = 0.05 + mult * 0.01;
  FX.flash("255,255,255", 0.25 + mult * 0.05);
  const popColor = mult >= 5 ? "#ff9a3c" : mult >= 3 ? "#ffe14d" : "#ffffff";
  let sp = null; // 対象の画面上の位置
  if (target.kind === "decal") {
    // 壁の異常：水色の枠で囲み、壁から光の粒をはじけさせる
    anomalyFound++;
    target.helper = true;
    const wx = Math.cos(target.ang) * (pipeRadius - 0.3);
    const wy = Math.sin(target.ang) * (pipeRadius - 0.3);
    FX.burst(wx, wy, target.z, ["#00e5ff", "#ffffff", "#ffe14d"], 18 + mult * 4, 8, 0.7);
    sp = project(wx, wy, target.z);
  } else {
    // 障害物：点検して取りのぞく（砕けて消える。当たり判定もなくなる）
    target.visible = false;
    FX.burst(target.x, target.y, target.z, HAZARD_COLORS[target.type], 36, 12, 0.9);
    AudioSys.playBreak();
    sp = project(target.x, target.y, target.z);
  }
  if (sp) {
    FX.ring(sp.x, sp.y, "#00e5ff");
    FX.pop(sp.x, sp.y, `+${gained}`, popColor);
  }

  // 短い通知（詳しい解説は結果画面の図鑑で読める）
  const info = ANOMALY_INFO[target.type];
  if (info) {
    showInfoCard(`${target.kind === "decal" ? "発見！" : "除去！"} ${info.name}`, "");
  }
  addLog(
    `SCAN OK: ${target.type.toUpperCase()} (+${gained}${mult > 1 ? ` / COMBO x${mult}` : ""})`,
  );
  updateUI();
  return true;
}

window.addEventListener("click", (event) => {
  if (!isGameStarted || isPaused || isGameOver) return;
  // ボタンやHUDパネル内のクリックは除外
  // （ボタン内の文字を押した場合もあるので closest で調べる）
  if (event.target.closest("button") || event.target.closest(".hud-panel"))
    return;

  tryScan(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
});

// UI更新
const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const inspectedEl = document.getElementById("inspected");
const distanceEl = document.getElementById("distance");
const hpBarEl = document.getElementById("hpBar");
const distBarEl = document.getElementById("distBar");
const sysStatusEl = document.getElementById("sysStatus");

function updateUI() {
  const safeHp = Math.max(0, Math.floor(hp));
  hpEl.innerText = `${safeHp}%`;
  hpBarEl.style.width = `${safeHp}%`;

  scoreEl.innerText = score;
  inspectedEl.innerText = `${anomalyFound} / ${anomalies.length}`;

  const progress = Math.min(100, (distance / goalDistance) * 100);
  distBarEl.style.width = `${progress}%`;
  distanceEl.innerText = `${Math.floor(distance)}m / ${goalDistance}m`;

  // HPに応じたシステムステータスの切り替え
  if (safeHp > 50) {
    sysStatusEl.innerText = "ONLINE";
    sysStatusEl.className = "value green-text animate-pulse";
  } else if (safeHp > 20) {
    sysStatusEl.innerText = "WARNING";
    sysStatusEl.className = "value yellow-text animate-pulse";
  } else {
    sysStatusEl.innerText = "CRITICAL";
    sysStatusEl.className = "value red-text animate-pulse";
  }
}

// ============================================================
// 点検レポート（クリア時）：発見率から技師ランクを認定
//   発見率 = 見つけた壁の異常 / 壁の異常の総数（障害物は分母に入れない）
//   しきい値はゲーム内の目安。実際に遊んで調整する
// ============================================================
const RANKS = [
  {
    min: 0.7,
    rank: "S",
    cls: "rank-S",
    title: "マスター点検技師",
    comment:
      "パーフェクトに近い点検！きみは未来のまちのインフラを守るエースだ！",
  },
  {
    min: 0.5,
    rank: "A",
    cls: "rank-A",
    title: "一人前の点検技師",
    comment: "すばらしい点検技術！本物の点検技師も顔負けだ！",
  },
  {
    min: 0.3,
    rank: "B",
    cls: "rank-B",
    title: "見習い点検技師",
    comment: "いい調子！見逃した異常を、もう一度探しに行ってみよう！",
  },
  {
    min: 0,
    rank: "C",
    cls: "rank-C",
    title: "点検研修生",
    comment: "まずは無事にゴールできてOK！次はもっと異常を見つけてみよう！",
  },
];

// ============================================================
// 土木PR演出：点検が守った暮らし（世帯数）
// 異常を1件見つけるごとに、その先の暮らしを守れたものとして換算する。
// ※実データではなくゲーム内の目安。画面にも注記を出している。
// ============================================================
const HOUSEHOLDS_PER_FIND = 8;

// 世帯数を実感しやすい身近なスケールに言い換える
function householdComment(n) {
  if (n <= 0) {
    return "異常を見つけると、その先の暮らしを守ることができるよ。次はきっと見つかる！";
  }
  const people = n * 2.2; // 1世帯あたり約2.2人として概算
  if (n < 40) {
    return `およそ ${Math.round(people)} 人ぶんの毎日の水まわりを、きみが守ったよ。`;
  }
  if (n < 150) {
    return `小学校ひとクラス〜1学年ぶんをこえる人数の暮らしを守ったよ。すごい！`;
  }
  if (n < 400) {
    return `小さな町内会まるごとの暮らしを、きみの点検が支えたよ！`;
  }
  return `${Math.round(people)} 人ぶん、小学校まるごとの暮らしを守り抜いた！文句なしのプロだ！`;
}

// 数字のカウントアップ演出
function animateCount(el, to, duration = 1200) {
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    // ease-out
    const eased = 1 - Math.pow(1 - t, 3);
    el.innerText = Math.round(to * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// 点検図鑑グリッドの描画
function renderCodex() {
  const grid = document.getElementById("codexGrid");
  if (!grid) return;
  grid.innerHTML = "";

  let discovered = 0;
  CODEX_ORDER.forEach((key) => {
    const info = ANOMALY_INFO[key];
    const total = codexSession[key];
    const thisRun = codexRun[key];
    const found = total > 0;
    if (found) discovered++;

    const cell = document.createElement("div");
    cell.className = `codex-cell${found ? " found" : ""}${thisRun > 0 ? " fresh" : ""}`;

    const icon = document.createElement("div");
    icon.className = "codex-icon";
    icon.innerText = found ? info.icon : "？";
    cell.appendChild(icon);

    const name = document.createElement("div");
    name.className = "codex-name";
    name.innerText = found ? info.short : "？？？";
    cell.appendChild(name);

    const count = document.createElement("div");
    count.className = "codex-count";
    count.innerText = found ? `累計 ${total} 件` : "みはっけん";
    cell.appendChild(count);

    if (thisRun > 0) {
      const badge = document.createElement("div");
      badge.className = "codex-new";
      badge.innerText = `+${thisRun}`;
      cell.appendChild(badge);
    }

    // 発見済みなら解説をツールチップとして持たせる
    if (found) cell.title = info.desc;

    grid.appendChild(cell);
  });

  const prog = document.getElementById("codexProgress");
  if (prog) prog.innerText = `${discovered} / ${CODEX_ORDER.length} 種類`;

  const hint = document.getElementById("codexHint");
  if (hint) {
    if (discovered >= CODEX_ORDER.length) {
      hint.innerText = "★ 図鑑コンプリート！6種類すべての異常を見つけたよ！";
      hint.className = "codex-hint complete";
    } else {
      hint.innerText = `あと ${CODEX_ORDER.length - discovered} 種類でコンプリート！もう一度もぐって探そう！`;
      hint.className = "codex-hint";
    }
  }
}

function showClearScreen() {
  updatePauseBtn();
  resultShown = true;
  const rate = anomalies.length > 0 ? anomalyFound / anomalies.length : 0;
  const r = RANKS.find((x) => rate >= x.min);

  const badge = document.getElementById("rankBadge");
  badge.innerText = r.rank;
  badge.className = `rank-badge ${r.cls}`;
  document.getElementById("rankTitle").innerText = `認定: ${r.title}`;
  document.getElementById("rankComment").innerText = r.comment;

  document.getElementById("finalFound").innerText =
    `${anomalyFound} / ${anomalies.length} 件`;
  document.getElementById("finalMissed").innerText = `${missedCount} 件`;
  document.getElementById("finalRate").innerText = `${Math.round(rate * 100)}%`;
  document.getElementById("finalCombo").innerText = `×${Math.max(1, maxCombo)}`;
  document.getElementById("finalScore").innerText = score;
  document.getElementById("finalHp").innerText =
    `${Math.max(0, Math.floor(hp))}%`;

  // 土木PR: 守った暮らし（世帯数）
  const households = inspectedCount * HOUSEHOLDS_PER_FIND;
  const noteEl = document.getElementById("impactNote");
  if (noteEl) noteEl.innerText = householdComment(households);
  animateCount(document.getElementById("impactHouseholds"), households);

  // 土木PR: 点検図鑑
  renderCodex();

  // 土木PR: 豆知識（プレイ中はテンポを優先して出さず、結果画面で1つ読んでもらう）
  const triviaEl = document.getElementById("resultTrivia");
  if (triviaEl) {
    triviaEl.innerText = `【土木マメ知識】${TRIVIA[triviaIdx % TRIVIA.length]}`;
    triviaIdx++;
  }

  const clearScreen = document.getElementById("clearScreen");
  if (clearScreen) {
    clearScreen.style.display = "flex";
    clearScreen.offsetHeight;
    clearScreen.style.opacity = 1;
  }
}

// ============================================================
// レティクルのターゲットロック表示
// 画面中央に点検対象を捉えているとレティクルが黄色く光る。
// ゲームパッド操作では照準が中央固定になるため、これが唯一の狙いの手がかりになる。
// ============================================================
const reticleEl = document.querySelector(".reticle");
let lockedTarget = null;
let lockCheckAccum = 0;

function updateTargetLock(delta) {
  // 約20回/秒に間引く
  lockCheckAccum += delta;
  if (lockCheckAccum < 0.05) return;
  lockCheckAccum = 0;

  const found = pickTarget(0, 0);
  if (found !== lockedTarget) {
    lockedTarget = found;
    if (reticleEl) reticleEl.classList.toggle("locked", !!found);
  }
}

// 通過済みオブジェクトの見逃し判定
// 見逃しに数えるのは壁の異常だけ（障害物は上手に避ければOK）
function checkPassedObjects() {
  hazards.concat(anomalies).forEach((o) => {
    if (!o.counted && o.z > cam.z + 6) {
      o.counted = true;
      if (o.active && o.kind === "decal") missedCount++;
    }
  });
}

// ドローン（1x1x1の箱）と障害物の箱が重なっているか
function hitsBox(b) {
  return (
    cam.x + 0.5 > b.x0 &&
    cam.x - 0.5 < b.x1 &&
    cam.y + 0.5 > b.y0 &&
    cam.y - 0.5 < b.y1 &&
    cam.z + 0.5 > b.z0 &&
    cam.z - 0.5 < b.z1
  );
}

// 障害物ごとの破片の色
const HAZARD_COLORS = {
  leak: ["#8fd8ff", "#33aaff", "#e0f6ff"],
  sediment: ["#5c4033", "#8a6a4a", "#735238", "#8a7a6a"],
  roots: ["#6b4423", "#8a5a30", "#a07a50"],
};

// ------------------------------------------------------------
// カウントダウン（3・2・1・GO!）
// ------------------------------------------------------------
function updateCountdown(dt) {
  const before = Math.ceil(countdown);
  countdown -= dt;
  const after = Math.ceil(countdown);
  if (countdown <= 0) {
    countdown = 0;
    FX.showBanner("GO!", null, "rainbow", 0.8, 5);
    AudioSys.playBeep(true);
    Music.start();
    addLog("DRONE LAUNCHED: INSPECTION START");
  } else if (after !== before) {
    FX.showBanner(String(after), null, "#ffffff", 0.9, 7);
    AudioSys.playBeep(false);
  }
}

// ------------------------------------------------------------
// ゴール演出：天井のマンホールへ上昇 → 白く光る → 地上の街
// ------------------------------------------------------------
// HUD（左右のパネル・照準・ログ）の表示切り替え
function setHudVisible(on) {
  ["hud", "logArea"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = on ? "" : "0";
  });
}

function startGoal() {
  isGameOver = true; // これ以降は操作・点検・ポーズを受け付けない
  goalAnim = 0;
  updatePauseBtn();
  Music.stop();
  if (reticleEl) reticleEl.classList.remove("locked");
}

function updateGoal(dt) {
  goalAnim += dt;
  if (cityStart < 0) {
    // 前へ進みながら上昇し、上を見上げる
    cam.z -= 90 * dt;
    cam.y = Math.min(pipeRadius - 1.5, cam.y + 12 * dt);
    camPitch += (0.45 - camPitch) * Math.min(1, dt * 4);
    if (goalAnim > 0.45) FX.flash("255,255,255", (goalAnim - 0.45) * 2.2);
    if (goalAnim > 0.9) {
      cityStart = performance.now();
      setHudVisible(false); // 地上の場面では HUD を消して街とドローンを見せる
      hideInfoCard();
      FX.flashA = 1;
      FX.lines.length = 0;
      AudioSys.setDrone(false);
      AudioSys.playClear();
    }
  } else if (!resultShown && goalAnim > 2.6) {
    showClearScreen();
  }
}

// ------------------------------------------------------------
// 墜落：爆発させてから、少し間をおいてゲームオーバー画面を出す
// ------------------------------------------------------------
function crashDrone() {
  isGameOver = true;
  updatePauseBtn();
  Music.stop();
  AudioSys.setDrone(false);
  AudioSys.playExplode();
  FX.burst(cam.x, cam.y, cam.z, ["#ffd84a", "#ff7a33", "#ff3344", "#ffffff", "#555a60"], 70, 16, 1.2);
  FX.flash("255,120,60", 0.9);
  FX.crack();
  FX.crack();
  shakeIntensity = 1.2;
  hurtBlink = 0;
  gameOverDelay = 1.0;
  droneVisible = false; // 爆発したので機体は描かない
}

function showGameOverScreen() {
  resultShown = true;
  document.getElementById("failDistance").innerText = `${Math.floor(distance)}m`;
  document.getElementById("failScore").innerText = score;

  // 墜落しても、それまでの点検成果は無駄ではないことを伝える（土木PR）
  const salvageEl = document.getElementById("failSalvage");
  if (salvageEl) {
    const households = anomalyFound * HOUSEHOLDS_PER_FIND;
    salvageEl.innerText =
      anomalyFound > 0
        ? `でも、ここまでに見つけた ${anomalyFound} 件の異常のおかげで、およそ ${households} 世帯の暮らしを守れたよ。`
        : "異常を1件でも見つけられれば、その先の暮らしを守ることができる。次はきっと見つかる！";
  }

  const gameOverScreen = document.getElementById("gameOverScreen");
  if (gameOverScreen) {
    gameOverScreen.style.display = "flex";
    gameOverScreen.offsetHeight;
    gameOverScreen.style.opacity = 1;
  }
}

// ------------------------------------------------------------
// 区間（ゾーン）と増水イベントの進行
// ------------------------------------------------------------
function updateCourseEvents() {
  // 区間の切り替え
  const zi = Math.min(ZONES.length - 1, Math.floor(distance / 100));
  if (zi !== currentZone) {
    currentZone = zi;
    const z = ZONES[zi];
    FX.showBanner(z.name, z.sub, "#ffe14d", 1.8, 3);
    AudioSys.playZone();
    showInfoCard(z.jp, z.desc || "", "", 2600);
    addLog(`ENTERING ${z.name}: ${z.sub}`);
  }

  // 増水：警報 → 水位の上下
  if (!floodWarned && distance >= FLOOD_WARN_AT) {
    floodWarned = true;
    sirenTime = 3.2;
    FX.showBanner("WARNING!", "HEAVY RAIN", "#ff4d6d", 2.2, 3);
    AudioSys.playSiren();
    showInfoCard("大雨警報！ 水位が上がってくるぞ！", "水にふれるとダメージ！ 上へにげよう！", "", 3000);
    addLog("ALERT: HEAVY RAIN - WATER LEVEL RISING", "danger");
  }
  floodK = floodAmountAt(distance);
  waterLevel = WATER_BASE + floodK * FLOOD_RISE;
  Music.intense = floodK > 0.05;
}

// メインループ
let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  // 経過秒（フレームレートが変わっても同じ速さで進むように、移動量はすべてこれを掛ける）
  const nowTime = performance.now();
  const dt = Math.min(0.05, (nowTime - lastFrameTime) / 1000);
  lastFrameTime = nowTime;
  const f60 = dt * 60; // 60fps 換算で何フレーム分か

  // ゲームパッドはタイトル・ポーズ・リザルト画面でも操作できるよう常にポーリングする
  Pad.poll();

  // 一時停止状態（演出も止める）
  if (isPaused) {
    renderFrame();
    return;
  }

  // ゴール演出中
  if (goalAnim >= 0) {
    updateGoal(dt);
    FX.update(dt, 0);
    renderFrame();
    return;
  }

  // 墜落後・リザルト表示中
  if (isGameOver) {
    if (gameOverDelay > 0) {
      gameOverDelay -= dt;
      if (gameOverDelay <= 0) showGameOverScreen();
    }
    FX.update(dt, 0);
    let sx = 0;
    let sy = 0;
    if (shakeIntensity > 0) {
      sx = (Math.random() - 0.5) * shakeIntensity;
      sy = (Math.random() - 0.5) * shakeIntensity;
      shakeIntensity *= Math.pow(0.9, f60);
    }
    renderFrame(sx, sy);
    return;
  }

  // 開始前の待機状態（ホバリング演出）
  if (!isGameStarted || countdown > 0) {
    cam.y = Math.sin(Date.now() * 0.002) * 0.15;
    cam.x = Math.cos(Date.now() * 0.0015) * 0.15;
    if (countdown > 0) updateCountdown(dt);
    FX.update(dt, 0);
    renderFrame();
    return;
  }

  // ヒットストップ：一瞬だけ時間を止めて「当たった！」を強調する
  if (hitStop > 0) {
    hitStop -= dt;
    FX.flashA = Math.max(0, FX.flashA - dt * 2);
    renderFrame();
    return;
  }

  // 進行処理（奥へ進むほど少しずつ加速する。増水中は流れに押されてさらに速い）
  const speedPerFrame = baseSpeed + (distance / goalDistance) * 0.6;
  const speed = speedPerFrame * 60 * (1 + floodK * 0.25); // 1秒あたり
  cam.z -= speed * dt;
  distance = Math.abs(cam.z) / zToMeterRatio;
  speedFactor = Math.min(1, (speed / 60 - baseSpeed) / 0.8 + 0.25);

  // スピードに応じて視野を広げる（ワープ感）
  focal = BASE_FOCAL * (1 - 0.16 * speedFactor);

  // ゴール判定
  if (distance >= goalDistance) {
    updateUI();
    startGoal();
    return;
  }

  updateCourseEvents();

  // プレイヤー移動処理（キーボードとゲームパッドの両対応）
  const moveSpeed = 0.25 * 60; // 1秒あたり
  let inputX = 0;
  let inputY = 0;
  if (keys.ArrowUp || keys.w) inputY += 1;
  if (keys.ArrowDown || keys.s) inputY -= 1;
  if (keys.ArrowLeft || keys.a) inputX -= 1;
  if (keys.ArrowRight || keys.d) inputX += 1;

  // ゲームパッドのアナログ入力を合成（キーボード入力がない軸のみ採用）
  if (Pad.connected) {
    if (inputX === 0) inputX = Pad.axisX;
    if (inputY === 0) inputY = Pad.axisY;
  }

  // 斜め移動が速くなりすぎないよう正規化
  const inputLen = Math.hypot(inputX, inputY);
  if (inputLen > 1) {
    inputX /= inputLen;
    inputY /= inputLen;
  }

  cam.x += inputX * moveSpeed * dt;
  cam.y += inputY * moveSpeed * dt;

  // カーブの遠心力：曲がる向きと反対へ押し流される（ハンドル操作が必要になる）
  const curv = courseCurvature(cam.z);
  const v2 = speed * speed;
  cam.x -= curv.x * v2 * 0.08 * dt;
  cam.y -= curv.y * v2 * 0.08 * dt;

  // レティクルのターゲットロック判定
  updateTargetLock(dt);

  // 移動方向とカーブに応じて機体とカメラを傾ける（ロール・ピッチ演出）
  const lerp = 1 - Math.pow(1 - 0.08, f60);
  const bankTarget = -inputX * 0.1 - curv.x * v2 * 0.003;
  camRoll += (bankTarget - camRoll) * lerp;
  camPitch += (inputY * 0.05 - camPitch) * lerp;
  droneBank += (-inputX * 0.35 - droneBank) * (1 - Math.pow(1 - 0.2, f60));
  hurtBlink = Math.max(0, hurtBlink - dt);
  sirenTime = Math.max(0, sirenTime - dt);

  // ドローンの噴射の粒（後ろへ流れてスピード感を出す）
  if (Math.random() < f60 * 0.6) {
    FX.mote(
      cam.x + (Math.random() - 0.5) * 1.2,
      cam.y - 0.2,
      cam.z + 0.5,
      (Math.random() - 0.5) * 2,
      -1,
      speed * 0.35,
      Math.random() < 0.5 ? "#8fe8ff" : "#ffffff",
      0.25,
      0.15,
    );
  }

  // 増水中の雨だれ（天井から落ちてくる水）
  if (floodK > 0 && Math.random() < f60 * floodK * 1.5) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 2;
    FX.mote(
      Math.cos(a) * (pipeRadius - 0.5),
      Math.sin(a) * (pipeRadius - 0.5),
      cam.z - 20 - Math.random() * 60,
      0,
      -18,
      0,
      "#9fd4ff",
      1.2,
      0.18,
    );
  }

  // 壁との衝突判定
  const distFromCenter = Math.sqrt(cam.x ** 2 + cam.y ** 2);
  if (distFromCenter > pipeRadius - 1) {
    hp -= 30 * dt; // 壁接触ダメージ（持続）
    shakeIntensity = Math.min(0.2, shakeIntensity + 1.8 * dt); // 壁接触時は微小な画面ブレ
    // 壁の外に出ないように押し戻す
    const push = Math.pow(0.95, f60);
    cam.x *= push;
    cam.y *= push;

    // 火花
    if (Math.random() < f60 * 0.5) {
      FX.burst(cam.x * 1.05, cam.y * 1.05, cam.z, ["#ffe14d", "#ffffff", "#ff9a3c"], 3, 6, 0.3);
    }
    // ログ表示と接触音を間引いて出力
    if (Math.random() < f60 * 0.1) AudioSys.playScrape();
    if (Math.random() < f60 * 0.05) {
      addLog("SYS WARNING: HULL CONTACT DETECTED", "warning");
    }
  }

  // 水面との接触判定（増水中に下を飛ぶとダメージ）
  if (cam.y - 0.5 < waterLevel) {
    hp -= 20 * dt;
    shakeIntensity = Math.min(0.25, shakeIntensity + 1.8 * dt);
    if (Math.random() < f60 * 0.6) {
      FX.burst(cam.x, waterLevel, cam.z - 1, ["#9fd4ff", "#e0f6ff", "#6d8f7a"], 4, 7, 0.5);
    }
    if (Math.random() < f60 * 0.06) AudioSys.playSplash();
    if (Math.random() < f60 * 0.04) addLog("SYS WARNING: WATER CONTACT", "warning");
  }

  // オブジェクトとの衝突判定
  hazards.forEach((h) => {
    if (h.active && hitsBox(h.box)) {
      hp -= 15;
      shakeIntensity = 0.9; // 障害物衝突時は大きな画面ブレ
      hitStop = 0.1;
      hurtBlink = 0.7;
      h.active = false;
      h.counted = true;
      collidedCount++;
      h.visible = false;
      AudioSys.playDamage();
      FX.flash("255,40,40", 0.55);
      FX.crack();
      FX.burst(cam.x, cam.y, cam.z - 1, HAZARD_COLORS[h.type], 30, 10, 0.9);
      combo = 0; // ぶつかるとコンボが切れる
      updateComboUI();

      if (h.type === "sediment") {
        addLog("SYS DANGER: SEDIMENT COLLISION DETECTED (-15%)", "danger");
      } else if (h.type === "roots") {
        addLog("SYS DANGER: TREE ROOT COLLISION DETECTED (-15%)", "danger");
      } else {
        addLog("SYS DANGER: LEAK COLLISION DETECTED (-15%)", "danger");
      }
    }
  });

  // マンホール整備ポイント（チェックポイント）の通過判定
  manholes.forEach((m) => {
    if (!m.passed && cam.z < m.z) {
      m.passed = true;
      hp = Math.min(100, hp + 15);
      AudioSys.playCheckpoint();
      FX.showBanner("CHECKPOINT!", "HP +15", "#6dff7a", 1.5, 2);
      FX.flash("255,240,180", 0.35);
      addLog("MAINTENANCE POINT: INTEGRITY +15%");
      showInfoCard("チェックポイント！ 体力+15%", "", "trivia", 1800);
    }
  });

  // 見逃し（スキャンせず通過）のカウント
  checkPassedObjects();

  // コンボの時間切れ判定
  if (combo > 0 && performance.now() > comboExpire) {
    combo = 0;
    updateComboUI();
  }

  FX.update(dt, speedFactor);

  // 墜落判定
  if (hp <= 0) {
    updateUI();
    crashDrone();
    return;
  }

  updateUI();

  // 画面ブレ（描画用のカメラ位置だけ一時的にずらす）
  let shakeX = 0;
  let shakeY = 0;
  if (shakeIntensity > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity;
    shakeY = (Math.random() - 0.5) * shakeIntensity;
  }

  renderFrame(shakeX, shakeY);

  // 画面ブレの減衰
  if (shakeIntensity > 0) {
    shakeIntensity *= Math.pow(0.85, f60);
    if (shakeIntensity < 0.01) {
      shakeIntensity = 0;
    }
  }
}

// リサイズ対応（縦横比が変わったら画面バッファを作り直す）
window.addEventListener("resize", setupScreen);

// ゲーム開始
animate();
