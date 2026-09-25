// ============================================================
// js/render-tunnel.js — 描画：投影と下水管（1ピクセルずつ視線と管の交点を求める）
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 描画：投影
//   スプライトは傾き（ロール）なしで計算し、最後にキャンバスを回転させて描く。
//   管のピクセルは逆回転して求める。
// ============================================================
let camRoll = 0;
let camPitch = 0;
let renderCam = { x: 0, y: 0, z: 0 }; // 画面ブレ込みの描画用カメラ位置
let frameSprites = []; // 直前のフレームで描いたスプライト（点検判定に使う）
let frameDecals = []; // 直前のフレームで見えていたデカール

// ワールド座標 → 画面座標（ロールなし）。奥行き dz も返す
function project(x, y, z) {
  const dz = renderCam.z - z;
  if (dz < 0.5) return null;
  bendAt(dz);
  const s = focal / dz;
  return {
    x: SCREEN_W / 2 + (x - renderCam.x + BX) * s,
    y: SCREEN_H / 2 - (y - renderCam.y + BY) * s + camPitch * focal,
    s: s,
    dz: dz,
  };
}

// 奥行き dz の位置での水面の高さ（画面の y 座標）
function waterlineY(dz) {
  bendAt(dz);
  return SCREEN_H / 2 - (waterLevel - renderCam.y + BY) * (focal / dz) + camPitch * focal;
}

// ヘッドライト（スポットライト）の当たり具合
//   cosTheta: 視線と正面のなす角の cos / dist: 距離
function headlight(cosTheta, dist) {
  if (dist >= 150) return 0;
  let spot = (cosTheta - 0.62) / (0.9 - 0.62);
  if (spot <= 0) return 0;
  if (spot > 1) spot = 1;
  spot = spot * spot * (3 - 2 * spot);
  return spot * Math.pow(1 - dist / 150, 0.8);
}
const AMBIENT = 0.12;
function ambientAt(dist) {
  return dist < 400 ? AMBIENT * (1 - dist / 400) : 0;
}

// スプライト用：画面上の位置と距離から明るさの段階を決める
function spriteLevel(sx, sy, dz, z) {
  const ox = (sx - SCREEN_W / 2) / focal;
  const oy = (sy - SCREEN_H / 2) / focal;
  const cosT = 1 / Math.sqrt(1 + ox * ox + oy * oy);
  let lum = 1.1 * headlight(cosT, dz) + ambientAt(dz);
  manholes.forEach((m) => {
    const d = Math.abs(m.z - z);
    if (d < MANHOLE_LIGHT_RANGE) {
      const k = 1 - d / MANHOLE_LIGHT_RANGE;
      lum += 0.9 * k * k;
    }
  });
  const lamp = ZONES[zoneIndexAt(z)].lamp;
  if (lamp) lum += 0.25;
  return Math.max(0, Math.min(LIGHT_LEVELS, Math.round(lum * LIGHT_LEVELS)));
}

// ============================================================
// 描画：下水管（1ピクセルずつ視線と管の交点を求める）
// ============================================================
// 奥行き t の点が管の内側か（曲がった管用）
function insideTube(t, du, dv, cx, cy, R2) {
  bendAt(t);
  const x = cx + t * du - BX;
  const y = cy + t * dv - BY;
  return x * x + y * y < R2;
}
// 曲がった管との交点：まっすぐな管としての交点 t0 を手がかりに二分探索する
function curvedHit(du, dv, t0, cx, cy, R2) {
  // その奥行きで管がほとんどずれていなければ、まっすぐな管の答えで十分
  bendAt(t0);
  if (Math.abs(BX) + Math.abs(BY) < 0.03) return t0;
  let lo = 0;
  let hi = t0;
  if (insideTube(hi, du, dv, cx, cy, R2)) {
    // 管がこちらへ曲がってきている → もっと先で壁に当たる
    lo = hi;
    hi = hi * 1.5 + 4;
    while (hi < BEND_MAX && insideTube(hi, du, dv, cx, cy, R2)) {
      lo = hi;
      hi = hi * 1.5 + 4;
    }
    if (hi >= BEND_MAX) {
      if (insideTube(BEND_MAX, du, dv, cx, cy, R2)) return 1e5;
      hi = BEND_MAX;
    }
  } else if (insideTube(hi * 0.6, du, dv, cx, cy, R2)) {
    lo = hi * 0.6; // 探す範囲をせばめて回数を減らす
  }
  // 遠いピクセルほど粗い精度で打ち切る（画面上では違いが見えない）
  for (let k = 0; k < 8 && hi - lo > hi * 0.02 + 0.05; k++) {
    const m = (lo + hi) * 0.5;
    if (insideTube(m, du, dv, cx, cy, R2)) lo = m;
    else hi = m;
  }
  return hi;
}

