// 初期設定
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("gameCanvas"),
});
renderer.setSize(window.innerWidth, window.innerHeight);

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

// コンクリートのカラーテクスチャを生成
function createConcreteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // ベースカラー（茶褐色に変色した汚れたコンクリート）
  ctx.fillStyle = "#4e3f30";
  ctx.fillRect(0, 0, 512, 512);

  // 細かなノイズでざらざら感を出す
  for (let i = 0; i < 30000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 1.5 + 0.5;
    const shade = Math.random() * 30 - 15; // 明るさ変化
    ctx.fillStyle = `rgba(${78 + shade}, ${63 + shade}, ${48 + shade}, 0.45)`;
    ctx.fillRect(x, y, size, size);
  }

  // 大きな汚れ・染みを描画
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = Math.random() * 60 + 20;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, "rgba(30, 20, 10, 0.65)");
    grad.addColorStop(0.5, "rgba(30, 20, 10, 0.3)");
    grad.addColorStop(1, "rgba(30, 20, 10, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // コンクリート管の目地（継ぎ目）を描画
  ctx.strokeStyle = "rgba(15, 10, 5, 0.85)";
  ctx.lineWidth = 6;
  // 横方向（円周方向）の継ぎ目
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  // 縦方向の継ぎ目
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300); // 歪みを減らすためのリピート設定
  return texture;
}

// 凹凸を表現するバンプマップを生成
function createConcreteBumpTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // 中間グレー（高さ0の基準）
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 512);

  // ザラザラした凹凸ノイズ
  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 1.2 + 0.5;
    const val = Math.random() * 80 - 40; // 凹凸値
    const colorVal = Math.min(255, Math.max(0, 128 + val));
    ctx.fillStyle = `rgb(${colorVal}, ${colorVal}, ${colorVal})`;
    ctx.fillRect(x, y, size, size);
  }

  // 継ぎ目の溝（黒に近い色でへこませる）
  ctx.strokeStyle = "#202020";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300);
  return texture;
}

// 粗さ（水濡れ・光沢）を表現するラフネスマップを生成
function createConcreteRoughnessTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // 基本は粗い（反射が少ない＝白に近い）
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(0, 0, 512, 512);

  // 下水管の下部に水が溜まって濡れているのを表現（円周方向の一部を濃い黒にする）
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, "#d0d0d0");
  grad.addColorStop(0.35, "#c0c0c0");
  grad.addColorStop(0.45, "#151515"); // 濡れてテカテカ（低いラフネス）
  grad.addColorStop(0.55, "#151515");
  grad.addColorStop(0.65, "#c0c0c0");
  grad.addColorStop(1, "#d0d0d0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // ランダムな濡れ染みを追加（壁面から垂れる水滴の跡など）
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = Math.random() * 40 + 10;
    const rGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    rGrad.addColorStop(0, "#101010"); // 非常に滑らか
    rGrad.addColorStop(1, "#d0d0d0");
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300);
  return texture;
}

// 下水管（コンクリート質感シリンダー）
const pipeRadius = 10;
const pipeLength = 3000;
const pipeGeo = new THREE.CylinderGeometry(
  pipeRadius,
  pipeRadius,
  pipeLength,
  32, // 分割数を増やしてバンプマップを滑らかに表現
  100,
  true,
);

const pipeMat = new THREE.MeshStandardMaterial({
  map: createConcreteTexture(),
  bumpMap: createConcreteBumpTexture(),
  bumpScale: 0.15,
  roughnessMap: createConcreteRoughnessTexture(),
  metalness: 0.1,
  side: THREE.BackSide,
});

const pipe = new THREE.Mesh(pipeGeo, pipeMat);
pipe.rotation.x = Math.PI / 2;
pipe.position.z = -pipeLength / 2;
scene.add(pipe);

// ライティングの追加
const ambientLight = new THREE.AmbientLight(0x222222); // 弱い環境光
scene.add(ambientLight);

// ドローンのヘッドライト（スポットライト）
const headLight = new THREE.SpotLight(
  0xffffff,
  4.0,
  150,
  Math.PI / 4,
  0.4,
  0.8,
);
headLight.position.set(0, 0, 0);
scene.add(camera); // スポットライトを追従させるためカメラをシーンに登録
camera.add(headLight);

// スポットライトの照射ターゲット（カメラの前方）
const lightTarget = new THREE.Object3D();
lightTarget.position.set(0, 0, -10);
camera.add(lightTarget);
headLight.target = lightTarget;

