// ============================================================
// js/render-overlay.js — 描画：画面に重ねる演出・点検 QTE の表示・体力ゲージ
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 描画：画面に重ねる演出（スピード線・コンボ・大きな文字・フラッシュなど）
// ============================================================
// ------------------------------------------------------------
// 体力ゲージ：ドローンを囲む 24 個に区切った輪
//   残りの体力ぶんだけ色がつく（緑 → 黄 → 赤。少ないと点滅）。上から時計回りに減る
//   ダメージの瞬間は白く光って揺れ、回復は緑に光る。変化したあとしばらく数値を出す
// ------------------------------------------------------------
const HP_SEGMENTS = 24;
let hpLastSeen = 100;
let hpHitUntil = 0; // この時刻まで「ダメージで白く光る」
let hpHealUntil = 0; // この時刻まで「回復で緑に光る」
let hpLabelUntil = 0; // この時刻まで数値を出す

function drawHpRing(dp, now) {
  // 体力の変化を見つけて演出のタイマーを入れる
  if (hp < hpLastSeen - 0.05) {
    if (hpLastSeen - hp > 2) hpHitUntil = now + 250; // 大きなダメージだけ光らせる（壁のこすりは光らせない）
    hpLabelUntil = now + 1500;
  } else if (hp > hpLastSeen + 0.05) {
    hpHealUntil = now + 500;
    hpLabelUntil = now + 1500;
  }
  hpLastSeen = hp;

  const safeHp = Math.max(0, Math.min(100, hp));
  const hit = now < hpHitUntil;
  const heal = now < hpHealUntil;
  const r = Math.max(14, Math.round(DRONE_W * dp.s * 0.62));
  const jx = hit ? randInt(-1, 1) : 0;
  const jy = hit ? randInt(-1, 1) : 0;
  const cx = Math.round(dp.x) + jx;
  const cy = Math.round(dp.y) + jy;

  let color = safeHp > 50 ? "#6dff7a" : safeHp > 20 ? "#ffe14d" : "#ff4d6d";
  if (safeHp <= 20 && Math.floor(now / 150) % 2 === 0) color = "#ff9aa9";
  if (heal) color = "#b8ffc0";
  if (hit) color = "#ffffff";

  const filled = Math.ceil((safeHp / 100) * HP_SEGMENTS);
  const seg = TAU / HP_SEGMENTS;
  const gap = 0.07; // 区切りのすき間（ラジアン）
  const step = 1 / r; // ドットの間隔（ラジアン）
  for (let pass = 0; pass < 2; pass++) {
    // 1回目：暗い影（明るい背景でも見えるように） / 2回目：本体
    for (let j = 0; j < HP_SEGMENTS; j++) {
      const on = j < filled;
      if (pass === 0) ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      else ctx.fillStyle = on ? color : "rgba(58, 68, 88, 0.85)";
      const a0 = -Math.PI / 2 + j * seg + gap / 2;
      const a1 = a0 + seg - gap;
      for (let a = a0; a <= a1; a += step) {
        const x = Math.round(cx + Math.cos(a) * r) - 1 + (pass === 0 ? 1 : 0);
        const y = Math.round(cy + Math.sin(a) * r) - 1 + (pass === 0 ? 1 : 0);
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  if (now < hpLabelUntil) {
    drawText(`${Math.ceil(safeHp)}%`, cx, cy + r + 4, 1, hit ? "#ffffff" : color);
  }
}

// ドット単位の直線（size でドットの大きさ＝線の太さ）
function pixelLine(x0, y0, x1, y1, size = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) {
    ctx.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), size, size);
  }
}

// ------------------------------------------------------------
// 点検 QTE の表示：ピントの枠と縮む輪・映画の黒帯・周りを暗く・判定の文字
// 近づいてくる点検ポイントには黄色い「!」を出して、避けるだけの障害物と見分ける
// ------------------------------------------------------------
let ditherPattern = null;
function getDitherPattern() {
  if (!ditherPattern) {
    const c = makeCanvas(2, 2);
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
    ditherPattern = ctx.createPattern(c, "repeat");
  }
  return ditherPattern;
}

// ドットで描く円（dashed で点線）
function pixelCircle(cx, cy, r, color, size = 1, dashed = false) {
  const n = Math.max(12, Math.round(r * 6.3));
  ctx.fillStyle = color;
  for (let j = 0; j < n; j++) {
    if (dashed && j % 3 === 0) continue;
    const a = (j / n) * TAU;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r - size / 2), Math.round(cy + Math.sin(a) * r - size / 2), size, size);
  }
}

