// ============================================================
// js/pixelart.js — ドット絵の道具・管と水のテクスチャ・ドット文字・ドローンのドット絵
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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