// ============================================================
// オブジェクト管理
// ============================================================
const hazards = []; // 衝突ダメージのある障害物（漏水・堆積物・木の根）
const anomalies = []; // スキャンでスコアになる異常（腐食・ひび割れ・鉄筋露出）

// メッシュを登録し、クリック判定用のuserDataを全子要素に付与する
function registerObject(list, mesh, type) {
  const o = { mesh: mesh, active: true, counted: false, type: type };
  mesh.traverse((c) => {
    c.userData = { type: type, parent: o };
  });
  list.push(o);
  scene.add(mesh);
}

// 障害物：漏水（天井から底まで流れる水柱）
function createLeak(z) {
  const x = (Math.random() * 2 - 1) * (pipeRadius - 3);
  const height = Math.sqrt(pipeRadius * pipeRadius - x * x) * 2;

  const geo = new THREE.CylinderGeometry(0.8, 2, height, 8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x33aaff,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.75,
    emissive: 0x002244,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0, z);
  return mesh;
}

// 障害物：堆積物（床の茶色い土砂山）
function createSediment(z) {
  // 高さは直径の最大4割 (20 * 0.4 = 8)
  const hVal = Math.random() * 6 + 2; // 2〜8のランダム

  const geo = new THREE.SphereGeometry(1, 16, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5c4033, // 茶色（ダークブラウン）
    roughness: 0.9,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // 床面 (-pipeRadius) を中心に配置し、X方向の幅とZ方向の厚みをスケールで調整
  mesh.scale.set(7, hVal, 4);
  mesh.position.set(0, -pipeRadius, z);
  return mesh;
}

// 障害物：木の根の侵入（継ぎ目から垂れ下がる根の束）
function createRoots(z) {
  const group = new THREE.Group();
  const angle = Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.7; // 上側の壁面
  const r = pipeRadius - 0.2;
  group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
  group.lookAt(new THREE.Vector3(0, 0, z));

  const mat = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.95,
    metalness: 0.0,
  });
  const n = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const len = Math.random() * 3 + 2.5;
    // 根元(壁側)が太く、先端が細い円錐状
    const geo = new THREE.CylinderGeometry(0.04, 0.28, len, 6);
    const root = new THREE.Mesh(geo, mat);
    // +Y(先端側)を管の中心方向(+Z)へ向け、ランダムに広げる
    root.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    root.rotation.z = (Math.random() - 0.5) * 0.8;
    root.position.set(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.5,
      len / 2 - 0.5,
    );
    group.add(root);
  }
  return group;
}

// スコアアノマリー：壁面の腐食・苔（扁平なカビや錆の塊）
function createCorrosion(z) {
  const angle = Math.random() * Math.PI * 2;
  const radius = pipeRadius - 0.3;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  const geo = new THREE.SphereGeometry(1.2, 8, 8);
  const isRust = Math.random() > 0.5;
  const color = isRust ? 0x8b4513 : 0x4d5d2f;
  const mat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.9,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.lookAt(new THREE.Vector3(0, 0, z));
  mesh.scale.set(1.6, 1.6, 0.25);
  return mesh;
}

// スコアアノマリー：ひび割れ（壁面に貼るジグザグ模様のテクスチャ）
function createCrackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  // 透明背景に暗い亀裂線を描く
  ctx.strokeStyle = "rgba(8, 6, 4, 0.92)";
  ctx.lineCap = "round";
  ctx.lineWidth = 5;
  ctx.beginPath();
  let x = 60 + Math.random() * 130;
  let y = 15;
  ctx.moveTo(x, y);
  while (y < 235) {
    x += (Math.random() - 0.5) * 70;
    y += Math.random() * 35 + 12;
    ctx.lineTo(x, y);
    // 枝分かれ
    if (Math.random() < 0.45) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 90, y + Math.random() * 45 + 5);
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