function renderTunnel(now) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  const R = pipeRadius;
  const R2 = R * R;
  const invR = 1 / R;
  const cx = renderCam.x;
  const cy = renderCam.y;
  const cz = renderCam.z;
  const cr = Math.cos(camRoll);
  const sr = Math.sin(camRoll);
  const pitchOff = camPitch * focal;
  const invF = 1 / focal;
  const cc = cx * cx + cy * cy - R2; // 管の内側なら負
  const L = waterLevel;
  const camAboveWater = cy > L + 0.05;

  // 見えている範囲のデカール（壁の異常）を集める
  frameDecals = anomalies.filter(
    (o) => o.visible && o.z < cz + o.half + 1 && o.z > cz - 170,
  );
  const nd = frameDecals.length;

  // 近くのマンホール（天井の穴と照明）
  let mh = null;
  manholes.forEach((m) => {
    if (m.z < cz + MANHOLE_LIGHT_RANGE && m.z > cz - 220) mh = mh || m;
  });
  const mhz = mh ? mh.z : 0;
  const lightY = R - 2;

  // 増水中は水が速く流れ、茶色くにごる
  const waterShift = now * 0.01 * (1 + 3 * floodK);
  const buf = frameBuf32;

  let i = 0;
  for (let py = 0; py < H; py++) {
    const oy = py - H / 2 + 0.5;
    const bayerRow = (py & 3) * 4;
    for (let px = 0; px < W; px++, i++) {
      const ox = px - W / 2 + 0.5;
      // 画面の傾きを戻して、視線の向きを求める
      const ux = ox * cr + oy * sr;
      const uy = -ox * sr + oy * cr;
      const du = ux * invF;
      const dv = (pitchOff - uy) * invF;
      const a = du * du + dv * dv;

      // まっすぐな円柱 (x^2 + y^2 = R^2) との交点までの奥行き t
      let t = 1e5;
      if (a > 1e-10) {
        const b = cx * du + cy * dv;
        let disc = b * b - a * cc;
        if (disc < 0) disc = 0;
        t = (-b + Math.sqrt(disc)) / a;
      }
      // 管が曲がっているときは、曲がりを考慮して交点を探し直す
      if (courseCurving && t < 1e4) t = curvedHit(du, dv, t, cx, cy, R2);
      idBuf[i] = 0;

      // 遠すぎる場所は真っ暗
      if (t > 400) {
        depthBuf[i] = t;
        buf[i] = 0xff000000;
        continue;
      }

      bendAt(t);
      let hx = cx + t * du - BX;
      let hy = cy + t * dv - BY;
      let wz = cz - t;
      let ldu = du - BDX; // 管に対する視線の向き（曲がりを考慮）
      let ldv = dv - BDY;

      // 水面との交点（壁に当たる前に水面に当たるか）
      let isWater = false;
      if (camAboveWater && hy < L) {
        let tw;
        if (!courseCurving) {
          tw = (L - cy) / dv;
        } else {
          let lo = 0;
          let hi = t;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) * 0.5;
            bendAt(m);
            if (cy + m * dv - BY > L) lo = m;
            else hi = m;
          }
          tw = hi;
        }
        t = tw;
        bendAt(t);
        hx = cx + t * du - BX;
        hy = L;
        wz = cz - t;
        ldu = du - BDX;
        ldv = dv - BDY;
        isWater = true;
      }
      depthBuf[i] = t;
      const zi = zoneIndexAt(wz);
      const lamp = ZONES[zi].lamp;

      let ang = 0;
      let tr, tg, tb;
      let addR = 0;
      let addG = 0;
      let addB = 0;

      if (isWater) {
        const wu = Math.floor(hx * 3) & (WATER_TEX - 1);
        const wv = Math.floor(wz * 3 + waterShift) & (WATER_TEX - 1);
        const p = (wv * WATER_TEX + wu) * 4;
        tr = waterTex[p];
        tg = waterTex[p + 1];
        tb = waterTex[p + 2];
        if (floodK > 0) {
          // 増水中の濁った水（茶色に寄せる）
          const k = floodK * 0.7;
          tr += (96 - tr) * k;
          tg += (78 - tg) * k;
          tb += (48 - tb) * k;
        }
      } else {
        ang = Math.atan2(hy, hx);

        // マンホールの穴（地上の光がそのまま見える）
        if (mh && hy > 0) {
          const dzm = wz - mhz;
          const rr = hx * hx + dzm * dzm;
          if (rr < MANHOLE_HOLE_R * MANHOLE_HOLE_R) {
            buf[i] = BAYER4[bayerRow + (px & 3)] < 0.25 ? 0xffd8f4ff : 0xffb0ecff;
            continue;
          }
          if (rr < 7) {
            buf[i] = 0xff282c30; // 鉄のふち
            continue;
          }
        }

        // 壁のランプ（光っている部分はそのまま明るく描く）
        if (lamp) {
          const P = lamp.every;
          const dzl = (((wz % P) + P) % P) - P / 2;
          if (dzl > -0.45 && dzl < 0.45) {
            let onLamp = false;
            for (let k = 0; k < lamp.angs.length; k++) {
              const da = (ang - lamp.angs[k]) * R;
              if (da > -0.7 && da < 0.7) onLamp = true;
            }
            if (onLamp) {
              const c = lamp.color;
              buf[i] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
              continue;
            }
          }
        }

        const tex = zoneTextures[zi];
        const tu = Math.floor(ang * TEX_U_SCALE) & (TEX - 1);
        const tv = Math.floor(wz * TEX_V_SCALE) & (TEX - 1);
        const p = (tv * TEX + tu) * 4;
        tr = tex[p];
        tg = tex[p + 1];
        tb = tex[p + 2];

        // 壁の異常（デカール）を重ねる
        for (let k = 0; k < nd; k++) {
          const o = frameDecals[k];
          const dzd = wz - o.z;
          if (dzd <= -o.half || dzd >= o.half) continue;
          let da = ang - o.ang;
          if (da > Math.PI) da -= TAU;
          else if (da < -Math.PI) da += TAU;
          const s = da * R;
          if (s <= -o.half || s >= o.half) continue;
          const img = o.img;
          const iu = ((s + o.half) * o.texel) | 0;
          const iv = ((dzd + o.half) * o.texel) | 0;
          const q = (iv * img.w + iu) * 4;
          if (img.data[q + 3]) {
            tr = img.data[q];
            tg = img.data[q + 1];
            tb = img.data[q + 2];
            idBuf[i] = k + 1;
          }
        }
      }

      // 明るさ：ヘッドライト（スポット＋面への当たる角度）＋環境光
      const invLen = 1 / Math.sqrt(1 + a);
      const lInv = 1 / Math.sqrt(1 + ldu * ldu + ldv * ldv);
      let ndl = isWater ? -ldv * lInv : (hx * ldu + hy * ldv) * invR * lInv;
      if (ndl < 0) ndl = 0;
      let lum = 2.4 * headlight(invLen, t) * ndl + ambientAt(t);
      if (isWater) lum = lum * 1.2 + 0.04;

      // マンホールから差し込む光（暖色）
      if (mh) {
        const ly = hy - lightY;
        const lz = wz - mhz;
        const d2 = hx * hx + ly * ly + lz * lz;
        if (d2 < MANHOLE_LIGHT_RANGE * MANHOLE_LIGHT_RANGE) {
          const k = 1 - Math.sqrt(d2) / MANHOLE_LIGHT_RANGE;
          const w = k * k;
          lum += w;
          addR += w * 40;
          addG += w * 28;
        }
      }

      // 壁のランプの光（ランプの近くだけ色つきで明るくなる）
      if (lamp) {
        const P = lamp.every;
        const dzl = (((wz % P) + P) % P) - P / 2;
        const k = 1 - Math.abs(dzl) / 5;
        if (k > 0) {
          // 遠くのランプの光は少し弱める（重なって画面が白く飛ばないように）
          const w = k * k * 0.4 * (t < 250 ? 1 - t / 350 : 0.3);
          lum += w * 0.5;
          addR += w * lamp.color[0] * 0.22;
          addG += w * lamp.color[1] * 0.22;
          addB += w * lamp.color[2] * 0.22;
        }
      }

      // 明るさを段階化（ディザで境目を網目にする）
      const q =
        Math.floor(lum * LIGHT_LEVELS + BAYER4[bayerRow + (px & 3)]) / LIGHT_LEVELS;
      let r = tr * q + addR;
      let g = tg * q + addG;
      let b = tb * q + addB;
      if (!camAboveWater) {
        // カメラが水中：青緑にくもらせる
        r = r * 0.4;
        g = g * 0.6 + 20;
        b = b * 0.6 + 30;
      }
      if (r > 255) r = 255;
      if (g > 255) g = 255;
      if (b > 255) b = 255;
      buf[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
  }
  ctx.putImageData(frameImage, 0, 0);
}

