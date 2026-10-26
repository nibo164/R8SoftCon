// ============================================================
// js/boss.js — ラスボス：巨大な油のかたまり「ファットバーグ」
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// ラスボス（全難易度共通）
//   台所から流された油が管の中で冷えて固まり、ウェットティッシュなどとからまってできる巨大なかたまり。
//   実際に 2017 年のロンドンでは、長さ約 250m・重さ約 130 トンのものが見つかった。
//   流れ（ZONE 4 の中。ドローンはふだんの速さのまま進み続ける＝追いかけっこ）：
//     BOSS_WARN_AT で警報。ボスは管の奥を、ドローンより遅い速さで転がって進んでいる
//     → ドローンが追いつき、ボスとの間が BOSS_GAP になったらボス戦。ボスはその間をたもって同じ速さで進む
//     ボス戦：弱点の QTE（輪の数は難易度どおり）→ 油のしずくを後ろへ投げてくる（操縦でよける）をくり返す
//       弱点を BOSS_HP 回撮影すると撃破。BOSS_TIME 秒（実時間）たつか、BOSS_END_AT まで進んでも
//       撃破できなければ、高圧洗浄車（救援）が取りのぞく（ゲームは止めない）
//     撃破・救援の演出のあとは、そのままゴールへ
//   ボス・弱点・油のしずくはドローンといっしょに動くので、位置は毎フレーム cam.z から決める
//   弱点の成功数はランクの成功率に加える（点検ポイントが BOSS_HP か所ふえた扱い。ui.js の showClearScreen）
// ============================================================
const BOSS_WARN_AT = 318; // 警報を出す距離[m]（ZONE 4 の表示と重ならないよう少しあと）
const BOSS_START_GAP = 160; // 警報のときのボスとの間（ワールド単位。見えるぎりぎりの奥）
const BOSS_GAP = 40; // ボス戦中のボスとの間（ワールド単位。カメラからは 46）
const BOSS_APPROACH = 0.3; // 追いつくまでのボスの速さ（ドローンの速さに対する割合。約17mで追いつく）
const BOSS_END_AT = 530; // ここまで進んでも撃破できなければ救援[m]（ボスが消える演出が 550m のゴール前に終わるように）
const BOSS_PAUSE = 1.0; // 油を投げ終わってから次の弱点までの時間（ゲーム内の秒。短いほどボス戦で進む距離が短い）
const BOSS_HP = 5; // 撃破に必要な弱点の撮影回数
const BOSS_TIME = 32; // 制限時間（秒）
const BOSS_BONUS = 3000; // 撃破ボーナス
const BOSS_W = 21; // ボスの大きさ（ワールド単位。管の直径くらい）
const BOSS_H = 19;
const BOSS_THROWS = 2; // 弱点の QTE のあとに投げてくる油のしずくの数
const BLOB_SPEED = 42; // 油のしずくの速さ（1秒あたり）
const BLOB_DAMAGE = 6; // 油のしずくが当たったときのダメージ（ボス戦で墜落しにくいよう、障害物の 15 より小さい）
const FAT_COLORS = ["#e6dca8", "#c9bb7e", "#f4efd0", "#9c8e58"];
// 油の波（後半の攻撃）：管の底から盛り上がった油が押し寄せてくる。上に飛んでよける（しずくは左右でよける）
//   ※ 油が波になって押し寄せるのはゲームの演出（事実として説明しない）
// 攻撃の順番（撮影に成功した弱点の数で決める）：1つ目のあと しずく → 2つ目 波 → 3つ目 つらら → 4つ目 3つからランダム
//   （弱点をのがしたときは、撮影できた数が増えないので同じ攻撃をもう一度出す）
const BOSS_ATTACK_ORDER = ["blobs", "blobs", "wave", "icicle"];
const ATTACK_CHARGE = 0.6; // 波・つららを出す前にボスが震える時間（予告。ゲーム内の秒）
const WAVE_TOP = 2; // 波のてっぺんの高さ（管の中心が 0、底が -10。管の下 6 割くらいが波になる）
const WAVE_SPEED = 40; // 波がドローンに近づく速さ（ドローンから見た速さ。1秒あたり）
const WAVE_DAMAGE = 10; // 波に当たったときのダメージ（よける動きが大きいぶん、しずくより重い）
// 油のつらら：ボスが吐き上げた油が前方の天井にはりつき、つららの列になって垂れ下がる。下にもぐってよける
//   つららは天井に止まっていて、ドローンのほうが近づいていく（波のように動かない）
//   ※ 油がつららになるのはゲームの演出（事実として説明しない）
const ICICLE_AHEAD = 90; // つららができる位置（ドローンの前。ボスの向こう。約1秒で届く）
const ICICLE_TIP = -0.5; // つららの先の高さ（管の上半分より少し下まで。これより下を飛べばよけられる）
const ICICLE_GROW = 0.35; // つららが伸びきるまでの時間（秒）
const ICICLE_DAMAGE = 10;