function createCrack(z) {
  const geo = new THREE.PlaneGeometry(5, 5);
  const mat = new THREE.MeshStandardMaterial({
    map: createCrackTexture(),
    transparent: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const angle = Math.random() * Math.PI * 2;
  const r = pipeRadius - 0.15;
  mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
  mesh.lookAt(new THREE.Vector3(0, 0, z));
  return mesh;
}

// スコアアノマリー：鉄筋露出（欠けたコンクリートから錆びた鉄筋が見える）
function createRebar(z) {
  const group = new THREE.Group();
  const angle = Math.random() * Math.PI * 2;
  const r = pipeRadius - 0.3;
  group.position.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
  group.lookAt(new THREE.Vector3(0, 0, z));

  // 欠けたコンクリート面（暗い斑）
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1.0 }),
  );
  group.add(patch);

  // 錆びた鉄筋（横向きの棒3本）
  const barMat = new THREE.MeshStandardMaterial({
    color: 0x8b3a1a,
    roughness: 0.6,
    metalness: 0.5,
  });
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3, 6),
      barMat,
    );
    bar.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
    bar.position.set(0, (i - 1) * 0.7, 0.2);
    group.add(bar);
  }
  return group;
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
// ============================================================
const manholes = [];
function createManhole(z) {
  const group = new THREE.Group();

  // 地上への縦穴（上に伸びる管）
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 8, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x3a3228,
      side: THREE.BackSide,
      roughness: 1.0,
    }),
  );
  shaft.position.set(0, pipeRadius + 3.5, z);
  group.add(shaft);

  // 地上から差し込む光のシャフト
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.8, pipeRadius * 2, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xfff3c0,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.set(0, 0, z);
  group.add(beam);

  // 差し込む光の照明
  const light = new THREE.PointLight(0xfff2cc, 1.2, 60);
  light.position.set(0, pipeRadius - 2, z);
  group.add(light);

  scene.add(group);
  manholes.push({ z: z, passed: false });
}
[-750, -1500, -2250].forEach(createManhole);

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

