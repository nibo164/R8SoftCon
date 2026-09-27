// ============================================================
// js/audio.js — 効果音（AudioSys）と BGM（Music）。Web Audio で合成する
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
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
//   URL に ?bgm=b をつけると、ファイルの最後にある別の曲（B案：ハードテクノ）を鳴らす
// ============================================================
const Music = {
  gain: null,
  noiseBuf: null,
  timer: null,
  on: false,
  intense: false,
  step: 0,
  nextTime: 0,
  // "a" = チップチューン（今までの曲） / "b" = ハードテクノ（聴きくらべ用）
  variant: (() => {
    try {
      return new URLSearchParams(location.search).get("bgm") === "b" ? "b" : "a";
    } catch (e) {
      return "a";
    }
  })(),
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
    if (this.variant === "b") this.setupB();
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
    if (this.variant === "b") this.setDelayTimeB(d16);
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
    if (this.variant === "b") return this.playStepB(step, t, d16);
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
// BGM の B案（?bgm=b のときだけ使う）：地下トンネルを突き進むハードテクノ
//   4つ打ちの歪んだキック＋キックの合間を転がるベース（ローリングベース）、ホ短調
//   キックが鳴るたびに他の音を一瞬下げる（サイドチェイン）ので、曲全体が「うねる」
//   残響（リバーブ）と反響（ディレイ）で、管の中で音が響いている感じを出す
//   構成：イントロ 8小節 →［メイン 8 → ブレイク 8 → ドライブ 8］をくり返す
//   増水中・ボス戦（intense）はドライブ固定で、16分のハイハットと速いアルペジオを重ねる
// ============================================================
Object.assign(Music, {
  // 8小節の和音（Em Em C D Em Em F D。F は半音上の暗い和音）と、ベースの根音（MIDI）
  B_CHORDS: [
    [52, 55, 59, 62],
    [52, 55, 59, 62],
    [48, 52, 55, 59],
    [50, 54, 57, 62],
    [52, 55, 59, 62],
    [52, 55, 59, 62],
    [53, 57, 60, 64],
    [50, 54, 57, 62],
  ],
  B_ROOTS: [40, 40, 36, 38, 40, 40, 41, 38],
  // リード（2小節 = 32ステップ）。[ステップ, MIDI, 長さ（16分音符いくつ分）]
  B_LEAD_MAIN: [
    [0, 64, 2], [3, 64, 1], [4, 67, 2], [6, 64, 1], [8, 71, 2], [10, 69, 2], [12, 67, 1], [14, 62, 2],
    [16, 64, 2], [19, 64, 1], [20, 67, 2], [22, 69, 1], [24, 71, 3], [27, 74, 1], [28, 72, 2], [30, 71, 2],
  ],
  B_LEAD_DRIVE: [
    [0, 76, 2], [2, 74, 1], [3, 76, 1], [4, 79, 2], [6, 76, 1], [7, 74, 1], [8, 71, 2], [10, 74, 2],
    [12, 72, 1], [13, 71, 1], [14, 69, 2],
    [16, 76, 2], [18, 74, 1], [19, 76, 1], [20, 79, 2], [22, 81, 1], [23, 79, 1], [24, 83, 4],
    [28, 81, 2], [30, 79, 2],
  ],
  B_ARP: [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2],
  B_VOLUME: 0.45, // B案全体の音量（大きすぎ・小さすぎのときはここを変える）

  mtof(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  },

  // ゆるやかに歪ませるカーブ（tanh）。k が大きいほど強く歪む
  driveCurve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return c;
  },

  setupB() {
    const ctx = AudioSys.ctx;
    // 最後に全体をまとめて潰し、音量をそろえる（コンプレッサー）
    this.bComp = ctx.createDynamicsCompressor();
    this.bComp.threshold.value = -16;
    this.bComp.knee.value = 8;
    this.bComp.ratio.value = 5;
    this.bComp.attack.value = 0.003;
    this.bComp.release.value = 0.16;
    const out = ctx.createGain();
    out.gain.value = this.B_VOLUME;
    this.bComp.connect(out);
    out.connect(this.gain);

    // ドラムはそのまま、それ以外はサイドチェインで下げる（bDuck）
    this.bDrums = ctx.createGain();
    this.bDrums.connect(this.bComp);
    this.bDuck = ctx.createGain();
    this.bDuck.connect(this.bComp);

    // 残響：減衰するノイズを「響き方」として使う（左右で別のノイズにして広がりを出す）
    const sr = ctx.sampleRate;
    const irLen = Math.floor(sr * 2.4);
    const ir = ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
    }
    this.bVerbIn = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.6;
    this.bVerbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(this.bDuck);

    // 反響：付点8分音符おくれでくり返す。くり返すたびに高い音を削る
    this.bDelayIn = ctx.createGain();
    this.bDelay = ctx.createDelay(1.0);
    this.bDelay.delayTime.value = 0.3;
    this.bDelayD16 = 0;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = "lowpass";
    fbFilter.frequency.value = 2600;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.55;
    this.bDelayIn.connect(this.bDelay);
    this.bDelay.connect(fbFilter);
    fbFilter.connect(fb);
    fb.connect(this.bDelay);
    this.bDelay.connect(delayOut);
    delayOut.connect(this.bDuck);

    // 楽器ごとの入口（そのまま出す量・残響・反響・左右・歪み）
    this.bCh = {
      kick: this.channelB(this.bDrums, 0.85, 0.04, 0, 0, 3.5),
      hat: this.channelB(this.bDrums, 0.8, 0.12, 0, 0.22, 0),
      clap: this.channelB(this.bDrums, 0.8, 0.5, 0, 0, 0),
      crash: this.channelB(this.bDrums, 0.7, 0.55, 0, 0, 0),
      bass: this.channelB(this.bDuck, 0.9, 0, 0, 0, 2.5),
      pad: this.channelB(this.bDuck, 0.6, 0.9, 0, 0, 0),
      lead: this.channelB(this.bDuck, 0.75, 0.3, 0.32, 0, 1.2),
      arp: this.channelB(this.bDuck, 0.6, 0.35, 0.5, -0.25, 0),
      riser: this.channelB(this.bDrums, 0.6, 0.5, 0, 0, 0),
    };

    // シンバルやうねりに使う長いノイズ
    const len = Math.floor(sr * 2);
    this.bLongNoise = ctx.createBuffer(1, len, sr);
    const d = this.bLongNoise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.bLastIntense = false;
  },

  channelB(dest, dry, verb, delay, pan, drive) {
    const ctx = AudioSys.ctx;
    const input = ctx.createGain();
    let node = input;
    if (drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.driveCurve(drive);
      ws.oversample = "2x";
      node.connect(ws);
      node = ws;
    }
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      node = p;
    }
    const g = ctx.createGain();
    g.gain.value = dry;
    node.connect(g);
    g.connect(dest);
    if (verb) {
      const s = ctx.createGain();
      s.gain.value = verb;
      node.connect(s);
      s.connect(this.bVerbIn);
    }
    if (delay) {
      const s = ctx.createGain();
      s.gain.value = delay;
      node.connect(s);
      s.connect(this.bDelayIn);
    }
    return input;
  },

  // テンポが変わったら反響の間隔も合わせる
  setDelayTimeB(d16) {
    if (!this.bDelay || this.bDelayD16 === d16) return;
    this.bDelayD16 = d16;
    this.bDelay.delayTime.setTargetAtTime(d16 * 3, AudioSys.ctx.currentTime, 0.05);
  },

  // 何小節目がどの部分か（イントロは最初の1回だけ）
  sectionB(bar) {
    if (bar < 8) return ["intro", bar];
    const k = Math.floor((bar - 8) / 8) % 3;
    return [["main", "break", "drive"][k], (bar - 8) % 8];
  },

  playStepB(step, t, d16) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    let [sec, sb] = this.sectionB(bar);
    if (step === 0) this.bLastIntense = false;
    if (this.intense) sec = "drive";
    const chord = this.B_CHORDS[bar % 8];
    const root = this.B_ROOTS[bar % 8];
    const barLen = d16 * 16;

    // 盛り上がる所に入った瞬間にシンバル
    if (this.intense !== this.bLastIntense) {
      if (this.intense) this.crashB(t);
      this.bLastIntense = this.intense;
    } else if (s === 0 && sb === 0 && bar > 0 && sec !== "break") {
      this.crashB(t);
    }

    // キック（ブレイクの前半は抜き、後半は1拍目だけ、最後の2小節は無し）
    let kick = s % 4 === 0;
    if (sec === "intro" && sb < 4) kick = false;
    if (sec === "break") kick = sb >= 4 && sb < 6 && s === 0;
    if (kick) this.kickB(t);

    // ハイハット
    if (sec !== "break" && !(sec === "intro" && sb < 4)) {
      if (s % 4 === 2) this.hatB(t, sec === "drive", 0.22);
      else if (sec !== "intro" && (s % 2 === 1 || this.intense)) this.hatB(t, false, 0.07);
    }

    // クラップ（2拍目と4拍目）
    if ((sec === "main" || sec === "drive") && (s === 4 || s === 12)) this.clapB(t, 0.5);

    // フィル：イントロ最後の小節と、ブレイク最後の2小節はスネアを連打して盛り上げる
    if (sec === "intro" && sb === 7 && s >= 8) this.clapB(t, 0.15 + (s - 8) * 0.03);
    if (sec === "break" && sb === 6 && s % 4 === 0) this.clapB(t, 0.18);
    if (sec === "break" && sb === 7 && (s < 8 ? s % 2 === 0 : true)) this.clapB(t, 0.12 + s * 0.02);
    if (sec === "break" && sb === 6 && s === 0) this.riserB(t, barLen * 2);

    // ローリングベース（キックの合間の16分音符3つ）。部分ごとにフィルターの開き方を変える
    if (sec !== "break" && s % 4 !== 0) {
      const cut =
        sec === "intro" ? 250 + sb * 110 : sec === "main" ? 900 : this.intense ? 2000 : 1500;
      const oct = sec === "drive" && s % 8 === 7 ? 12 : 0;
      this.bassB(root + oct, t, d16 * 0.85, cut);
    }

    // パッド（和音を1小節のばす）
    if (s === 0) {
      const vol = sec === "break" ? 0.1 : sec === "intro" ? 0.075 : 0.05;
      this.padB(chord, t, barLen, vol, sec === "drive" ? 2400 : 1500);
    }

    // リード
    if (sec === "main" || sec === "drive") {
      const pat = sec === "main" ? this.B_LEAD_MAIN : this.B_LEAD_DRIVE;
      const pos = (bar % 2) * 16 + s;
      for (const [p, m, len] of pat) {
        if (p === pos) this.leadB(m, t, d16 * len * 0.92, sec === "main" ? 0.12 : 0.13);
      }
    }

    // アルペジオ：ブレイクでは主役、増水中は速い16分を重ねて緊張感を出す
    if (sec === "break") {
      const i = this.B_ARP[(s + bar * 5) % 16];
      this.arpB(chord[i] + 12, t, 0.13);
    } else if (this.intense) {
      this.arpB(chord[s % 4] + 24, t, 0.05);
    }
  },

  // --- 楽器 ---

  kickB(t) {
    const ctx = AudioSys.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    g.gain.setValueAtTime(1, t);
    g.gain.setTargetAtTime(0.0001, t + 0.05, 0.07);
    o.connect(g);
    g.connect(this.bCh.kick);
    o.start(t);
    o.stop(t + 0.45);
    // アタックの「カチッ」（スマホのスピーカーでもキックが聞こえるように）
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 2500;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.35, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    src.connect(f);
    f.connect(cg);
    cg.connect(this.bCh.kick);
    src.start(t);
    src.stop(t + 0.03);
    // サイドチェイン：キックの瞬間に他の音を下げ、次の拍までに戻す
    const dg = this.bDuck.gain;
    dg.setValueAtTime(0.3, t);
    dg.linearRampToValueAtTime(1, t + 0.2);
  },

  hatB(t, open, vol) {
    const ctx = AudioSys.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = open ? 6500 : 8000;
    const g = ctx.createGain();
    const dur = open ? 0.16 : 0.035;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.bCh.hat);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  // 手拍子（ノイズを3回すばやく鳴らしてから余韻）＋胴鳴り
  clapB(t, vol) {
    const ctx = AudioSys.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1700;
    f.Q.value = 1.1;
    const g = ctx.createGain();
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(vol, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(vol * 0.15, t + i * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(vol, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(f);
    f.connect(g);
    g.connect(this.bCh.clap);
    src.start(t);
    src.stop(t + 0.22);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    og.gain.setValueAtTime(vol * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og);
    og.connect(this.bCh.clap);
    o.start(t);
    o.stop(t + 0.1);
  },

  crashB(t) {
    const ctx = AudioSys.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bLongNoise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 4200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
    src.connect(f);
    f.connect(g);
    g.connect(this.bCh.crash);
    src.start(t);
    src.stop(t + 1.8);
  },

  // ブレイクの終わりに向けて「シュワーッ」と上がっていくノイズ
  riserB(t, dur) {
    const ctx = AudioSys.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bLongNoise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.01, t);
    g.gain.linearRampToValueAtTime(0.3, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(f);
    f.connect(g);
    g.connect(this.bCh.riser);
    src.start(t);
    src.stop(t + dur + 0.05);
  },

  // ベース：少しずらした2つの波を、音の頭だけ開くフィルターに通して歪ませる。下に1オクターブ低いサイン波
  bassB(m, t, dur, cut) {
    const ctx = AudioSys.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 7;
    f.frequency.setValueAtTime(cut * 2.6, t);
    f.frequency.exponentialRampToValueAtTime(cut, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    f.connect(g);
    g.connect(this.bCh.bass);
    const freq = this.mtof(m);
    [
      ["sawtooth", 0],
      ["square", 10],
    ].forEach(([type, det]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.frequency.value = freq / 2;
    sg.gain.setValueAtTime(0.28, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    sub.connect(sg);
    sg.connect(this.bCh.bass);
    sub.start(t);
    sub.stop(t + dur + 0.02);
  },

  // パッド：和音の1音ごとに少しずらしたノコギリ波を2つ重ね、ゆっくり立ち上げる
  padB(chord, t, dur, vol, cut) {
    const ctx = AudioSys.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    f.connect(g);
    g.connect(this.bCh.pad);
    chord.forEach((m) => {
      [-9, 9].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = this.mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.35);
      });
    });
  },

  // リード：ノコギリ波＋矩形波。音の頭でフィルターを開いて「ギャン」と鳴らす
  leadB(m, t, dur, vol) {
    const ctx = AudioSys.ctx;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(5500, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + Math.max(0.12, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vol * 0.55, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
    f.connect(g);
    g.connect(this.bCh.lead);
    const freq = this.mtof(m);
    [
      ["sawtooth", -7],
      ["square", 7],
    ].forEach(([type, det]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  },

  // アルペジオ：はじくような短い音（反響で音が管に広がる）
  arpB(m, t, vol) {
    const ctx = AudioSys.ctx;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = this.mtof(m);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(f);
    f.connect(g);
    g.connect(this.bCh.arp);
    o.start(t);
    o.stop(t + 0.24);
  },
});