// ------------------------------------------------------------
// ドット絵（油のかたまり本体・当たったときの白いシルエット・油のしずく）
// ------------------------------------------------------------
function createFatbergPixels() {
  const w = 44;
  const h = 38;
  const img = makePixels(w, h);
  const cols = ["#d9cf9c", "#d9cf9c", "#cfc38c", "#c2b57c"];
  // でこぼこした山の形（下はまっすぐ）
  for (let x = 0; x < w; x++) {
    const t = (x + 0.5 - w / 2) / (w / 2);
    const lump = Math.sin(x * 0.55) * 1.2 + Math.sin(x * 0.23 + 1) * 1.5;
    const top = Math.round(h - (h - 3) * Math.pow(Math.max(0, 1 - t * t), 0.55) - lump);
    for (let y = Math.max(0, top); y < h; y++) {
      const shade = y > h - 7 ? "#a89a62" : pick(cols);
      setPx(img, x, y, shade);
    }
  }
  // からまったウェットティッシュ（白っぽい短いすじ）とごみ（黒い点）
  for (let i = 0; i < 14; i++) {
    const x = randInt(4, w - 8);
    const y = randInt(10, h - 4);
    if (!getA(img, x, y)) continue;
    for (let k = 0; k < 4; k++) if (getA(img, x + k, y - (k >> 1))) setPx(img, x + k, y - (k >> 1), "#eeeee4");
  }
  for (let i = 0; i < 18; i++) {
    const x = randInt(2, w - 3);
    const y = randInt(8, h - 2);
    if (getA(img, x, y)) setPx(img, x, y, pick(["#6b5e36", "#5a5030", "#7d7048"]));
  }
  // てかり（油っぽさ）
  [
    [9, 17],
    [10, 17],
    [9, 18],
    [33, 16],
    [34, 16],
    [36, 22],
  ].forEach(([x, y]) => getA(img, x, y) && setPx(img, x, y, "#fffbe6"));
  // 怒った顔：つり上がったまゆ・目・ギザギザの口
  //   ドローンと体力の輪に隠れないよう、顔はかたまりの上のほうに描く
  const EYE_Y = 11;
  const eye = (cx, dir) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) setPx(img, cx + x, EYE_Y + y, "#ffffff");
    setPx(img, cx + 2 + dir, EYE_Y + 1, "#1a1408");
    setPx(img, cx + 2 + dir, EYE_Y + 2, "#1a1408");
    setPx(img, cx + 1 + dir, EYE_Y + 2, "#1a1408");
    for (let k = 0; k < 6; k++) setPx(img, cx - 1 + k, EYE_Y - 2 + (dir > 0 ? k >> 1 : 2 - (k >> 1)), "#3a2e18");
  };
  eye(13, 1);
  eye(26, -1);
  const MOUTH_Y = EYE_Y + 8;
  for (let x = 15; x <= 29; x++) {
    setPx(img, x, MOUTH_Y, "#3a2e18");
    setPx(img, x, MOUTH_Y + 1, "#3a2e18");
    if (x % 3 === 0) setPx(img, x, MOUTH_Y - 1, "#f4efd0"); // 歯
    if (x % 3 === 1) setPx(img, x, MOUTH_Y + 2, "#3a2e18");
  }
  addOutline(img, "#2a2210");
  return img;
}
const fatbergPixels = createFatbergPixels();
const fatbergSprites = makeShadedVariants(fatbergPixels);
// 当たった瞬間に一瞬だけ白く光らせる用
const fatbergFlash = (() => {
  const copy = makePixels(fatbergPixels.w, fatbergPixels.h);
  for (let i = 0; i < copy.data.length; i += 4) {
    if (!fatbergPixels.data[i + 3]) continue;
    copy.data[i] = copy.data[i + 1] = copy.data[i + 2] = copy.data[i + 3] = 255;
  }
  return pixelsToCanvas(copy);
})();

