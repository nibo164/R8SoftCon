// ============================================================
// js/objects.js — 障害物と壁の異常の生成・難易度・配置・マンホール
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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

// ============================================================
// 難易度（タイトル画面で選ぶ。数値だけを変えて、コースの形は同じ）
//   qteCount     : 点検ポイントの数         dodgeCount : 避けるだけの障害物の数
//   speedMul     : スピードの倍率           curveMul   : カーブの強さの倍率
//   floodRise    : 増水で上がる水位         damageMul  : ダメージの倍率
//   qteSlow      : スロー中の時間の進み     qtePerfect / qteGood : 判定の幅（秒）
//   ringTime     : 輪がピントの枠に重なるまでの時間（秒）[最小, 最大]
//   tutorial     : 1回目の QTE を練習にする（EASY のみ）
// ============================================================
const DIFFICULTIES = {
  easy: {
    key: "easy",
    label: "EASY",
    jp: "かんたん",
    qteCount: 7,
    dodgeCount: 10,
    speedMul: 0.8,
    curveMul: 0.6,
    floodRise: 3.0,
    damageMul: 0.7,
    qteSlow: 0.05,
    qtePerfect: 0.12,
    qteGood: 0.32,
    ringTime: [1.2, 1.5],
    tutorial: true,
  },
  normal: {
    key: "normal",
    label: "NORMAL",
    jp: "ふつう",
    qteCount: 9,
    dodgeCount: 18,
    speedMul: 1.0,
    curveMul: 1.0,
    floodRise: 4.2,
    damageMul: 1.0,
    qteSlow: 0.08,
    qtePerfect: 0.08,
    qteGood: 0.22,
    ringTime: [1.0, 1.3],
    tutorial: false,
  },
  hard: {
    key: "hard",
    label: "HARD",
    jp: "むずかしい",
    qteCount: 12,
    dodgeCount: 24,
    speedMul: 1.2,
    curveMul: 1.3,
    floodRise: 5.5,
    damageMul: 1.3,
    qteSlow: 0.12,
    qtePerfect: 0.06,
    qteGood: 0.16,
    ringTime: [0.8, 1.0],
    tutorial: false,
  },
};
const DIFFICULTY_ORDER = ["easy", "normal", "hard"];
let diff = DIFFICULTIES.normal; // いま選ばれている難易度

// ダメージに難易度の倍率を掛ける
function dmg(v) {
  return v * diff.damageMul;
}

// ============================================================
// 配置（ゲームを始めるたびに、選んだ難易度で並べ直す）
//   点検ポイント（QTE の対象）：近づくとスローモーションになり、
//     ピント合わせのタイミング押しで点検する。6種類を最低1回ずつ出す
//   避けるだけの障害物：QTE の地点の前後には置かない（スロー中・直後に来ると理不尽なので）
// ============================================================
const Z_PER_METER = 10; // Z座標10単位 = 1メートル（ゲーム状態の zToMeterRatio と同じ値）
const MANHOLE_METERS = [75, 150, 225]; // マンホール（チェックポイント）の位置[m]
const qteTargets = []; // QTE の対象（手前から順）

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createByType(type, z) {
  switch (type) {
    case "leak":
      return createLeak(z);
    case "sediment":
      return createSediment(z);
    case "roots":
      return createRoots(z);
    case "corrosion":
      return createCorrosion(z);
    case "crack":
      return createCrack(z);
    default:
      return createRebar(z);
  }
}
const HAZARD_TYPES = ["leak", "sediment", "roots"];

function placeObjects(d) {
  hazards.length = 0;
  anomalies.length = 0;
  qteTargets.length = 0;

  // 点検ポイント：30m〜280m にほぼ等間隔（少しずらす）。チェックポイントとは重ねない
  const n = d.qteCount;
  const extra = [];
  for (let i = CODEX_ORDER.length; i < n; i++) extra.push(pick(CODEX_ORDER));
  const types = shuffle(CODEX_ORDER.slice(0, Math.min(n, CODEX_ORDER.length)).concat(extra));
  const qteMeters = [];
  for (let i = 0; i < n; i++) {
    let m = 30 + (i * 250) / (n - 1) + (Math.random() - 0.5) * 6;
    // チェックポイントに近ければ、今いる側へ押し出す（次の点検ポイントに近づきすぎないように）
    MANHOLE_METERS.forEach((mh) => {
      if (Math.abs(m - mh) < 7) m = m < mh ? mh - 7 : mh + 7;
    });
    qteMeters.push(m);
    const type = types[i];
    const obj = createByType(type, -m * Z_PER_METER);
    obj.qte = true;
    registerObject(HAZARD_TYPES.includes(type) ? hazards : anomalies, obj, type);
    qteTargets.push(obj);
  }

  // 避けるだけの障害物：QTE の地点の前 8m・後ろ 4m と、チェックポイントの近くは避ける
  let placed = 0;
  let tries = 0;
  while (placed < d.dodgeCount && tries < 2000) {
    tries++;
    const m = 15 + Math.random() * 275;
    if (qteMeters.some((q) => m > q - 8 && m < q + 4)) continue;
    if (MANHOLE_METERS.some((mh) => Math.abs(m - mh) < 4)) continue;
    const type = pick(HAZARD_TYPES);
    const obj = createByType(type, -m * Z_PER_METER);
    obj.qte = false;
    registerObject(hazards, obj, type);
    placed++;
  }
}
placeObjects(diff); // タイトル画面の背景用（開始時に選んだ難易度で並べ直す）

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

