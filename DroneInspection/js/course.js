// ============================================================
// js/course.js — コース：区間（ゾーン）・管の曲がり・増水
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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
  const k = env * diff.curveMul; // 難易度でカーブの強さを変える
  out.x = k * (14 * Math.sin(d * 0.0105) + 6 * Math.sin(d * 0.0231 + 1.3));
  out.y = k * (4 * Math.sin(d * 0.0083 + 0.7));
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
// 増水で上がる高さは難易度ごとに決める（diff.floodRise）
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