function createBlobSprites() {
  const img = makePixels(7, 7);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      if (Math.hypot(x - 3, y - 3) <= 3.2) setPx(img, x, y, "#d9cf9c");
    }
  }
  setPx(img, 2, 2, "#fffbe6");
  setPx(img, 4, 5, "#a89a62");
  addOutline(img, "#2a2210");
  return makeShadedVariants(img);
}
const blobSprites = createBlobSprites();

// 油の波（2コマ。泡の位置をずらしてうねって見せる）
//   管の幅いっぱい（ワールドで横 20・縦 12。底 -10 から WAVE_TOP まで）。管の円の外にははみ出さない形にする
function createWaveFrames() {
  const w = 48;
  const h = 26;
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const img = makePixels(w, h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const wx = ((px + 0.5) / w) * 20 - 10;
        const wy = WAVE_TOP - ((py + 0.5) / h) * (WAVE_TOP + 10);
        const top = WAVE_TOP - 1.4 * (0.5 + 0.5 * Math.sin(wx * 0.9 + f * Math.PI)); // うねる波頭
        if (wy > top || wx * wx + wy * wy > 97) continue;
        const depth = top - wy;
        let c;
        if (depth < 0.5) c = Math.random() < 0.5 ? "#fffbe6" : "#f4efd0"; // 泡
        else if (depth < 2.5) c = pick(["#e6dca8", "#e6dca8", "#d9cf9c"]);
        else if (depth < 6) c = pick(["#c9bb7e", "#c2b57c", "#d0c38a"]);
        else c = pick(["#9c8e58", "#a89a62"]);
        setPx(img, px, py, c);
      }
    }
    addOutline(img, "#2a2210");
    frames.push(makeShadedVariants(img));
  }
  return frames;
}
const waveFrames = createWaveFrames();

// 油のつらら（上が太く、先がとがった形。天井から ICICLE_TIP まで引きのばして描く）
function createIcicleSprites() {
  const w = 7;
  const h = 26;
  const img = makePixels(w, h);
  for (let y = 0; y < h; y++) {
    const hw = 3.2 * (1 - y / h) + 0.3;
    for (let x = 0; x < w; x++) {
      const d = x + 0.5 - w / 2;
      if (Math.abs(d) > hw) continue;
      let c = d < -hw * 0.3 ? "#f4efd0" : d > hw * 0.4 ? "#a89a62" : "#d9cf9c"; // 左がわを明るく
      if (y > h - 4) c = "#e6dca8"; // 先のしずく
      setPx(img, x, y, c);
    }
  }
  addOutline(img, "#2a2210");
  return makeShadedVariants(img);
}
const icicleSprites = createIcicleSprites();

// ------------------------------------------------------------
// 状態
//   state: idle（まだ）→ warned（警報のあと、追いついていく）→ fight（ボス戦）
//          → clear（撃破・救援の演出）→ done（ゴールへ）
//   step（ボス戦の中の段階）: pause（次の弱点まで待つ）→ qte（弱点の QTE）→ throw（油を投げる）→ pause …
// ------------------------------------------------------------
const boss = {};
function resetBoss() {
  boss.state = "idle";
  boss.step = "pause";
  boss.x = 0; // ボスの位置（左右にゆれながら進む）
  boss.z = 0;
  boss.t = 0; // 出てきてからの経過秒（ゆれ・転がる動き）
  boss.hp = BOSS_HP;
  boss.hits = 0; // 撮影に成功した弱点の数（ランクの成功率に加える）
  boss.timer = BOSS_TIME;
  boss.next = 0; // 次の段階までの残り時間（ゲーム内の時間）
  boss.throwLeft = 0;
  boss.phaseT = 0; // clear の経過秒
  boss.hurt = 0; // 白く光らせる残り時間
  boss.result = null; // "defeated"（撃破）/ "rescued"（救援）
  boss.weak = null; // いまの弱点（QTE の対象）。ボスからのずれ wx / wy を持つ
  boss.blobs = []; // 飛んでいる油のしずく（位置はボスと同じく、ドローンから見た動きで進める）
  boss.waves = []; // 押し寄せてくる油の波
  boss.icicles = []; // 天井のつららの列（1回の攻撃で1列。ワールドに止まっている）
  boss.charge = 0; // >0 のあいだ、波・つららを出す前の予告（ボスが震える）
  boss.chargeType = null; // 予告している攻撃（"wave" / "icicle"）
}
resetBoss();

function bossActive() {
  return boss.state === "warned" || boss.state === "fight" || boss.state === "clear";
}

