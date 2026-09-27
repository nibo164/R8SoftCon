// ============================================================
// js/qte.js — 点検 QTE（ピント合わせのタイミング押し）とチュートリアル
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 点検 QTE（ピント合わせ）
//   点検ポイントが近づくとスローモーションになり、縮んでいく輪が
//   ピントの枠に重なった瞬間にボタンを押して「撮影」する。
//     PERFECT / GOOD：撮影成功 → 点検成功（障害物はその場で取りのぞく）
//     MISS          ：壁の異常は見逃し、障害物はぶつかってダメージ
//   操作：スペース / Enter / クリック / ゲームパッド A・R2
//   スローの強さ・判定の幅・輪の速さ・輪の数は難易度（diff）で変わる
//   輪の数：EASY 1つ / NORMAL 2つ / HARD 3つ。輪は全部同じ速さで縮み、時間をずらして出てくる。
//     輪が枠に重なるたびに1回ずつ押す（押すと、いちばん先の まだ判定していない輪で判定する）
//     1つでも MISS したらその場で QTE 全体が MISS。全部 PERFECT なら PERFECT、それ以外は GOOD
//     得点は輪ごとに PERFECT 300 / GOOD 150 を足し、コンボ倍率を掛ける（コンボは QTE 1回で1つ）
//   QTE が始まる距離は難易度ごと（diff.qteTrigger）。輪が多いほど長いので遠くから始める
//   EASY は1回目の QTE がチュートリアル：時間が完全に止まり、輪がゆっくり縮む。
//     失敗してもダメージなしで、成功するまでやり直せる
// ============================================================
const QTE_RING_START = 40; // 縮む輪の最初の半径（画面のドット）
const QTE_RING_TARGET = 12; // ピントの枠の半径
const QTE_RESULT_HOLD = 0.45; // 判定を見せる時間（秒）
const TUTORIAL_RING_TIME = 2.2; // チュートリアルで輪が枠に重なるまでの時間（秒）
const TUTORIAL_RETRY_HOLD = 0.8; // チュートリアルで失敗したあと、やり直すまでの時間（秒）
let tutorialPending = false; // これから始まる QTE をチュートリアルにするか
const QTE_LABELS = {
  corrosion: "CORROSION",
  crack: "CRACK",
  rebar: "REBAR",
  leak: "LEAK",
  sediment: "SEDIMENT",
  roots: "ROOTS",
  fatberg: "WEAK POINT", // ラスボスの弱点（boss.js）
};

let qte = null; // 実行中の QTE（なければ null）
let timeScale = 1; // ゲーム内の時間の進み（スロー中は小さくなる）
let qteSuccess = 0; // 点検に成功した回数
let qtePerfect = 0; // そのうち PERFECT の回数

// 対象の点検位置（壁の異常は壁の上、障害物は本体の中心）
function qteTargetPos(o) {
  if (o.kind === "decal") {
    return {
      x: Math.cos(o.ang) * (pipeRadius - 0.3),
      y: Math.sin(o.ang) * (pipeRadius - 0.3),
      z: o.z,
    };
  }
  return { x: o.x, y: o.y, z: o.z };
}

function startQte(obj) {
  const tutorial = tutorialPending;
  // 毎回少しタイミングを変える（チュートリアルはゆっくり一定）
  const [tMin, tMax] = diff.ringTime;
  const firstAt = tutorial ? TUTORIAL_RING_TIME : tMin + Math.random() * (tMax - tMin);
  // 輪の並び（perfectAt：その輪が枠に重なる時刻）。練習は1つだけ
  const count = tutorial ? 1 : diff.qteRings;
  const rings = [];
  let at = firstAt;
  for (let i = 0; i < count; i++) {
    if (i > 0) at += diff.qteRingGap * (0.9 + Math.random() * 0.2);
    rings.push({ perfectAt: at, result: null });
  }
  qte = {
    obj: obj,
    t: 0,
    firstAt: firstAt,
    shrinkSpeed: (QTE_RING_START - QTE_RING_TARGET) / firstAt, // 輪が縮む速さ（ドット/秒）
    rings: rings,
    idx: 0, // 次に判定する輪
    ringPop: null, // 途中の輪の判定の小さな文字 { text, t }
    result: null,
    resultT: 0,
    tutorial: tutorial,
  };
  obj.qteStarted = true;
  AudioSys.playQteStart();
  AudioSys.setMuffle(true);
  if (tutorial) {
    showInfoCard(
      "【練習】輪が白い枠に重なった瞬間に、SPACE（A ボタン）を押そう！",
      "時間は止まっているよ。失敗してもだいじょうぶ、できるまで練習できる",
      "trivia",
      60000,
    );
  }
}

