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

