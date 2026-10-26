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
  // "b" = 重厚な効果音（ふだんはこちら。ファイルの最後で差し替える） / "a" = 前の効果音（URL に ?sfx=a。聴きくらべ用）
  sfxVariant: (() => {
    try {
      return new URLSearchParams(location.search).get("sfx") === "a" ? "a" : "b";
    } catch (e) {
      return "b";
    }
  })(),

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

    // ドローンのプロペラ音（近い周波数の2つの波でうなりを作る）。波は飛んでいる間だけ作る（setDrone）
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 240;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.master);
    this.droneOscs = null;
    if (this.initB) this.initB();
  },

  resume() {
    if (this.ctx && this.ctx.state === "suspended" && !document.hidden) this.ctx.resume();
  },

  // プロペラ音の波を作って鳴らしはじめる（効果音の B案は高い「ウィーン」も足す）
  makeDrone() {
    const oscs = [64, 66.5].map((f) => {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
      return o;
    });
    if (this.droneExtraB) oscs.push(...this.droneExtraB());
    return oscs;
  },

  // プロペラ音のON/OFF（飛行中のみ鳴らす）。止めるときは波ごと止めて、計算を減らす
  setDrone(on) {
    if (!this.droneGain) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.cancelScheduledValues(t);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
    this.droneGain.gain.linearRampToValueAtTime(on ? 0.08 : 0, t + 0.3);
    if (on && !this.droneOscs) {
      this.droneOscs = this.makeDrone();
    } else if (!on && this.droneOscs) {
      this.droneOscs.forEach((o) => o.stop(t + 0.35));
      this.droneOscs = null;
    }
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


// ほかのアプリに切り替えたときや画面を消したときは、音の処理ごと止める（バッテリーの節約）
//   止めている間は時計も止まるので、BGM の予約もずれずに、もどったところから続く
document.addEventListener("visibilitychange", () => {
  if (!AudioSys.ctx) return;
  if (document.hidden) AudioSys.ctx.suspend();
  else AudioSys.ctx.resume();
});

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
//   ふだんはファイルの最後にある B案（ハードテクノ）を鳴らす。URL に ?bgm=a をつけると、この前の曲（チップチューン）
// ============================================================
const Music = {
  gain: null,
  noiseBuf: null,
  timer: null,
  on: false,
  intense: false,
  track: "game",
  step: 0,
  nextTime: 0,
  // "b" = ハードテクノ（ふだんはこちら） / "a" = チップチューン（前の曲。?bgm=a。聴きくらべ用）
  variant: (() => {
    try {
      return new URLSearchParams(location.search).get("bgm") === "a" ? "a" : "b";
    } catch (e) {
      return "b";
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

  // track："game"（プレイ中）/ "menu"（タイトル・準備・図鑑）/ "clear"（クリア画面）/ "over"（ゲームオーバー画面）
  //   プレイ中以外の曲は B案だけ
  start(track = "game") {
    if (!AudioSys.ctx) return;
    if (track !== "game" && this.variant !== "b") return;
    this.setup();
    this.stop();
    this.track = track;
    this.on = true;
    this.step = 0;
    if (this.bFade) {
      const t = AudioSys.ctx.currentTime;
      this.bFade.gain.cancelScheduledValues(t);
      this.bFade.gain.setValueAtTime(1, t);
    }
    this.resume();
  },
  stop() {
    if (this.on && this.bFade) {
      // B案は、鳴っている音の余韻ごと少しずつ消す
      const t = AudioSys.ctx.currentTime;
      this.bFade.gain.cancelScheduledValues(t);
      this.bFade.gain.setValueAtTime(this.bFade.gain.value, t);
      this.bFade.gain.linearRampToValueAtTime(0, t + 0.5);
    }
    this.on = false;
    this.intense = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
  // メニュー曲（まだ鳴っていなければ始める）。ゲーム中・結果画面では何もしない
  menu() {
    if (isGameStarted || isGameOver || resultShown) return;
    if (this.on && this.track === "menu") return;
    this.start("menu");
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
    const bpm = this.track === "game" ? (this.intense ? 172 : 150) : this.B_TRACK_BPM[this.track];
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
    if (this.track === "menu") return this.playMenuB(step, t, d16);
    if (this.track === "clear") return this.playClearB(step, t, d16);
    if (this.track === "over") return this.playOverB(step, t, d16);
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
// BGM の B案（ふだんはこちら。?bgm=a のときは使わない）：地下トンネルを突き進むハードテクノ
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
    this.bFade = ctx.createGain(); // 曲を止めるときのフェードアウト用
    this.bComp.connect(this.bFade);
    this.bFade.connect(out);
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
      drip: this.channelB(this.bDuck, 0.4, 0.9, 0.45, 0.3, 0),
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

  kickB(t, vol = 1) {
    const ctx = AudioSys.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    g.gain.setValueAtTime(vol, t);
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

// ============================================================
// B案の画面ごとの曲（楽器はプレイ中の曲と同じものを使う）
//   menu：タイトル・準備・図鑑。落ち着いた待機の曲（16小節ループ。和音は2小節ずつ）
//   clear：クリア画面。明るい王道進行（C - D - Bm - Em）
//   over：ゲームオーバー画面。ドラムなしの暗く静かな曲と、管にしたたる しずくの音
// ============================================================
Object.assign(Music, {
  B_TRACK_BPM: { menu: 124, clear: 132, over: 84 },
  B_CLEAR_CHORDS: [
    [48, 52, 55, 59],
    [50, 54, 57, 62],
    [47, 50, 54, 57],
    [52, 55, 59, 62],
  ],
  B_CLEAR_ROOTS: [36, 38, 35, 40],
  B_CLEAR_LEAD: [
    [0, 71, 2], [2, 74, 2], [4, 79, 4], [8, 78, 2], [10, 76, 2], [12, 74, 4],
    [16, 71, 2], [18, 74, 2], [20, 76, 4], [24, 79, 2], [26, 78, 2], [28, 76, 4],
  ],
  B_OVER_CHORDS: [
    [52, 55, 59, 64],
    [48, 52, 55, 59],
    [45, 52, 57, 60],
    [47, 51, 54, 59],
  ],
  B_OVER_ROOTS: [40, 36, 45, 47],

  playMenuB(step, t, d16) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const lb = bar % 16; // ループの中の何小節目か
    const ci = Math.floor(lb / 2) % 8;
    const chord = this.B_CHORDS[ci];
    const barLen = d16 * 16;
    if (s === 0) {
      this.padB(chord, t, barLen, 0.07, 1200);
      // 低いベースを1小節のばす
      this.bassB(this.B_ROOTS[ci], t, barLen * 0.95, 260);
    }
    // 8分音符のアルペジオ（反響で管に広がる）
    if (s % 2 === 0) {
      const i = this.B_ARP[(s / 2 + lb * 3) % 16];
      this.arpB(chord[i] + 12, t, 0.08);
    }
    // 5小節目から、半分の速さのキックとハイハット（2周目からは最初から）
    const groove = bar >= 4;
    if (groove && (s === 0 || s === 8)) this.kickB(t, 0.55);
    if (groove && bar >= 8 && s % 4 === 2) this.hatB(t, false, 0.08);
    if (groove && s === 8 && lb % 4 === 3) this.clapB(t, 0.22);
  },

  playClearB(step, t, d16) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ci = bar % 4;
    const chord = this.B_CLEAR_CHORDS[ci];
    const barLen = d16 * 16;
    if (s === 0 && bar % 8 === 0) this.crashB(t);
    if (s % 4 === 0) this.kickB(t, 0.7);
    if (s === 4 || s === 12) this.clapB(t, 0.35);
    if (s % 4 === 2) this.hatB(t, true, 0.14);
    // 裏拍のベース（オクターブを行き来する）
    if (s % 4 === 2) this.bassB(this.B_CLEAR_ROOTS[ci] + (s === 6 || s === 14 ? 12 : 0), t, d16 * 1.6, 1100);
    if (s === 0) this.padB(chord, t, barLen, 0.06, 2600);
    this.arpB(chord[this.B_ARP[s]] + 24, t, 0.035);
    // 最初の2小節はメロディなし。そのあとリード
    if (bar >= 2) {
      const pos = (bar % 2) * 16 + s;
      for (const [p, m, len] of this.B_CLEAR_LEAD) {
        if (p === pos) this.leadB(m, t, d16 * len * 0.92, 0.1);
      }
    }
  },

  playOverB(step, t, d16) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ci = bar % 4;
    const chord = this.B_OVER_CHORDS[ci];
    const barLen = d16 * 16;
    if (s === 0) {
      this.padB(chord, t, barLen, 0.08, 900);
      this.bassB(this.B_OVER_ROOTS[ci] - 12, t, barLen * 0.95, 180);
    }
    // 4分音符ごとに、和音の音を上から下へ（まばらに）
    if (s % 4 === 0 && (bar % 2 === 1 || s < 8)) {
      this.arpB(chord[3 - s / 4] + 12, t, 0.055);
    }
    // しずく（ときどき、ランダムな高さで）
    if (Math.random() < 0.06) this.dripB(t, 1200 + Math.random() * 900);
  },

  // しずく：一瞬で音が上がる短いサイン波（水滴が水面に落ちた「ポチャン」）
  dripB(t, f) {
    const ctx = AudioSys.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g);
    g.connect(this.bCh.drip);
    o.start(t);
    o.stop(t + 0.14);
  },
});

// ============================================================
// 効果音の B案（ふだんはこちら。?sfx=a 以外のとき AudioSys の関数を差し替える）：金属的・インダストリアルな重い音
//   1つの音を「アタック（頭のカチッ）」「胴鳴り（低いドン）」「余韻（残響）」の3層に分けて重ねる
//   効果音専用の経路：軽く歪ませる → コンプレッサー → 全体の音量。残響は下水管の中のように暗く響かせる
//   ほかのファイルから直接呼ぶ tone / noise も、左右に広げた2つの音にして残響を足す
// ============================================================
const SFX_B = {
  SFX_B_VOLUME: 0.6, // 効果音 B案の全体の音量（大きすぎ・小さすぎのときはここを変える）

  initB() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    const outG = ctx.createGain();
    outG.gain.value = this.SFX_B_VOLUME;
    comp.connect(outG);
    outG.connect(this.master);

    // 入口：ほんの少し歪ませて音を太くする
    this.sfxIn = ctx.createGain();
    const ws = ctx.createWaveShaper();
    ws.curve = Music.driveCurve(1.4);
    this.sfxIn.connect(ws);
    ws.connect(comp);

    // 低い「ドン」専用：強く歪ませて、スマホのスピーカーでも聞こえる倍音を出す
    this.boomIn = ctx.createGain();
    const bws = ctx.createWaveShaper();
    bws.curve = Music.driveCurve(3);
    const blp = ctx.createBiquadFilter();
    blp.type = "lowpass";
    blp.frequency.value = 1800;
    this.boomIn.connect(bws);
    bws.connect(blp);
    blp.connect(comp);

    // 残響：暗く（高い音を落として）響くノイズ。最初の短い反射をいくつか入れて「管の中」らしくする
    const irLen = Math.floor(sr * 1.8);
    const ir = ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.35;
        d[i] = lp * Math.pow(1 - i / irLen, 2.2) * 1.6;
      }
      [0.011, 0.023, 0.037, 0.052].forEach((s, k) => {
        const i = Math.floor(sr * (s + ch * 0.004));
        d[i] += 0.7 / (k + 1);
      });
    }
    this.sfxVerbIn = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    this.sfxVerbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(comp);

    // 使い回すノイズ（2秒。鳴らすたびに開始位置をずらす）
    const len = sr * 2;
    this.nbuf = ctx.createBuffer(1, len, sr);
    const nd = this.nbuf.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    // プロペラ音にモーターの高い「ウィーン」を重ねる（近い周波数でうなりを作る）
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 950;
    bp.Q.value = 3;
    const wg = ctx.createGain();
    wg.gain.value = 0.35;
    bp.connect(wg);
    wg.connect(this.droneGain);
    this.whineIn = bp;
  },

  // プロペラ音に重ねる「ウィーン」の波（makeDrone から呼ばれ、飛んでいる間だけ動く）
  droneExtraB() {
    return [191, 194.5].map((f) => {
      const o = this.ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      o.connect(this.whineIn);
      o.start();
      return o;
    });
  },

  // 音を効果音の経路へ出す（残響の量・左右）
  outB(node, verb, pan) {
    const ctx = this.ctx;
    let n = node;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      n.connect(p);
      n = p;
    }
    n.connect(this.sfxIn);
    if (verb) {
      const g = ctx.createGain();
      g.gain.value = verb;
      n.connect(g);
      g.connect(this.sfxVerbIn);
    }
  },

  // 左右に少しずらした2つの波（o.lp でフィルター、o.lpEnd で閉じていく）
  toneB(f0, f1, dur, type, vol, when = 0, o = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    const atk = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dur, atk + 0.01));
    let head = g;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(o.lpEnd, t + dur);
      f.connect(g);
      head = f;
    }
    [-1, 1].forEach((side) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = side * (o.detune ?? 8);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      let n = osc;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = side * 0.35;
        osc.connect(p);
        n = p;
      }
      const half = ctx.createGain();
      half.gain.value = 0.6;
      n.connect(half);
      half.connect(head);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
    this.outB(g, o.verb ?? 0.25, 0);
  },

  // ノイズ（o.type でフィルターの種類、o.freqEnd で周波数を動かす）
  noiseB(dur, freq, vol, when = 0, o = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.nbuf;
    src.loop = true; // 開始位置をずらすので、長い音でも途中で切れないようにする
    const f = ctx.createBiquadFilter();
    f.type = o.type || "lowpass";
    f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    const g = ctx.createGain();
    const atk = o.attack || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dur, atk + 0.01));
    src.connect(f);
    f.connect(g);
    this.outB(g, o.verb ?? 0.3, o.pan || 0);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  },

  // 低い「ドン」（下がっていくサイン波を強く歪ませる）
  boomB(f0, f1, dur, vol, when = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.boomIn);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  // 金属の響き：整数倍でない倍音（金属の板やベルと同じ）を重ねる。高い倍音ほど早く消える
  metalB(f, dur, vol, when = 0, verb = 0.45) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const g = ctx.createGain();
    g.gain.value = vol;
    this.outB(g, verb, 0);
    [
      [1, 1],
      [2.76, 0.6],
      [5.4, 0.4],
      [8.93, 0.25],
    ].forEach(([r, a], i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f * r;
      const og = ctx.createGain();
      const d = dur / (1 + i * 0.7);
      og.gain.setValueAtTime(a, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + d + 0.05);
    });
  },

  // 砕ける音：短いノイズの粒を時間をずらしてばらまく
  grainsB(n, spread, vol, lo, hi, when = 0) {
    for (let i = 0; i < n; i++) {
      const dt = when + Math.random() * spread;
      const f = lo + Math.random() * (hi - lo);
      this.noiseB(0.03 + Math.random() * 0.05, f, vol * (0.5 + Math.random() * 0.5), dt, {
        type: "bandpass",
        q: 1.5,
        verb: 0.3,
        pan: Math.random() * 1.2 - 0.6,
      });
    }
  },

  // --- ほかのファイルから直接呼ばれる音も太くする ---
  tone(f0, f1, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const harsh = type === "square" || type === "sawtooth";
    this.toneB(f0, f1, dur, type, vol * 4, when, { lp: harsh ? 5000 : 0, verb: 0.25 });
    // 長くて低い音（ボスの「ゴゴゴ…」など）には「ドン」を重ねる
    if (dur >= 0.3 && Math.min(f0, f1) < 200) this.boomB(f0 * 1.3, Math.max(30, f1 * 0.7), dur, vol * 2.5, when);
  },
  noise(dur, freq, vol) {
    if (!this.ctx) return;
    this.noiseB(dur, freq, vol, 0, { verb: 0.35 });
    if (dur >= 0.4 && freq <= 600) this.boomB(90, 35, dur, vol * 1.8);
  },

  // --- 効果音 ---
  playScan(combo) {
    if (!this.ctx) return;
    this.toneB(650 + combo * 80, 1500, 0.16, "triangle", 0.22, 0, { verb: 0.35 });
    this.metalB(1300 + combo * 80, 0.4, 0.05);
  },
  playMiss() {
    if (!this.ctx) return;
    this.toneB(320, 180, 0.12, "square", 0.06, 0, { lp: 1500 });
  },
  // ダメージ：金属がひしゃげる「ガシャン」＋低い「ドン」
  playDamage() {
    if (!this.ctx) return;
    this.noiseB(0.06, 3000, 0.45, 0, { type: "highpass", verb: 0.2 });
    this.boomB(130, 38, 0.5, 0.85);
    this.metalB(173, 0.7, 0.16, 0, 0.5);
    this.noiseB(0.45, 1100, 0.35, 0.005, { freqEnd: 180, verb: 0.4 });
    this.toneB(150, 45, 0.35, "sawtooth", 0.14, 0, { lp: 900 });
  },
  playScrape() {
    if (!this.ctx) return;
    this.noiseB(0.12, 2600, 0.35, 0, { type: "bandpass", q: 2.5, freqEnd: 1500, verb: 0.2 });
    this.metalB(820 + Math.random() * 200, 0.18, 0.05, 0, 0.2);
  },
  playHeal() {
    if (!this.ctx) return;
    this.toneB(660, 660, 0.18, "triangle", 0.18, 0, { verb: 0.45 });
    this.toneB(990, 990, 0.4, "triangle", 0.18, 0.12, { verb: 0.45 });
    this.metalB(1980, 0.6, 0.04, 0.12);
  },
  playClear() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) =>
      this.toneB(f, f, 0.4, "sawtooth", 0.13, i * 0.16, { lp: 3200, lpEnd: 1200, verb: 0.5 }),
    );
    // 最後に和音をのばす
    [523, 659, 784, 1047].forEach((f) =>
      this.toneB(f, f, 1.6, "sawtooth", 0.07, 0.64, { lp: 2600, lpEnd: 700, attack: 0.02, verb: 0.7 }),
    );
    this.boomB(110, 40, 0.8, 0.6, 0.64);
    this.noiseB(1.2, 6500, 0.12, 0.64, { type: "highpass", verb: 0.6 });
  },
  playGameOver() {
    if (!this.ctx) return;
    [330, 262, 196, 131].forEach((f, i) =>
      this.toneB(f, f * 0.9, 0.5, "sawtooth", 0.14, i * 0.22, { lp: 1600, lpEnd: 400, verb: 0.5 }),
    );
    this.boomB(80, 30, 1.2, 0.7, 0.66);
  },
  // カウントダウン（GO は「ドン」と金属音で重く）
  playBeep(high) {
    if (!this.ctx) return;
    const f = high ? 1320 : 660;
    this.toneB(f, f, high ? 0.4 : 0.15, "square", 0.1, 0, { lp: 4000, verb: 0.3 });
    if (high) {
      this.boomB(140, 45, 0.6, 0.8);
      this.metalB(660, 0.9, 0.08);
      this.noiseB(0.8, 5000, 0.12, 0, { type: "highpass", verb: 0.5 });
    } else {
      this.boomB(90, 50, 0.15, 0.35);
    }
  },
  // 大雨警報のサイレン（1オクターブ下を重ねて厚く）
  playSiren() {
    if (!this.ctx) return;
    [1, 0.5].forEach((k) => {
      this.toneB(600 * k, 1100 * k, 0.35, "sawtooth", 0.08, 0, { lp: 2600, attack: 0.03, verb: 0.45 });
      this.toneB(1100 * k, 600 * k, 0.35, "sawtooth", 0.08, 0.35, { lp: 2600, attack: 0.03, verb: 0.45 });
    });
  },
  // 水しぶき：「ザバッ」＋水の中の低い「ドプン」
  playSplash() {
    if (!this.ctx) return;
    this.noiseB(0.35, 2400, 0.26, 0, { freqEnd: 500, attack: 0.008, verb: 0.35 });
    this.noiseB(0.6, 800, 0.1, 0.03, { type: "bandpass", q: 1.2, verb: 0.6 });
    this.boomB(95, 50, 0.25, 0.3);
  },
  // チェックポイント：和音の響き＋きらっとした余韻
  playCheckpoint() {
    if (!this.ctx) return;
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.toneB(f, f, 0.25, "triangle", 0.17, i * 0.06, { verb: 0.5 }),
    );
    this.toneB(392, 392, 0.9, "sawtooth", 0.06, 0.18, { lp: 1800, lpEnd: 500, attack: 0.03, verb: 0.6 });
    this.metalB(1568, 1.0, 0.05, 0.18);
  },
  // 区間が変わった：重いヒット＋シンバル
  playZone() {
    if (!this.ctx) return;
    [523, 784, 1047].forEach((f, i) =>
      this.toneB(f, f, 0.25, "sawtooth", 0.08, i * 0.09, { lp: 3000, verb: 0.45 }),
    );
    this.boomB(80, 42, 0.6, 0.6);
    this.noiseB(0.9, 5200, 0.14, 0, { type: "highpass", verb: 0.5 });
  },
  // 障害物を取りのぞいた：コンクリートが砕ける音
  playBreak() {
    if (!this.ctx) return;
    this.noiseB(0.05, 4000, 0.35, 0, { type: "highpass", verb: 0.2 });
    this.boomB(160, 45, 0.4, 0.7);
    this.grainsB(6, 0.14, 0.3, 1200, 4200);
    this.noiseB(0.5, 1400, 0.16, 0.02, { freqEnd: 300, verb: 0.45 });
  },
  // QTE 開始：時間が遅くなる「ブゥゥン」
  playQteStart() {
    if (!this.ctx) return;
    this.toneB(900, 180, 0.35, "sine", 0.12, 0, { verb: 0.5 });
    this.toneB(180, 45, 0.9, "sawtooth", 0.16, 0, { lp: 900, lpEnd: 200, verb: 0.6 });
    this.noiseB(0.7, 2500, 0.14, 0, { type: "bandpass", q: 1.5, freqEnd: 250, attack: 0.05, verb: 0.6 });
  },
  // 撮影成功：機械シャッターの「カシャッ」（2回の小さなクリック）。PERFECT は金属の響きを重ねる
  playShutter(perfect) {
    if (!this.ctx) return;
    this.noiseB(0.025, 4500, 0.4, 0, { type: "highpass", verb: 0.2 });
    this.noiseB(0.04, 2500, 0.3, 0.055, { type: "bandpass", q: 1.5, verb: 0.3 });
    this.boomB(200, 90, 0.08, 0.25, 0.055);
    if (perfect) {
      this.toneB(1760, 2640, 0.3, "triangle", 0.12, 0.05, { verb: 0.5 });
      this.metalB(1760, 0.9, 0.08, 0.05, 0.6);
    } else {
      this.toneB(1320, 1320, 0.18, "triangle", 0.1, 0.05, { verb: 0.4 });
    }
  },
  // QTE 失敗：「ブブッ」という重いブザー
  playQteMiss() {
    if (!this.ctx) return;
    this.toneB(220, 90, 0.4, "sawtooth", 0.14, 0, { lp: 1200, verb: 0.35 });
    this.toneB(233, 95, 0.4, "square", 0.07, 0, { lp: 900 });
    this.boomB(80, 40, 0.3, 0.4);
  },
  // 墜落：爆発（低音・破片・金属・長い余韻）
  playExplode() {
    if (!this.ctx) return;
    this.noiseB(0.08, 3500, 0.5, 0, { type: "highpass", verb: 0.3 });
    this.boomB(110, 25, 1.5, 0.8);
    this.noiseB(1.6, 3200, 0.5, 0.005, { freqEnd: 140, verb: 0.6 });
    this.metalB(140, 1.3, 0.14, 0.02, 0.6);
    this.grainsB(10, 0.9, 0.22, 800, 3500, 0.15);
  },
};
if (AudioSys.sfxVariant === "b") Object.assign(AudioSys, SFX_B);