// ボスの大きさの倍率（弱点を撮影するたびに小さくなり、撃破・救援で消えていく）
function bossScale() {
  const base = 0.55 + (0.45 * boss.hp) / BOSS_HP;
  if (boss.state === "clear") return base * Math.max(0, 1 - boss.phaseT / 1.4);
  return base;
}
// ボスの中心の高さ（底に乗っている）
function bossCenterY(k) {
  return -pipeRadius + (BOSS_H * k) / 2 - 0.5;
}

// ------------------------------------------------------------
// 毎フレーム（main.js）。dt：ゲーム内の時間（QTE 中はスロー） / realDt：実時間 / speed：ドローンの速さ（1秒あたり）
// ------------------------------------------------------------
function updateBoss(dt, realDt, speed) {
  if (boss.state === "idle" && distance >= BOSS_WARN_AT) {
    boss.state = "warned";
    boss.z = cam.z - BOSS_START_GAP;
    boss.t = 0;
    sirenTime = 3.2;
    FX.showBanner("WARNING!", "GIANT FATBERG AHEAD", "#ff4d6d", 2.2, 3);
    AudioSys.playSiren();
    showInfoCard(
      "この先に巨大な油のかたまり！",
      "台所から流された油が、管の中で冷えて固まったものだよ",
      "",
      3200,
    );
    addLog("ALERT: GIANT FATBERG BLOCKING THE PIPE", "danger");
  }
  if (bossActive()) {
    boss.t += dt;
    boss.x = Math.sin(boss.t * 1.1) * 2.5; // 左右にゆれながら転がる
    if (boss.state === "warned") {
      // ドローンより遅く進むので、だんだん追いつく
      boss.z -= speed * BOSS_APPROACH * dt;
      if (cam.z - boss.z <= BOSS_GAP) startBossFight();
    }
    // ボス戦中と消えていくあいだは、ドローンの BOSS_GAP 先を同じ速さで進む
    if (boss.state !== "warned") boss.z = cam.z - BOSS_GAP;
    // 転がったあとに残る油のかけら（その場に残るので、後ろへ流れていって進んでいる感じが出る）
    if (Math.random() < dt * 14) {
      const k = bossScale();
      FX.mote(
        boss.x + (Math.random() - 0.5) * BOSS_W * k * 0.8,
        -pipeRadius + 0.8 + Math.random() * 1.5,
        boss.z + 3,
        0,
        0,
        0,
        pick(FAT_COLORS),
        1.2,
        0.35,
      );
    }
  }
  if (boss.weak) {
    boss.weak.x = boss.x + boss.weak.wx;
    boss.weak.z = boss.z + 2;
  }

  if (boss.state === "fight") updateBossFight(dt, realDt);
  else if (boss.state === "clear") {
    boss.phaseT += realDt;
    // 消えていくあいだ、かたまりから油のかけらを飛び散らせる
    if (boss.phaseT < 1.4 && Math.random() < realDt * 30) {
      const k = bossScale();
      FX.burst(
        boss.x + (Math.random() - 0.5) * BOSS_W * k,
        bossCenterY(k) + (Math.random() - 0.5) * BOSS_H * k,
        boss.z + 2,
        FAT_COLORS,
        6,
        10,
        0.8,
      );
    }
    if (boss.phaseT >= 2.4) boss.state = "done";
  }

  boss.hurt = Math.max(0, boss.hurt - realDt);
  updateBlobs(dt, speed);
  updateWaves(dt, speed);
  updateIcicles(dt);
  if (bossActive()) Music.intense = true;
}

function startBossFight() {
  boss.state = "fight";
  boss.step = "pause";
  // 最初の弱点は、画面上部の説明カードが消えてから（ボスの体力ゲージと重なるので短めに出す）
  boss.next = 2.3;
  boss.timer = BOSS_TIME;
  FX.showBanner("BOSS BATTLE", "FATBERG", "#ffe14d", 1.8, 3);
  AudioSys.playZone();
  shakeIntensity = 0.5;
  showInfoCard(
    "巨大な油のかたまり「ファットバーグ」！",
    "弱点を撮影してくだこう！ 飛んでくる油はよけてね",
    "",
    2200,
  );
  addLog("BOSS: FATBERG ENGAGED");
}