// 輪の今の半径（まだ出てきていない輪は QTE_RING_START より大きくなる）
function qteRingRadius(q, ring) {
  return Math.max(0, QTE_RING_START - q.shrinkSpeed * (q.t - ring.perfectAt + q.firstAt));
}

// この時刻を過ぎたら、押さなかった輪は MISS
//   最後の輪：今までどおり輪が消えるまで待つ / 途中の輪：GOOD の幅を過ぎたら（次の輪と取りちがえないように）
function qteRingDeadline(q, i) {
  const ring = q.rings[i];
  return i === q.rings.length - 1
    ? ring.perfectAt + QTE_RING_TARGET / q.shrinkSpeed
    : ring.perfectAt + diff.qteGood;
}

// ボタンが押されたとき（QTE 中でなければ何もしない）
function qtePress() {
  if (!qte || qte.result || isPaused || isGameOver) return false;
  const err = Math.abs(qte.t - qte.rings[qte.idx].perfectAt);
  judgeRing(err <= diff.qtePerfect ? "PERFECT" : err <= diff.qteGood ? "GOOD" : "MISS");
  return true;
}

// 輪を1つ判定する。MISS ならその場で QTE 全体が MISS、最後の輪まで成功したら QTE の結果を出す
function judgeRing(result) {
  if (result === "MISS") {
    resolveQte("MISS");
    return;
  }
  qte.rings[qte.idx].result = result;
  qte.idx++;
  if (qte.idx >= qte.rings.length) {
    resolveQte(qte.rings.every((r) => r.result === "PERFECT") ? "PERFECT" : "GOOD");
    return;
  }
  // まだ輪が残っている：小さく判定を見せて、短い音を鳴らす
  qte.ringPop = { text: result, t: qte.t };
  const f = result === "PERFECT" ? 1320 : 990;
  AudioSys.tone(f, f, 0.06, "square", 0.1);
}

// 撮影成功の得点とコンボ（輪ごとに PERFECT 300 / GOOD 150 を足し、コンボ倍率を掛ける）
function addQteScore() {
  combo++;
  maxCombo = Math.max(maxCombo, combo);
  const mult = Math.min(combo, COMBO_MAX_MULT);
  const base = qte.rings.reduce((s, r) => s + (r.result === "PERFECT" ? 300 : 150), 0);
  const gained = base * mult;
  score += gained;
  updateComboUI();
  return { gained, mult };
}

