// ============================================================
// js/fx.js — 演出（破片・広がる輪・飛び出す数字・フラッシュ・ヒビ・スピード線・大きな文字）
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 演出（パーティクル・フラッシュ・文字・スピード線など）
// ============================================================
const CRACK_TIME = 1.8; // 画面のヒビが消えるまでの時間（秒）
const FX = {
  parts: [], // 破片・しぶき（ワールド座標）
  rings: [], // 点検したときの広がる輪（画面座標）
  pops: [], // 「+300」などの飛び出す数字（画面座標）
  cracks: [], // 衝突で画面に入るヒビ
  lines: [], // スピード線
  flashA: 0,
  flashRGB: "255,255,255",
  banner: null, // 画面中央の大きな文字
  comboPop: 0, // コンボが増えた瞬間に文字を大きくする残り時間

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.pops.length = 0;
    this.cracks.length = 0;
    this.flashA = 0;
    this.banner = null;
    this.comboPop = 0;
  },

  // 破片を飛び散らせる
  burst(x, y, z, colors, n, spd, life = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const e = Math.random() * 2 - 1;
      const v = spd * (0.4 + Math.random() * 0.8);
      const r = Math.sqrt(1 - e * e);
      this.parts.push({
        x: x,
        y: y,
        z: z,
        vx: Math.cos(a) * r * v,
        vy: e * v + spd * 0.3,
        vz: Math.sin(a) * r * v,
        life: life * (0.6 + Math.random() * 0.6),
        color: pick(colors),
        size: 0.12 + Math.random() * 0.18,
        grav: 14,
      });
    }
  },
  // 重力なしでその場に漂う粒（ドローンの噴射など）
  mote(x, y, z, vx, vy, vz, color, life, size) {
    this.parts.push({ x, y, z, vx, vy, vz, life, color, size, grav: 0 });
  },
  ring(sx, sy, color) {
    this.rings.push({ x: sx, y: sy, age: 0, color: color });
  },
  pop(sx, sy, text, color) {
    this.pops.push({ x: sx, y: sy, age: 0, text: text, color: color });
  },
  flash(rgb, a) {
    this.flashRGB = rgb;
    this.flashA = Math.max(this.flashA, a);
  },
  showBanner(text, sub, color, dur = 1.6, scale = 4) {
    this.banner = { text, sub, color, dur, scale, age: 0 };
  },
  // 画面のヒビ：ドローンのあたりの衝突点から、ガラスが割れたように放射状に広がる
  //   主な割れ目（太さ2）が画面の端まで伸び、枝分かれと蜘蛛の巣状の割れ目（太さ1）をつなぐ
  crack() {
    const W = SCREEN_W;
    const H = SCREEN_H;
    // 衝突点：ドローン（画面の中央やや下）のまわり
    const cx = W / 2 + randInt(-50, 50);
    const cy = H / 2 + 25 + randInt(-25, 12);
    const lines = [];
    const rays = [];
    const nRay = randInt(7, 10);
    const base = Math.random() * TAU;
    for (let r = 0; r < nRay; r++) {
      let ang = base + (r / nRay) * TAU + (Math.random() - 0.5) * 0.4;
      let x = cx;
      let y = cy;
      const pts = [[x, y]];
      for (let s = 0; s < 16; s++) {
        ang += (Math.random() - 0.5) * 0.5;
        const len = randInt(12, 22);
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        pts.push([x, y]);
        // 枝分かれ
        if (s >= 1 && Math.random() < 0.35) {
          let bx = x;
          let by = y;
          let ba = ang + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
          const bpts = [[bx, by]];
          for (let b = 0; b < randInt(2, 4); b++) {
            ba += (Math.random() - 0.5) * 0.5;
            bx += Math.cos(ba) * randInt(8, 14);
            by += Math.sin(ba) * randInt(8, 14);
            bpts.push([bx, by]);
          }
          lines.push({ pts: bpts, size: 1 });
        }
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) break;
      }
      rays.push(pts);
      lines.push({ pts: pts, size: 2 });
    }
    // 蜘蛛の巣状の割れ目：となりの割れ目どうしを、中心からの同じ段でつなぐ
    [1, 2, 4].forEach((level) => {
      for (let r = 0; r < nRay; r++) {
        const a = rays[r][level];
        const b = rays[(r + 1) % nRay][level];
        if (!a || !b || Math.random() < 0.25) continue;
        const mx = (a[0] + b[0]) / 2 + randInt(-4, 4);
        const my = (a[1] + b[1]) / 2 + randInt(-4, 4);
        lines.push({ pts: [a, [mx, my], b], size: 1 });
      }
    });
    this.cracks.push({ lines: lines, cx: cx, cy: cy, age: 0 });
  },

  // dt: 実時間（文字・フラッシュなど画面の演出） / wdt: ゲーム内の時間（破片・スピード線。スロー中は遅くなる）
  update(dt, speedFactor, wdt = dt) {
    // 破片
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= wdt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * wdt;
      p.x += p.vx * wdt;
      p.y += p.vy * wdt;
      p.z += p.vz * wdt;
    }
    this.rings = this.rings.filter((r) => (r.age += dt) < 0.4);
    this.pops = this.pops.filter((p) => (p.age += dt) < 0.9);
    this.cracks = this.cracks.filter((c) => (c.age += dt) < CRACK_TIME);
    this.flashA = Math.max(0, this.flashA - dt * 3.5);
    this.comboPop = Math.max(0, this.comboPop - dt);
    if (this.banner && (this.banner.age += dt) > this.banner.dur) this.banner = null;

    // スピード線：速いほど本数を増やし、速く流す
    const want = Math.round(speedFactor * 26);
    while (this.lines.length < want) {
      this.lines.push({ ang: Math.random() * TAU, r: 30 + Math.random() * 120, len: 6 + Math.random() * 14 });
    }
    if (this.lines.length > want) this.lines.length = want;
    const maxR = Math.hypot(SCREEN_W, SCREEN_H) / 2;
    this.lines.forEach((l) => {
      l.r += wdt * (160 + 320 * speedFactor) * (l.r / 80);
      if (l.r > maxR) {
        l.ang = Math.random() * TAU;
        l.r = 45 + Math.random() * 30;
      }
    });
  },
};