function updateBossFight(dt, realDt) {
  boss.timer -= realDt;
  if ((boss.timer <= 0 || distance >= BOSS_END_AT) && !(qte && !qte.result)) {
    finishBoss(false);
    return;
  }

  if (boss.step === "pause") {
    boss.next -= dt;
    if (boss.next <= 0 && !qte) {
      // 弱点：かたまりの上半分のどこか（下半分はドローンと重なって見えにくいので使わない）
      const k = bossScale();
      const wx = (Math.random() * 2 - 1) * BOSS_W * k * 0.3;
      boss.weak = {
        kind: "sprite",
        boss: true,
        type: "fatberg",
        wx: wx,
        x: boss.x + wx,
        y: bossCenterY(k) + Math.random() * BOSS_H * k * 0.35,
        z: boss.z + 2,
      };
      startQte(boss.weak);
      boss.step = "qte";
    }
  } else if (boss.step === "qte") {
    if (!qte) {
      if (boss.hp <= 0) {
        finishBoss(true);
        return;
      }
      // 攻撃を選ぶ（撮影できた弱点の数で順番に増えていき、最後は3つからランダム）
      const attack =
        boss.hits < BOSS_ATTACK_ORDER.length ? BOSS_ATTACK_ORDER[boss.hits] : pick(["blobs", "wave", "icicle"]);
      if (attack === "blobs") {
        boss.step = "throw";
        boss.throwLeft = BOSS_THROWS;
        boss.next = 0.25;
      } else {
        // 波・つららは、少し震えて予告してから出す
        boss.step = "charge";
        boss.chargeType = attack;
        boss.charge = ATTACK_CHARGE;
        if (attack === "wave") AudioSys.tone(90, 55, 0.6, "sawtooth", 0.18); // 「ゴゴゴ…」
        else AudioSys.tone(300, 900, 0.3, "square", 0.12); // 油を吐き上げる「ブシュッ」
      }
    }
  } else if (boss.step === "charge") {
    boss.charge -= dt;
    // つららの予告中は、ボスが天井へ油を吐き上げる
    if (boss.chargeType === "icicle" && Math.random() < dt * 40) {
      const k = bossScale();
      FX.mote(
        boss.x + (Math.random() - 0.5) * 4,
        bossCenterY(k) + BOSS_H * k * 0.4,
        boss.z + 2,
        (Math.random() - 0.5) * 6,
        22 + Math.random() * 10,
        0,
        pick(FAT_COLORS),
        0.5,
        0.35,
      );
    }
    if (boss.charge <= 0) {
      if (boss.chargeType === "wave") spawnWave();
      else spawnIcicles();
      boss.step = "pause";
      boss.next = BOSS_PAUSE;
    }
  } else if (boss.step === "throw") {
    boss.next -= dt;
    if (boss.next <= 0) {
      spawnBlob();
      boss.throwLeft--;
      boss.next = 0.45;
      if (boss.throwLeft <= 0) {
        boss.step = "pause";
        boss.next = BOSS_PAUSE;
      }
    }
  }
}

// 弱点の QTE の結果（qte.js の resolveQte から呼ばれる。点検ポイントの成功数には数えない）
function resolveBossQte(result) {
  const o = boss.weak;
  const sp = project(o.x, o.y, o.z);
  if (result === "MISS") {
    // 画面の「MISS...」の文字で伝える（説明カードはボスの体力ゲージと重なるので出さない）
    combo = 0;
    updateComboUI();
    AudioSys.playQteMiss();
    addLog("BOSS: WEAK POINT MISSED", "warning");
    return;
  }
  const perfect = result === "PERFECT";
  const { gained } = addQteScore();
  boss.hp--;
  boss.hits++;
  boss.hurt = 0.25;
  shakeIntensity = 0.6;
  AudioSys.playShutter(perfect);
  AudioSys.playBreak();
  FX.flash("255,255,255", perfect ? 0.85 : 0.55);
  FX.burst(o.x, o.y, o.z, FAT_COLORS, 50, 14, 1.0);
  if (sp) {
    FX.ring(sp.x, sp.y, perfect ? "#ffe14d" : "#00e5ff");
    FX.pop(sp.x, sp.y + 16, `+${gained}`, perfect ? "#ffe14d" : "#ffffff");
  }
  addLog(`BOSS HIT: FATBERG ${boss.hits}/${BOSS_HP} (+${gained})`);
  updateUI();
}