function renderQte(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;

  // 近づいてくる点検ポイントの「!」マーク
  if (isGameStarted && !isGameOver && countdown <= 0) {
    qteTargets.forEach((o) => {
      if (o.qteStarted) return;
      const p = qteTargetPos(o);
      const q = project(p.x, p.y, p.z);
      if (!q || q.dz > 170) return;
      const scale = q.dz < 90 ? 2 : 1;
      const bounce = Math.round(Math.abs(Math.sin(now * 0.008)) * 3);
      const top = o.kind === "decal" ? 0 : (o.h * q.s) / 2;
      if (Math.floor(now / 150) % 4 !== 0) {
        drawText("!", q.x, q.y - top - 9 * scale - bounce, scale, "#ffe14d");
      }
    });
  }

  const k = slowAmount();
  if (k <= 0.01) return;

  // 対象の画面上の位置（輪が画面からはみ出さないようにおさえる）
  let cx = W / 2;
  let cy = H / 2;
  if (qte) {
    const p = qteTargetPos(qte.obj);
    const q = project(p.x, p.y, p.z);
    if (q) {
      cx = q.x;
      cy = q.y;
    }
  }
  const m = QTE_RING_START + 6;
  cx = Math.max(m, Math.min(W - m, cx));
  cy = Math.max(m + 12, Math.min(H - m - 12, cy));

  // 周りを網目で暗くする（対象のまわりの四角はあけておく）
  const x0 = Math.round(cx - m);
  const x1 = Math.round(cx + m);
  const y0 = Math.round(cy - m);
  const y1 = Math.round(cy + m);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.fillStyle = getDitherPattern();
  ctx.fillRect(0, 0, W, y0);
  ctx.fillRect(0, y1, W, H - y1);
  ctx.fillRect(0, y0, x0, y1 - y0);
  ctx.fillRect(x1, y0, W - x1, y1 - y0);
  ctx.restore();

  // 映画のような黒帯
  const bar = Math.round(16 * k);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);

  if (!qte) return;

  if (!qte.result) {
    // ピントの枠（白い点線の円と四隅）
    pixelCircle(cx, cy, QTE_RING_TARGET, "#ffffff", 1, true);
    const b = QTE_RING_TARGET + 5;
    drawBracket(cx - b, cy - b, cx + b, cy + b, "#ffffff");
    // 縮んでいく輪（ぴったりに近いほど緑になる）
    const err = Math.abs(qte.t - qte.perfectAt);
    const col = err <= diff.qtePerfect ? "#6dff7a" : err <= diff.qteGood ? "#ffe14d" : "#ff9a3c";
    pixelCircle(cx, cy, qteRingRadius(qte), col, 2);
    drawText(QTE_LABELS[qte.obj.type] || "", cx, cy - QTE_RING_START - 11, 1, "#ffffff");
    if (qte.tutorial) {
      // チュートリアル：練習中であることと、押すタイミング（NOW!）を見せる
      drawText("PRACTICE", cx, cy - QTE_RING_START - 21, 1, "#6dff7a");
      if (err <= diff.qteGood) drawText("NOW!", cx, cy - 4, 1, "#6dff7a");
    }
    // 操作の案内は下の黒帯に（上の黒帯はポーズボタンと重なるので使わない）
    if (bar >= 12) {
      if (Math.floor(now / 200) % 2 === 0) {
        drawText(`PRESS ${Pad.connected ? "A" : "SPACE"}`, W / 2, H - 12, 1, "#ffffff");
      }
    }
  } else {
    // 判定の文字
    const res = qte.result;
    const rise = Math.min(1, qte.resultT / 0.25);
    const col =
      res === "PERFECT"
        ? rainbowShift(Math.floor(now / 70))
        : res === "GOOD"
          ? "#ffe14d"
          : res === "RETRY"
            ? "#ff9a3c"
            : "#ff4d6d";
    const text = res === "MISS" ? "MISS..." : res === "RETRY" ? "TRY AGAIN" : `${res}!`;
    drawText(text, cx, cy - 6 - rise * 10, 2, col);
  }
}