function resolveQte(result) {
  const o = qte.obj;

  // チュートリアルの失敗：ダメージなしで、少し待ってからやり直す
  // （3回失敗したら、先へ進めなくならないよう練習を終えて本番へ）
  if (qte.tutorial && result === "MISS") {
    qte.retries = (qte.retries || 0) + 1;
    if (qte.retries >= 3) {
      tutorialPending = false;
      qte.result = "MISS";
      qte.resultT = 0;
      o.active = false;
      o.counted = true;
      if (o.kind !== "decal") o.visible = false; // 練習なのでぶつからない
      missedCount++;
      combo = 0;
      updateComboUI();
      AudioSys.playQteMiss();
      showInfoCard(
        "だいじょうぶ！ 本番でやってみよう",
        "縮む輪が白い枠に重なった瞬間に押すよ",
        "trivia",
        2800,
      );
      updateUI();
      return;
    }
    qte.result = "RETRY";
    qte.resultT = 0;
    AudioSys.playQteMiss();
    showInfoCard(
      "おしい！ もう一度やってみよう",
      "縮んでくる輪が、白い枠にぴったり重なった瞬間に押すよ",
      "trivia",
      60000,
    );
    return;
  }
  if (qte.tutorial) {
    tutorialPending = false;
  }

  qte.result = result;
  qte.resultT = 0;
  // ラスボスの弱点は boss.js で処理する（点検ポイントの成功数・図鑑には数えない）
  if (o.boss) {
    resolveBossQte(result);
    return;
  }
  o.active = false;
  o.counted = true;
  const p = qteTargetPos(o);
  const sp = project(p.x, p.y, p.z);

  if (result === "MISS") {
    combo = 0;
    updateComboUI();
    missedCount++;
    AudioSys.playQteMiss();
    if (o.kind === "decal") {
      addLog(`SCAN MISS: ${o.type.toUpperCase()}`, "warning");
      showInfoCard("ピントが合わなかった…", "", "", 1400);
    } else {
      // 障害物を取りのぞけず、ぶつかる
      hp -= dmg(15);
      collidedCount++;
      o.visible = false;
      shakeIntensity = 0.9;
      hurtBlink = 0.7;
      AudioSys.playDamage();
      FX.flash("255,40,40", 0.55);
      FX.crack();
      FX.burst(cam.x, cam.y, cam.z - 1, HAZARD_COLORS[o.type], 30, 10, 0.9);
      addLog(`SYS DANGER: ${o.type.toUpperCase()} COLLISION (-15%)`, "danger");
    }
    updateUI();
    return;
  }

  // 撮影成功
  const perfect = result === "PERFECT";
  const { gained, mult } = addQteScore();
  inspectedCount++;
  qteSuccess++;
  if (perfect) qtePerfect++;
  recordCodex(o.type);
  AudioSys.playShutter(perfect);
  FX.flash("255,255,255", perfect ? 0.85 : 0.55); // カメラのフラッシュ

  if (o.kind === "decal") {
    // 壁の異常：水色の枠で囲み、壁から光の粒をはじけさせる
    anomalyFound++;
    o.helper = true;
    FX.burst(p.x, p.y, p.z, ["#00e5ff", "#ffffff", "#ffe14d"], 24 + mult * 4, 8, 0.7);
  } else {
    // 障害物：取りのぞく（砕けて消える）
    o.visible = false;
    FX.burst(p.x, p.y, p.z, HAZARD_COLORS[o.type], 40, 12, 0.9);
    AudioSys.playBreak();
  }
  if (sp) {
    FX.ring(sp.x, sp.y, perfect ? "#ffe14d" : "#00e5ff");
    FX.pop(sp.x, sp.y + 16, `+${gained}`, perfect ? "#ffe14d" : "#ffffff");
  }

  // 短い通知（詳しい解説は結果画面の図鑑で読める）
  const info = ANOMALY_INFO[o.type];
  if (qte.tutorial) {
    showInfoCard(
      "できた！ その調子！",
      "「！」の点検ポイントが来たら、同じように撮影しよう",
      "trivia",
      2800,
    );
  } else if (info) {
    showInfoCard(`${o.kind === "decal" ? "撮影成功！" : "除去！"} ${info.name}`, "");
  }
  addLog(
    `SCAN ${result}: ${o.type.toUpperCase()} (+${gained}${mult > 1 ? ` / COMBO x${mult}` : ""})`,
  );
  updateUI();
}

// QTE を途中で打ち切る（墜落・ゴール・リセット時）
function cancelQte() {
  qte = null;
  timeScale = 1;
  AudioSys.setMuffle(false);
}

// 毎フレーム（実時間 dt）：開始判定・時間切れ・スローの出入り
function updateQte(dt) {
  if (!qte) {
    const next = qteTargets.find(
      (o) => !o.qteStarted && o.z < cam.z && cam.z - o.z <= diff.qteTrigger,
    );
    if (next) startQte(next);
  }

  let targetScale = 1;
  if (qte) {
    // チュートリアルは時間を完全に止める
    const slow = qte.tutorial ? 0 : diff.qteSlow;
    qte.t += dt;
    if (!qte.result) {
      targetScale = slow;
      if (qte.t >= qteRingDeadline(qte, qte.idx)) judgeRing("MISS"); // 押さなかった
    } else if (qte.result === "RETRY") {
      // チュートリアルの失敗：少し待って、輪を最初から縮め直す
      targetScale = slow;
      qte.resultT += dt;
      if (qte.resultT >= TUTORIAL_RETRY_HOLD) {
        qte.result = null;
        qte.t = 0;
        qte.idx = 0;
        qte.ringPop = null;
        qte.rings.forEach((r) => (r.result = null));
      }
    } else {
      qte.resultT += dt;
      targetScale = qte.resultT < QTE_RESULT_HOLD * 0.5 ? slow : 1;
      if (qte.resultT >= QTE_RESULT_HOLD) {
        qte = null;
        AudioSys.setMuffle(false);
      }
    }
  }
  // スローへはすばやく入り、戻るときは少し時間をかける
  const k = targetScale < timeScale ? 1 - Math.pow(1e-6, dt) : 1 - Math.pow(0.01, dt);
  timeScale += (targetScale - timeScale) * k;
  if (Math.abs(timeScale - targetScale) < 0.002) timeScale = targetScale;
}

// スロー演出の強さ（0〜1）
function slowAmount() {
  return Math.max(0, Math.min(1, (1 - timeScale) / (1 - diff.qteSlow)));
}

window.addEventListener("click", (event) => {
  if (!isGameStarted || isPaused || isGameOver) return;
  // ボタンやHUDパネル内のクリックは除外
  // （ボタン内の文字を押した場合もあるので closest で調べる）
  if (event.target.closest("button") || event.target.closest(".hud-panel"))
    return;
  qtePress();
});