// 撃破（defeated = true）または救援（false）
function finishBoss(defeated) {
  boss.state = "clear";
  boss.phaseT = 0;
  boss.result = defeated ? "defeated" : "rescued";
  boss.blobs.length = 0;
  boss.waves.length = 0;
  boss.icicles.length = 0;
  boss.charge = 0;
  if (qte && qte.obj.boss) cancelQte();
  FX.flash("255,255,255", 0.9);
  shakeIntensity = 1.0;
  if (defeated) {
    score += BOSS_BONUS;
    FX.showBanner("FATBERG CLEAR!", `BONUS +${BOSS_BONUS}`, "rainbow", 2.2, 3);
    AudioSys.playExplode();
    AudioSys.playClear();
    showInfoCard(
      "油のかたまりをやっつけた！",
      "料理の油は流しにすてないで、紙でふき取ってごみに出そう",
      "trivia",
      4200,
    );
    addLog(`BOSS DEFEATED: FATBERG CLEARED (+${BOSS_BONUS})`);
  } else {
    FX.showBanner("RESCUE!", "HIGH PRESSURE JET", "#4dd8ff", 2.2, 3);
    AudioSys.playSplash();
    AudioSys.playBreak();
    showInfoCard(
      "高圧洗浄車（こうあつせんじょうしゃ）が、水の力で取りのぞいてくれた！",
      "料理の油は流しにすてないで、紙でふき取ってごみに出そう",
      "trivia",
      4200,
    );
    addLog("BOSS: RESCUE TEAM REMOVED THE FATBERG", "warning");
  }
  updateUI();
}

// ------------------------------------------------------------
// 油のしずく（ドローンの今の位置をねらって、後ろへ投げてくる。当たるとダメージ）
//   ボスもドローンも前へ進んでいるので、しずくの速さ（vx / vy / vz）はドローンから見た速さで持ち、
//   毎フレーム、ドローンが進んだぶん（-speed）を足して動かす
// ------------------------------------------------------------
function spawnBlob() {
  const k = bossScale();
  const x = boss.x + (Math.random() - 0.5) * BOSS_W * k * 0.5;
  const y = bossCenterY(k) + BOSS_H * k * 0.2;
  const z = boss.z + 3;
  const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
  const t = d / BLOB_SPEED;
  boss.blobs.push({ x, y, z, vx: (cam.x - x) / t, vy: (cam.y - y) / t, vz: (cam.z - z) / t });
  AudioSys.tone(260, 110, 0.14, "square", 0.12);
}

