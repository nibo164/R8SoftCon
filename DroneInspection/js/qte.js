// ============================================================
// js/qte.js — 点検 QTE（ピント合わせのタイミング押し）とチュートリアル
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 点検 QTE（ピント合わせ）
//   点検ポイントが近づくとスローモーションになり、縮んでいく輪が
//   ピントの枠に重なった瞬間にボタンを押して「撮影」する。
//     PERFECT / GOOD：撮影成功 → 点検成功（障害物はその場で取りのぞく）
//     MISS          ：壁の異常は見逃し、障害物はぶつかってダメージ
//   操作：スペース / Enter / クリック / ゲームパッド A・R2
//   スローの強さ・判定の幅・輪の速さは難易度（diff）で変わる
//   EASY は1回目の QTE がチュートリアル：時間が完全に止まり、輪がゆっくり縮む。
//     失敗してもダメージなしで、成功するまでやり直せる
// ============================================================
const QTE_TRIGGER_DIST = 36; // ドローンからこの距離まで近づいたら始まる
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
  const perfectAt = tutorial ? TUTORIAL_RING_TIME : tMin + Math.random() * (tMax - tMin);
  const shrinkSpeed = (QTE_RING_START - QTE_RING_TARGET) / perfectAt;
  qte = {
    obj: obj,
    t: 0,
    perfectAt: perfectAt,
    dur: perfectAt + QTE_RING_TARGET / shrinkSpeed, // 輪が消えるまで
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

// 縮む輪の今の半径
function qteRingRadius(q) {
  const speed = (QTE_RING_START - QTE_RING_TARGET) / q.perfectAt;
  return Math.max(0, QTE_RING_START - speed * q.t);
}

// ボタンが押されたとき（QTE 中でなければ何もしない）
function qtePress() {
  if (!qte || qte.result || isPaused || isGameOver) return false;
  const err = Math.abs(qte.t - qte.perfectAt);
  resolveQte(err <= diff.qtePerfect ? "PERFECT" : err <= diff.qteGood ? "GOOD" : "MISS");
  return true;
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
  combo++;
  maxCombo = Math.max(maxCombo, combo);
  const mult = Math.min(combo, COMBO_MAX_MULT);
  const gained = (perfect ? 300 : 150) * mult;
  score += gained;
  inspectedCount++;
  qteSuccess++;
  if (perfect) qtePerfect++;
  recordCodex(o.type);
  updateComboUI();
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
      (o) => !o.qteStarted && o.z < cam.z && cam.z - o.z <= QTE_TRIGGER_DIST,
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
      if (qte.t >= qte.dur) resolveQte("MISS"); // 押さなかった
    } else if (qte.result === "RETRY") {
      // チュートリアルの失敗：少し待って、輪を最初から縮め直す
      targetScale = slow;
      qte.resultT += dt;
      if (qte.resultT >= TUTORIAL_RETRY_HOLD) {
        qte.result = null;
        qte.t = 0;
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

