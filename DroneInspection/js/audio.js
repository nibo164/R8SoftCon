// ============================================================
// js/audio.js — 効果音（AudioSys）と BGM（Music）。Web Audio で合成する
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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
    // スローモーション中に音をこもらせるフィルター（ふだんは素通し）
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle);
    this.muffle.connect(this.ctx.destination);

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
  // スローモーション中は音をこもらせる
  setMuffle(on) {
    if (!this.muffle) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, t);
    this.muffle.frequency.exponentialRampToValueAtTime(on ? 700 : 20000, t + 0.15);
  },
  // QTE 開始（時間がゆっくりになる「ヒュウン」）
  playQteStart() {
    this.tone(900, 180, 0.35, "sine", 0.18);
  },
  // 撮影成功（シャッター音）。PERFECT は高い音を重ねる
  playShutter(perfect) {
    this.noise(0.05, 5000, 0.35);
    this.tone(perfect ? 1760 : 1320, perfect ? 2640 : 1320, perfect ? 0.25 : 0.12, "square", 0.12, 0.04);
  },
  // QTE 失敗
  playQteMiss() {
    this.tone(220, 110, 0.3, "square", 0.18);
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