function updateBlobs(dt, speed) {
  for (let i = boss.blobs.length - 1; i >= 0; i--) {
    const b = boss.blobs[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += (b.vz - speed) * dt;
    if (!isGameOver && Math.abs(b.z - cam.z) < 1 && Math.hypot(b.x - cam.x, b.y - cam.y) < 1.4) {
      // ドローンに当たった
      hp -= dmg(BLOB_DAMAGE);
      collidedCount++;
      shakeIntensity = 0.8;
      hurtBlink = 0.6;
      combo = 0;
      updateComboUI();
      AudioSys.playSplash();
      AudioSys.playDamage();
      FX.flash("255,220,120", 0.45);
      FX.crack(b.x < cam.x ? "left" : "right"); // しずくが来た側のふちからヒビ
      FX.burst(cam.x, cam.y, cam.z - 1, FAT_COLORS, 24, 9, 0.8);
      addLog(`SYS DANGER: GREASE HIT (-${BLOB_DAMAGE}%)`, "danger");
      boss.blobs.splice(i, 1);
      continue;
    }
    if (b.z > cam.z + 8) boss.blobs.splice(i, 1);
  }
}

// ------------------------------------------------------------
// 油の波（管の底から盛り上がって押し寄せる。WAVE_TOP より上を飛んでいればよけられる）
//   しずくと同じく、ドローンから見た速さで近づけ、ドローンが進んだぶん（-speed）を足す
// ------------------------------------------------------------
function spawnWave() {
  boss.waves.push({ z: boss.z + 3, done: false });
  shakeIntensity = Math.max(shakeIntensity, 0.5);
  AudioSys.playSplash();
  AudioSys.noise(0.6, 400, 0.35);
  FX.burst(boss.x, -pipeRadius + 1, boss.z + 3, FAT_COLORS, 30, 12, 0.8);
  addLog("BOSS: GREASE WAVE INCOMING", "warning");
}

function updateWaves(dt, speed) {
  for (let i = boss.waves.length - 1; i >= 0; i--) {
    const w = boss.waves[i];
    w.z += (WAVE_SPEED - speed) * dt;
    // 波がドローンの位置まで来たら1回だけ判定する
    if (!w.done && w.z >= cam.z - 0.5) {
      w.done = true;
      if (isGameOver) continue;
      if (cam.y - 0.5 < WAVE_TOP) {
        hp -= dmg(WAVE_DAMAGE);
        collidedCount++;
        shakeIntensity = 1.0;
        hurtBlink = 0.7;
        combo = 0;
        updateComboUI();
        AudioSys.playSplash();
        AudioSys.playDamage();
        FX.flash("255,220,120", 0.6);
        FX.crack("bottom"); // 波は下から
        FX.burst(cam.x, cam.y, cam.z - 1, FAT_COLORS, 36, 11, 0.9);
        addLog(`SYS DANGER: GREASE WAVE HIT (-${WAVE_DAMAGE}%)`, "danger");
      } else {
        // よけられた（動画で見ても分かるように、ドローンの上に文字を出す）
        const sp = project(cam.x, cam.y, cam.z);
        if (sp) FX.pop(sp.x, sp.y - 6, "DODGE!", "#6dff7a");
        AudioSys.tone(880, 1320, 0.12, "square", 0.08);
      }
    }
    if (w.z > cam.z + 10) boss.waves.splice(i, 1);
  }
}

// ------------------------------------------------------------
// 油のつらら（前方の天井に1列できる。ICICLE_TIP より下を飛んでいればよけられる）
//   ワールドに止まっているので、ドローンが進むと近づいてくる（しずく・波とちがい、速さの補正はいらない）
// ------------------------------------------------------------
function spawnIcicles() {
  const items = [];
  for (let x = -7.5; x <= 7.5; x += 2.5) {
    // 先の高さは少しばらつかせる（ICICLE_TIP より下に伸ばすだけなので、判定より少し長いものがある程度）
    items.push({ x: x + (Math.random() - 0.5) * 0.8, tip: ICICLE_TIP - Math.random() * 0.4 });
  }
  boss.icicles.push({ z: cam.z - ICICLE_AHEAD, t: 0, done: false, items: items });
  AudioSys.noise(0.25, 1800, 0.2);
  addLog("BOSS: GREASE ICICLES ON THE CEILING", "warning");
}

function updateIcicles(dt) {
  for (let i = boss.icicles.length - 1; i >= 0; i--) {
    const row = boss.icicles[i];
    row.t += dt;
    // ドローンがつららの列まで来たら1回だけ判定する
    if (!row.done && cam.z <= row.z + 0.5) {
      row.done = true;
      if (isGameOver) continue;
      if (cam.y + 0.5 > ICICLE_TIP) {
        hp -= dmg(ICICLE_DAMAGE);
        collidedCount++;
        shakeIntensity = 1.0;
        hurtBlink = 0.7;
        combo = 0;
        updateComboUI();
        AudioSys.playBreak();
        AudioSys.playDamage();
        FX.flash("255,220,120", 0.6);
        FX.crack("top"); // つららは上から
        FX.burst(cam.x, cam.y + 0.5, cam.z - 1, FAT_COLORS, 36, 11, 0.9);
        addLog(`SYS DANGER: GREASE ICICLE HIT (-${ICICLE_DAMAGE}%)`, "danger");
      } else {
        const sp = project(cam.x, cam.y, cam.z);
        if (sp) FX.pop(sp.x, sp.y - 6, "DODGE!", "#6dff7a");
        AudioSys.tone(880, 1320, 0.12, "square", 0.08);
      }
    }
    if (row.z > cam.z + 10) boss.icicles.splice(i, 1);
  }
}

// ------------------------------------------------------------
// 描画（render-world.js の renderWorld から呼ばれる。奥行き順に並べる list に入れる）
// ------------------------------------------------------------
function addBossSprites(list, now) {
  if (bossActive() && !(boss.state === "clear" && boss.phaseT >= 1.4)) {
    const k = bossScale();
    const w = BOSS_W * k;
    // ぶよぶよ動きながら、転がるように上下にはずむ
    const h = BOSS_H * k * (1 + 0.04 * Math.sin(now * 0.006));
    const hop = Math.abs(Math.sin(boss.t * 5)) * 0.6;
    const p = project(boss.x, -pipeRadius + h / 2 - 0.5 + hop, boss.z);
    if (p && p.dz <= 170) {
      list.push({
        dz: p.dz,
        draw: () => {
          const sw = Math.max(1, Math.round(w * p.s));
          const sh = Math.max(1, Math.round(h * p.s));
          // 当たったときと、波を出す前の予告のときは震える
          const shaking = boss.hurt > 0 || boss.charge > 0;
          const jit = shaking ? randInt(-1, 1) : 0;
          const x = Math.round(p.x - sw / 2) + jit;
          const y = Math.round(p.y - sh / 2) + (boss.charge > 0 ? randInt(-1, 1) : 0);
          const wl = Math.round(waterlineY(p.dz));
          const visH = Math.min(sh, wl - y);
          if (visH <= 0) return;
          const lv = Math.max(3, spriteLevel(p.x, p.y, p.dz, boss.z));
          const src = boss.hurt > 0 && Math.floor(now / 50) % 2 === 0 ? fatbergFlash : fatbergSprites[lv];
          ctx.drawImage(src, 0, 0, src.width, (src.height * visH) / sh, x, y, sw, visH);
        },
      });
    }
  }
  boss.waves.forEach((wv) => {
    const p = project(0, (WAVE_TOP - pipeRadius) / 2, wv.z);
    if (!p || p.dz > 170) return;
    list.push({
      dz: p.dz,
      draw: () => {
        const sw = Math.max(1, Math.round(20 * p.s));
        const sh = Math.max(1, Math.round((WAVE_TOP + pipeRadius) * p.s));
        const lv = Math.max(3, spriteLevel(p.x, p.y, p.dz, wv.z));
        const src = waveFrames[Math.floor(now / 120) % 2][lv];
        ctx.drawImage(src, Math.round(p.x - sw / 2), Math.round(p.y - sh / 2), sw, sh);
      },
    });
  });
  boss.icicles.forEach((row) => {
    const grow = Math.min(1, row.t / ICICLE_GROW);
    row.items.forEach((it) => {
      const ceil = Math.sqrt(pipeRadius * pipeRadius - it.x * it.x) - 0.2; // その横位置での天井の高さ
      const len = (ceil - it.tip) * grow;
      if (len <= 0.05) return;
      const p = project(it.x, ceil - len / 2, row.z);
      if (!p || p.dz > 170) return;
      list.push({
        dz: p.dz,
        draw: () => {
          const sw = Math.max(1, Math.round(1.8 * p.s));
          const sh = Math.max(1, Math.round(len * p.s));
          const lv = Math.max(3, spriteLevel(p.x, p.y, p.dz, row.z));
          ctx.drawImage(icicleSprites[lv], Math.round(p.x - sw / 2), Math.round(p.y - sh / 2), sw, sh);
        },
      });
    });
  });
  boss.blobs.forEach((b) => {
    const p = project(b.x, b.y, b.z);
    if (!p) return;
    list.push({
      dz: p.dz,
      draw: () => {
        const s = Math.max(2, Math.round(1.4 * p.s));
        const lv = Math.max(3, spriteLevel(p.x, p.y, p.dz, b.z));
        ctx.drawImage(blobSprites[lv], Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      },
    });
  });
}

// ボス戦中の表示（名前・体力ゲージ・残り時間）。render-overlay.js の renderOverlay から呼ばれる
function renderBossHud(now) {
  if (boss.state !== "fight") return;
  const W = SCREEN_W;
  drawText("FATBERG", W / 2, 20, 1, "#ffe14d");
  const bw = 100;
  const x0 = Math.round(W / 2 - bw / 2);
  ctx.fillStyle = "#000";
  ctx.fillRect(x0 - 1, 29, bw + 2, 6);
  ctx.fillStyle = "#3a2e18";
  ctx.fillRect(x0, 30, bw, 4);
  ctx.fillStyle = boss.hurt > 0 ? "#ffffff" : "#ff9a3c";
  ctx.fillRect(x0, 30, Math.round((bw * boss.hp) / BOSS_HP), 4);
  const left = Math.max(0, Math.ceil(boss.timer));
  const warn = left <= 8;
  if (!warn || Math.floor(now / 250) % 2 === 0) {
    drawText(`TIME ${left}`, W / 2, 38, 1, warn ? "#ff4d6d" : "#ffffff");
  }
  // 予告と、届くまでのあいだ：画面の下によける向きを点滅（波は「UP!」、つららは「DOWN!」）
  const charging = boss.charge > 0 ? boss.chargeType : null;
  const waveComing = charging === "wave" || boss.waves.some((w) => !w.done);
  const icicleComing = charging === "icicle" || boss.icicles.some((r) => !r.done);
  if (Math.floor(now / 150) % 2 === 0) {
    if (waveComing) drawText("UP!", W / 2, SCREEN_H - 38, 2, "#ffe14d");
    else if (icicleComing) drawText("DOWN!", W / 2, SCREEN_H - 38, 2, "#ffe14d");
  }
}