function renderOverlay(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;

  // スピード線
  ctx.fillStyle = "rgba(220, 240, 255, 0.55)";
  FX.lines.forEach((l) => {
    const c = Math.cos(l.ang);
    const s = Math.sin(l.ang);
    pixelLine(W / 2 + c * l.r, H / 2 + s * l.r, W / 2 + c * (l.r + l.len), H / 2 + s * (l.r + l.len));
  });

  // 点検 QTE（「!」マーク・ピント合わせ・黒帯）
  if (cityStart < 0) renderQte(now);

  // 大雨警報中：画面の上下に赤と青の警告灯
  if (sirenTime > 0) {
    const on = Math.floor(now / 180) % 2 === 0;
    ctx.fillStyle = on ? "rgba(255, 40, 60, 0.55)" : "rgba(40, 120, 255, 0.55)";
    for (let x = 0; x < W; x += 2) {
      ctx.fillRect(x, 0, 1, 3);
      ctx.fillRect(x + 1, H - 3, 1, 3);
    }
  }

  // コンボ ×5：画面のふちを虹色に光らせる
  if (combo >= COMBO_MAX_MULT && isGameStarted && !isGameOver) {
    const k = Math.floor(now / 80);
    for (let x = 0; x < W; x += 3) {
      ctx.fillStyle = RAINBOW[(Math.floor(x / 6) + k) % RAINBOW.length];
      ctx.fillRect(x, 0, 2, 2);
      ctx.fillRect(W - 1 - x, H - 2, 2, 2);
    }
    for (let y = 0; y < H; y += 3) {
      ctx.fillStyle = RAINBOW[(Math.floor(y / 6) + k) % RAINBOW.length];
      ctx.fillRect(0, H - 1 - y, 2, 2);
      ctx.fillRect(W - 2, y, 2, 2);
    }
  }

  // 体力が少ないとき：画面のふちが赤く脈打つ
  if (isGameStarted && !isGameOver && hp < 30) {
    const a = 0.25 + 0.2 * Math.sin(now * 0.012);
    ctx.fillStyle = `rgba(255, 30, 40, ${a})`;
    for (let d = 0; d < 6; d += 2) {
      ctx.fillRect(d, d, W - d * 2, 1);
      ctx.fillRect(d, H - 1 - d, W - d * 2, 1);
      ctx.fillRect(d, d, 1, H - d * 2);
      ctx.fillRect(W - 1 - d, d, 1, H - d * 2);
    }
  }

  // コンボ表示（段階が上がるほど大きく・派手に・揺れる）
  if (combo >= 2 && isGameStarted && !isGameOver) {
    const lv = Math.min(combo, COMBO_MAX_MULT);
    const scale = lv >= 4 ? 2 : 1;
    const pop = FX.comboPop > 0 ? 1 : 0;
    const shake = lv >= 3 ? (lv - 2) * 0.8 : 0;
    const colors =
      lv >= 5 ? rainbowShift(Math.floor(now / 70)) : lv >= 4 ? "#ff9a3c" : lv >= 3 ? "#ffe14d" : "#ffffff";
    drawText(
      `COMBO x${lv}`,
      W / 2 + (Math.random() - 0.5) * shake * 2,
      H - 20 - pop * 3 + (Math.random() - 0.5) * shake * 2,
      scale + pop,
      colors,
    );
  }

  // 画面中央の大きな文字（カウントダウン・ゾーン・警報など）
  const bn = FX.banner;
  if (bn) {
    const popIn = bn.age < 0.12 ? 1 : 0;
    const fade = bn.age > bn.dur - 0.25;
    if (!fade || Math.floor(now / 50) % 2 === 0) {
      const color = bn.color === "rainbow" ? rainbowShift(Math.floor(now / 70)) : bn.color;
      drawText(bn.text, W / 2, H * 0.3 - popIn * 2, bn.scale + popIn, color);
      if (bn.sub) drawText(bn.sub, W / 2, H * 0.3 + bn.scale * 9 + 4, 1, "#ffffff");
    }
  }

  // 衝突で入った画面のヒビ（しばらくはっきり見せ、最後はチカチカしながら消える）
  FX.cracks.forEach((c) => {
    const left = CRACK_TIME - c.age;
    if (left < 0.5 && Math.floor(now / 60) % 2 === 0) return;
    const a = left < 0.5 ? left / 0.5 : 1;
    const drawLines = (dx, dy) => {
      c.lines.forEach((l) => {
        for (let k = 1; k < l.pts.length; k++) {
          pixelLine(l.pts[k - 1][0] + dx, l.pts[k - 1][1] + dy, l.pts[k][0] + dx, l.pts[k][1] + dy, l.size);
        }
      });
    };
    // 暗い影を少しずらして描いてから、白い割れ目を描く（明るい場面でも見えるように）
    ctx.fillStyle = `rgba(0, 0, 0, ${0.55 * a})`;
    drawLines(1, 1);
    ctx.fillStyle = `rgba(235, 248, 255, ${0.95 * a})`;
    drawLines(0, 0);
    // 衝突点の白い星
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
    ctx.fillRect(Math.round(c.cx) - 2, Math.round(c.cy) - 2, 5, 5);
  });

  // フラッシュ（点検は白、衝突は赤）
  if (FX.flashA > 0) {
    ctx.fillStyle = `rgba(${FX.flashRGB}, ${Math.min(1, FX.flashA)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