// カメラの傾き（ドローンの機体挙動演出）
let camRoll = 0;
let camPitch = 0;

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
  updatePauseBtn();
  addLog("DRONE LAUNCHED: INSPECTION START");
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
      if (aPressed) resetGame();
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
  } else if (comboExpire > 0) {
    // 止めていた時間のぶんだけコンボの制限時間をのばす
    comboExpire += performance.now() - pausedAt;
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
  updatePauseBtn();
  blurActiveButton();

  // 今回のプレイぶんの図鑑記録だけリセット（累計 codexSession は保持する）
  CODEX_ORDER.forEach((k) => (codexRun[k] = 0));

  // カメラを初期位置へ
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);

  // 障害物とアノマリーの再アクティブ化とヘルパーの削除
  hazards.concat(anomalies).forEach((o) => {
    o.active = true;
    o.counted = false;
    o.mesh.visible = true;
    if (o.helper) {
      scene.remove(o.helper);
      o.helper = null;
    }
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
// 図鑑カード（発見した異常の解説・豆知識を表示）
// ============================================================
let infoCardTimer = null;
function showInfoCard(title, desc, extraClass = "") {
  const card = document.getElementById("infoCard");
  document.getElementById("infoTitle").innerText = title;
  document.getElementById("infoDesc").innerText = desc;
  card.className = extraClass;
  card.style.display = "block";
  card.offsetHeight; // リフロー強制
  card.classList.add("show");

  if (infoCardTimer) clearTimeout(infoCardTimer);
  infoCardTimer = setTimeout(hideInfoCard, 4500);
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

// コンボ表示の更新
function updateComboUI() {
  const el = document.getElementById("comboDisplay");
  if (!el) return;
  if (combo >= 2) {
    el.innerText = `COMBO ×${Math.min(combo, COMBO_MAX_MULT)}`;
    el.classList.add("show");
  } else {
    el.classList.remove("show");
  }
}

// Raycaster によるクリック判定（異常点検）
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const SCAN_RANGE = 140; // これ以上遠い異常はスキャンできない

// 現在アクティブな判定対象メッシュを集める
function collectScanTargets() {
  const targets = [];
  hazards.concat(anomalies).forEach((o) => {
    if (o.active) targets.push(o.mesh);
  });
  return targets;
}

// 指定した正規化デバイス座標(NDC)に向けてスキャンを試みる。
// マウスクリックとゲームパッド（画面中央固定）の両方から呼ばれる。
function tryScan(ndcX, ndcY) {
  if (!isGameStarted || isPaused || isGameOver) return false;

  mouse.x = ndcX;
  mouse.y = ndcY;
  raycaster.setFromCamera(mouse, camera);

  // Group対応のため recursive = true で判定
  const intersects = raycaster.intersectObjects(collectScanTargets(), true);
  if (intersects.length === 0 || intersects[0].distance > SCAN_RANGE) {
    return false;
  }

  const data = intersects[0].object.userData;
  if (!data || !data.parent || !data.parent.active) return false;
  const target = data.parent;

  // 水色のレティクル（BoxHelper）を生成して対象物を囲む
  const helper = new THREE.BoxHelper(target.mesh, 0x00e5ff);
  scene.add(helper);
  target.helper = helper;

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

  // 図鑑カードで異常の解説を表示（土木PR要素）
  const info = ANOMALY_INFO[target.type];
  if (info) {
    showInfoCard(`発見！ ${info.name} (+${gained})`, info.desc);
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
  inspectedEl.innerText = `${inspectedCount} / ${totalInspectable}`;

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
// ============================================================
const RANKS = [
  {
    min: 0.8,
    rank: "S",
    cls: "rank-S",
    title: "マスター点検技師",
    comment:
      "パーフェクトに近い点検！きみは未来のまちのインフラを守るエースだ！",
  },
  {
    min: 0.6,
    rank: "A",
    cls: "rank-A",
    title: "一人前の点検技師",
    comment: "すばらしい点検技術！本物の点検技師も顔負けだ！",
  },
  {
    min: 0.4,
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
  const rate = totalInspectable > 0 ? inspectedCount / totalInspectable : 0;
  const r = RANKS.find((x) => rate >= x.min);

  const badge = document.getElementById("rankBadge");
  badge.innerText = r.rank;
  badge.className = `rank-badge ${r.cls}`;
  document.getElementById("rankTitle").innerText = `認定: ${r.title}`;
  document.getElementById("rankComment").innerText = r.comment;

  document.getElementById("finalFound").innerText =
    `${inspectedCount} / ${totalInspectable} 件`;
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
const centerNdc = new THREE.Vector2(0, 0);
let lockedTarget = null;
let lockCheckAccum = 0;

function updateTargetLock(delta) {
  // 毎フレームレイキャストすると重いので約20回/秒に間引く
  lockCheckAccum += delta;
  if (lockCheckAccum < 0.05) return;
  lockCheckAccum = 0;

  raycaster.setFromCamera(centerNdc, camera);
  const hits = raycaster.intersectObjects(collectScanTargets(), true);

  let found = null;
  if (hits.length > 0 && hits[0].distance <= SCAN_RANGE) {
    const data = hits[0].object.userData;
    if (data && data.parent && data.parent.active) found = data.parent;
  }

  if (found !== lockedTarget) {
    lockedTarget = found;
    if (reticleEl) reticleEl.classList.toggle("locked", !!found);
  }
}

// 通過済みオブジェクトの見逃し判定
function checkPassedObjects() {
  hazards.concat(anomalies).forEach((o) => {
    if (!o.counted && o.mesh.position.z > camera.position.z + 6) {
      o.counted = true;
      if (o.active) missedCount++;
    }
  });
}

// メインループ
let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  // 経過秒（現状は演出の間引きにのみ使用。将来のデルタタイム対応の足がかり）
  const nowTime = performance.now();
  const delta = Math.min(0.1, (nowTime - lastFrameTime) / 1000);
  lastFrameTime = nowTime;

  // ゲームパッドはタイトル・ポーズ・リザルト画面でも操作できるよう常にポーリングする
  Pad.poll();

  if (isGameOver) {
    renderer.render(scene, camera);
    return;
  }

  // 一時停止状態
  if (isPaused) {
    renderer.render(scene, camera);
    return;
  }

  // 開始前の待機状態（ホバリング演出）
  if (!isGameStarted) {
    camera.position.y = Math.sin(Date.now() * 0.002) * 0.15;
    camera.position.x = Math.cos(Date.now() * 0.0015) * 0.15;
    renderer.render(scene, camera);
    return;
  }

  // 進行処理（奥へ進むほど少しずつ加速する難易度カーブ）
  const speed = baseSpeed + (distance / goalDistance) * 0.6;
  camera.position.z -= speed;
  distance = Math.abs(camera.position.z) / zToMeterRatio;

  // クリア判定
  if (distance >= goalDistance) {
    updateUI();
    isGameOver = true;
    AudioSys.setDrone(false);
    AudioSys.playClear();
    showClearScreen();
    return;
  }

  // プレイヤー移動処理（キーボードとゲームパッドの両対応）
  const moveSpeed = 0.25;
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

  camera.position.x += inputX * moveSpeed;
  camera.position.y += inputY * moveSpeed;

  // レティクルのターゲットロック判定
  updateTargetLock(delta);

  // 移動方向に応じてドローンの機体を傾ける（ロール・ピッチ演出）
  camRoll += (-inputX * 0.1 - camRoll) * 0.08;
  camPitch += (inputY * 0.05 - camPitch) * 0.08;
  camera.rotation.z = camRoll;
  camera.rotation.x = camPitch;

  // 壁との衝突判定
  const distFromCenter = Math.sqrt(
    camera.position.x ** 2 + camera.position.y ** 2,
  );
  if (distFromCenter > pipeRadius - 1) {
    hp -= 0.5; // 壁接触ダメージ（持続）
    shakeIntensity = Math.min(0.2, shakeIntensity + 0.03); // 壁接触時は微小な画面ブレ
    // 壁の外に出ないように押し戻す
    camera.position.x *= 0.95;
    camera.position.y *= 0.95;

    // ログ表示と接触音を間引いて出力
    if (Math.random() < 0.1) AudioSys.playScrape();
    if (Math.random() < 0.05) {
      addLog("SYS WARNING: HULL CONTACT DETECTED", "warning");
    }
  }

  // オブジェクトとの衝突判定
  const camBox = new THREE.Box3().setFromCenterAndSize(
    camera.position,
    new THREE.Vector3(1, 1, 1),
  );

  hazards.forEach((h) => {
    if (h.active) {
      const hBox = new THREE.Box3().setFromObject(h.mesh);
      if (camBox.intersectsBox(hBox)) {
        hp -= 15;
        shakeIntensity = 0.7; // 障害物衝突時は大きな画面ブレ
        h.active = false;
        h.counted = true;
        collidedCount++;
        h.mesh.visible = false;
        AudioSys.playDamage();

        if (h.type === "sediment") {
          addLog("SYS DANGER: SEDIMENT COLLISION DETECTED (-15%)", "danger");
        } else if (h.type === "roots") {
          addLog("SYS DANGER: TREE ROOT COLLISION DETECTED (-15%)", "danger");
        } else {
          addLog("SYS DANGER: LEAK COLLISION DETECTED (-15%)", "danger");
        }
      }
    }
  });

  // マンホール整備ポイントの通過判定（回復＋豆知識）
  manholes.forEach((m) => {
    if (!m.passed && camera.position.z < m.z) {
      m.passed = true;
      hp = Math.min(100, hp + 15);
      AudioSys.playHeal();
      addLog("MAINTENANCE POINT: INTEGRITY +15%");
      showInfoCard(
        "マンホール整備ポイント通過！ (体力+15%)",
        `【土木マメ知識】${TRIVIA[triviaIdx % TRIVIA.length]}`,
        "trivia",
      );
      triviaIdx++;
    }
  });

  // 見逃し（スキャンせず通過）のカウント
  checkPassedObjects();

  // コンボの時間切れ判定
  if (combo > 0 && performance.now() > comboExpire) {
    combo = 0;
    updateComboUI();
  }

  // 死亡判定
  if (hp <= 0) {
    updateUI();
    isGameOver = true;
    AudioSys.setDrone(false);
    AudioSys.playGameOver();
    updatePauseBtn();

    // 最終リザルトをゲームオーバー画面に設定
    document.getElementById("failDistance").innerText =
      `${Math.floor(distance)}m`;
    document.getElementById("failScore").innerText = score;

    // 墜落しても、それまでの点検成果は無駄ではないことを伝える（土木PR）
    const salvageEl = document.getElementById("failSalvage");
    if (salvageEl) {
      const households = inspectedCount * HOUSEHOLDS_PER_FIND;
      salvageEl.innerText =
        inspectedCount > 0
          ? `でも、ここまでに見つけた ${inspectedCount} 件の異常のおかげで、およそ ${households} 世帯の暮らしを守れたよ。`
          : "異常を1件でも見つけられれば、その先の暮らしを守ることができる。次はきっと見つかる！";
    }

    // ゲームオーバー画面を表示
    const gameOverScreen = document.getElementById("gameOverScreen");
    if (gameOverScreen) {
      gameOverScreen.style.display = "flex";
      gameOverScreen.offsetHeight;
      gameOverScreen.style.opacity = 1;
    }
    return;
  }

  updateUI();

  // レンダリング直前に画面ブレ（一時的にカメラ位置をずらす）を適用
  let shakeX = 0;
  let shakeY = 0;
  if (shakeIntensity > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity;
    shakeY = (Math.random() - 0.5) * shakeIntensity;
    camera.position.x += shakeX;
    camera.position.y += shakeY;
  }

  renderer.render(scene, camera);

  // 描画後に元の位置に戻す
  if (shakeIntensity > 0) {
    camera.position.x -= shakeX;
    camera.position.y -= shakeY;

    // 画面ブレの減衰
    shakeIntensity *= 0.85;
    if (shakeIntensity < 0.01) {
      shakeIntensity = 0;
    }
  }
}

// リサイズ対応
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ゲーム開始
animate();
