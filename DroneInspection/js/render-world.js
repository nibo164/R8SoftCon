// ============================================================
// js/render-world.js — 描画：障害物・光の柱・破片・ドローン
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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

  // 体力ゲージ（ドローンを囲む円）
  if (dp && droneVisible && isGameStarted && !isGameOver) drawHpRing(dp, now);

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

