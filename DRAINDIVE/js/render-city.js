// ============================================================
// js/render-city.js — 描画：ゴール後の地上の街と、1フレーム分の描画（renderFrame）
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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

// ============================================================
// ゴールの縦穴：真下から見上げた画面
//   縦にまっすぐな管なので、管の描画と同じく「1ピクセルずつ視線と円筒の交点」を求めるだけ（曲がり・水はない）。
//   壁はコンクリートの輪（組み立て式のマンホール）で、片がわに はしごの足掛け（鉄の段）がある。
//   出口より先に届く視線は青空（出口の丸）になり、上るほど大きくなる
// ============================================================
const SHAFT_R = 4; // 縦穴の半径（天井の穴と同じ）
const SHAFT_DEPTH = 60; // 見上げはじめてから出口までの長さ（ワールド単位）
const SHAFT_RING = 6; // コンクリートの輪1つの高さ
const SHAFT_LADDER_ANG = -Math.PI / 2; // 足掛けがある向き（画面の上がわ）
let goalTilt = 0; // 0〜1：見上げる途中（1 で縦穴の画面だけになる）
let shaftDepth = 0; // 縦穴をどれだけ上ったか

// shaftY：縦穴の画面を描く縦位置（見上げる途中は上からずらして流し込む）
function renderShaft(now, shaftY) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  const buf = frameBuf32;
  const remain = SHAFT_DEPTH + 6 - shaftDepth; // 出口までの距離
  const cols = [
    [118, 122, 128],
    [108, 112, 118],
  ];
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5 - H / 2) / focal;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5 - W / 2) / focal;
      const r = Math.hypot(u, v);
      const t = r > 0 ? SHAFT_R / r : Infinity; // 視線が壁に当たるまでの距離
      const bayer = BAYER4[(py & 3) * 4 + (px & 3)];
      let cr, cg, cb;
      if (t > remain) {
        // 出口の青空（まんなかほど明るい）
        const k = Math.min(1, r * 6);
        cr = 190 + 50 * (1 - k);
        cg = 225 + 25 * (1 - k);
        cb = 255;
        if (bayer < 0.2) cr = cg = cb = 255;
      } else {
        const a = shaftDepth + t; // 壁の上での高さ
        const ang = Math.atan2(v, u);
        const ring = a / SHAFT_RING;
        const f = ring - Math.floor(ring);
        // 輪ごとに少し色を変え、ざらつき（骨材のつぶ）を散らす
        let c = cols[Math.floor(ring) & 1];
        let hsh = (Math.floor(ang * 20) * 374761393 + Math.floor(a * 3) * 668265263) | 0;
        hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177);
        const grain = ((hsh ^ (hsh >>> 16)) >>> 0) % 17;
        if (grain === 0) c = [92, 96, 102];
        else if (grain === 1) c = [138, 142, 148];
        if (f < 0.06) c = [44, 48, 54]; // 輪と輪の継ぎ目
        else if (f < 0.1) c = [150, 155, 160];
        // はしごの足掛け（コの字の鉄の段。輪1つに2段）
        let da = ang - SHAFT_LADDER_ANG;
        if (da > Math.PI) da -= TAU;
        else if (da < -Math.PI) da += TAU;
        const side = da * SHAFT_R; // 足掛けの中心からの横のずれ
        const step = (a / (SHAFT_RING / 2)) % 1;
        if (Math.abs(side) < 1.1 && step < 0.12) c = [224, 176, 60];
        else if (Math.abs(Math.abs(side) - 1.1) < 0.15 && step < 0.3) c = [170, 130, 40];
        // 明るさ：出口に近いほど明るく、遠くは暗い（段階をディザでつなぐ）
        const near = Math.max(0, 1 - (remain - t) / 60);
        const lit = 0.4 + 0.9 * near * near + 0.3 * Math.max(0, 1 - t / 25);
        const q = Math.min(LIGHT_LEVELS, Math.floor(lit * LIGHT_LEVELS + bayer)) / LIGHT_LEVELS;
        cr = c[0] * q;
        cg = c[1] * q;
        cb = c[2] * q;
      }
      buf[py * W + px] = 0xff000000 | (Math.min(255, cb) << 16) | (Math.min(255, cg) << 8) | Math.min(255, cr);
    }
  }
  ctx.putImageData(frameImage, 0, shaftY);

  // 上っていくドローン（真下から見上げている）
  const bob = Math.round(Math.sin(now * 0.008));
  const dw = 44;
  const dh = 22;
  const dy = Math.round(shaftY + H / 2 + 26 + bob);
  ctx.drawImage(droneFrames[Math.floor(now / 40) % 2], Math.round(W / 2 - dw / 2), dy - dh / 2, dw, dh);
}

// 1フレーム分を描画する（shakeX/Y: 画面ブレのずれ）
function renderFrame(shakeX = 0, shakeY = 0) {
  const now = performance.now();
  if (cityStart >= 0) {
    renderCity(now);
    renderOverlay(now);
    return;
  }
  // ゴールの縦穴を上っているあいだは、縦穴の画面だけ
  if (goalTilt >= 1) {
    renderShaft(now, 0);
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
  // 見上げる途中：管の画面は camPitch で下へずれているので、空いた上がわに縦穴の画面を流し込む
  if (goalTilt > 0) renderShaft(now, Math.round(-SCREEN_H * (1 - goalTilt)));
  renderOverlay(now);
}

