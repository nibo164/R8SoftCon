// ============================================================
// js/game.js — ゲームの流れ：開始・一時停止・リセット・衝突判定・カウントダウン・ゴール・墜落・区間と増水
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ゲーム開始（スペースキー / ゲームパッドのAボタン から呼ばれる）
function startGame() {
  if (isGameStarted || isGameOver || codexOpen) return;
  isGameStarted = true;
  // 選んだ難易度でコースを並べ直す（毎回ちがう配置になる）
  placeObjects(diff);
  tutorialPending = diff.tutorial;
  updateModeLabels();
  updateUI();
  AudioSys.init();
  AudioSys.resume();
  AudioSys.setDrone(true);
  Music.setup();
  updatePauseBtn();
  // 3・2・1・GO! のカウントダウンから始める
  countdown = 3;
  FX.showBanner("3", null, "#ffffff", 0.9, 7);
  AudioSys.playBeep(false);
  addLog("DRONE READY: COUNTDOWN");
  const startScreen = document.getElementById("startScreen");
  if (startScreen) {
    startScreen.style.opacity = 0;
    setTimeout(() => {
      startScreen.style.display = "none";
    }, 500);
  }
}

// 一時停止切り替え
function togglePause() {
  isPaused = !isPaused;
  AudioSys.setDrone(!isPaused && isGameStarted && !isGameOver);
  blurActiveButton();
  if (isPaused) {
    pausedAt = performance.now();
    setPauseSel(0); // 開いたときは「つづける」を選んでおく
    Music.pause();
  } else {
    if (comboExpire > 0) {
      // 止めていた時間のぶんだけコンボの制限時間をのばす
      comboExpire += performance.now() - pausedAt;
    }
    Music.resume();
  }
  const pauseScreen = document.getElementById("pauseScreen");
  if (pauseScreen) {
    if (isPaused) {
      pauseScreen.style.display = "flex";
      pauseScreen.offsetHeight; // リフロー強制
      pauseScreen.style.opacity = 1;
    } else {
      pauseScreen.style.opacity = 0;
      setTimeout(() => {
        if (!isPaused) pauseScreen.style.display = "none";
      }, 300);
    }
  }
}

// ゲーム開始時点に戻る（リセット）
function resetGame() {
  hp = 100;
  score = 0;
  distance = 0;
  isGameOver = false;
  isGameStarted = false;
  isPaused = false;
  shakeIntensity = 0.0;
  inspectedCount = 0;
  missedCount = 0;
  collidedCount = 0;
  combo = 0;
  maxCombo = 0;
  comboExpire = 0;
  camRoll = 0;
  camPitch = 0;
  AudioSys.setDrone(false);

  // 演出・進行の状態を初期化
  Music.stop();
  FX.clear();
  anomalyFound = 0;
  hitStop = 0;
  countdown = 0;
  goalAnim = -1;
  gameOverDelay = 0;
  resultShown = false;
  speedFactor = 0;
  currentZone = 0;
  floodWarned = false;
  sirenTime = 0;
  floodK = 0;
  waterLevel = WATER_BASE;
  focal = BASE_FOCAL;
  cityStart = -1;
  droneBank = 0;
  hurtBlink = 0;
  droneVisible = true;
  setHudVisible(true);
  cancelQte();
  qteSuccess = 0;
  qtePerfect = 0;
  qteTargets.forEach((o) => (o.qteStarted = false));
  tutorialPending = false;
  hpLastSeen = 100;
  hpLabelUntil = 0;

  updatePauseBtn();
  blurActiveButton();

  // 今回のプレイぶんの図鑑記録だけリセット（累計 codexSession は保持する）
  CODEX_ORDER.forEach((k) => (codexRun[k] = 0));

  // カメラを初期位置へ
  cam.x = 0;
  cam.y = 0;
  cam.z = 0;

  // 障害物とアノマリーの再アクティブ化と点検済みの枠の解除
  hazards.concat(anomalies).forEach((o) => {
    o.active = true;
    o.counted = false;
    o.visible = true;
    o.helper = false;
  });

  // マンホール通過状態のリセット
  manholes.forEach((m) => (m.passed = false));

  // ログのクリア
  const logArea = document.getElementById("logArea");
  if (logArea) {
    logArea.innerHTML = "";
  }

  // 図鑑カード・コンボ表示を隠す
  hideInfoCard();
  updateComboUI();

  // UI更新
  updateUI();

  // スタート画面再表示
  const startScreen = document.getElementById("startScreen");
  if (startScreen) {
    startScreen.style.display = "flex";
    startScreen.offsetHeight;
    startScreen.style.opacity = 1;
  }

  // 一時停止画面非表示
  const pauseScreen = document.getElementById("pauseScreen");
  if (pauseScreen) {
    pauseScreen.style.opacity = 0;
    pauseScreen.style.display = "none";
  }

  // クリア画面非表示
  const clearScreen = document.getElementById("clearScreen");
  if (clearScreen) {
    clearScreen.style.opacity = 0;
    clearScreen.style.display = "none";
  }

  // ゲームオーバー画面非表示
  const gameOverScreen = document.getElementById("gameOverScreen");
  if (gameOverScreen) {
    gameOverScreen.style.opacity = 0;
    gameOverScreen.style.display = "none";
  }
}

// ※ 照準で狙う方式は QTE に置き換えたので、レティクルと見逃し判定はなくした。
//    見逃し（missedCount）は QTE の MISS で数える

// ドローン（1x1x1の箱）と障害物の箱が重なっているか
function hitsBox(b) {
  return (
    cam.x + 0.5 > b.x0 &&
    cam.x - 0.5 < b.x1 &&
    cam.y + 0.5 > b.y0 &&
    cam.y - 0.5 < b.y1 &&
    cam.z + 0.5 > b.z0 &&
    cam.z - 0.5 < b.z1
  );
}

// 障害物ごとの破片の色
const HAZARD_COLORS = {
  leak: ["#8fd8ff", "#33aaff", "#e0f6ff"],
  sediment: ["#5c4033", "#8a6a4a", "#735238", "#8a7a6a"],
  roots: ["#6b4423", "#8a5a30", "#a07a50"],
};

// ------------------------------------------------------------
// カウントダウン（3・2・1・GO!）
// ------------------------------------------------------------
function updateCountdown(dt) {
  const before = Math.ceil(countdown);
  countdown -= dt;
  const after = Math.ceil(countdown);
  if (countdown <= 0) {
    countdown = 0;
    FX.showBanner("GO!", null, "rainbow", 0.8, 5);
    AudioSys.playBeep(true);
    Music.start();
    addLog("DRONE LAUNCHED: INSPECTION START");
  } else if (after !== before) {
    FX.showBanner(String(after), null, "#ffffff", 0.9, 7);
    AudioSys.playBeep(false);
  }
}

// ------------------------------------------------------------
// ゴール演出：天井のマンホールへ上昇 → 白く光る → 地上の街
// ------------------------------------------------------------
// HUD（左右のパネル・照準・ログ）の表示切り替え
function setHudVisible(on) {
  ["hud", "logArea"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = on ? "" : "0";
  });
}

function startGoal() {
  isGameOver = true; // これ以降は操作・点検・ポーズを受け付けない
  goalAnim = 0;
  updatePauseBtn();
  Music.stop();
  cancelQte();
}

function updateGoal(dt) {
  goalAnim += dt;
  if (cityStart < 0) {
    // 前へ進みながら上昇し、上を見上げる
    cam.z -= 90 * dt;
    cam.y = Math.min(pipeRadius - 1.5, cam.y + 12 * dt);
    camPitch += (0.45 - camPitch) * Math.min(1, dt * 4);
    if (goalAnim > 0.45) FX.flash("255,255,255", (goalAnim - 0.45) * 2.2);
    if (goalAnim > 0.9) {
      cityStart = performance.now();
      setHudVisible(false); // 地上の場面では HUD を消して街とドローンを見せる
      hideInfoCard();
      FX.flashA = 1;
      FX.lines.length = 0;
      AudioSys.setDrone(false);
      AudioSys.playClear();
    }
  } else if (!resultShown && goalAnim > 2.6) {
    showClearScreen();
  }
}

// ------------------------------------------------------------
// 墜落：爆発させてから、少し間をおいてゲームオーバー画面を出す
// ------------------------------------------------------------
function crashDrone() {
  isGameOver = true;
  updatePauseBtn();
  Music.stop();
  cancelQte();
  AudioSys.setDrone(false);
  AudioSys.playExplode();
  FX.burst(cam.x, cam.y, cam.z, ["#ffd84a", "#ff7a33", "#ff3344", "#ffffff", "#555a60"], 70, 16, 1.2);
  FX.flash("255,120,60", 0.9);
  FX.crack();
  FX.crack();
  shakeIntensity = 1.2;
  hurtBlink = 0;
  gameOverDelay = 1.0;
  droneVisible = false; // 爆発したので機体は描かない
}

function showGameOverScreen() {
  resultShown = true;
  document.getElementById("failDistance").innerText = `${Math.floor(distance)}m`;
  document.getElementById("failScore").innerText = score;

  // 墜落しても、それまでの点検成果は無駄ではないことを伝える（土木PR）
  const salvageEl = document.getElementById("failSalvage");
  if (salvageEl) {
    const households = inspectedCount * HOUSEHOLDS_PER_FIND;
    salvageEl.innerText =
      inspectedCount > 0
        ? `でも、ここまでに点検した ${inspectedCount} か所のおかげで、およそ ${households} 世帯の暮らしを守れたよ。`
        : "異常を1件でも見つけられれば、その先の暮らしを守ることができる。次はきっと見つかる！";
  }

  const gameOverScreen = document.getElementById("gameOverScreen");
  if (gameOverScreen) {
    gameOverScreen.style.display = "flex";
    gameOverScreen.offsetHeight;
    gameOverScreen.style.opacity = 1;
  }
}

// ------------------------------------------------------------
// 区間（ゾーン）と増水イベントの進行
// ------------------------------------------------------------
function updateCourseEvents() {
  // 区間の切り替え
  const zi = Math.min(ZONES.length - 1, Math.floor(distance / 100));
  if (zi !== currentZone) {
    currentZone = zi;
    const z = ZONES[zi];
    FX.showBanner(z.name, z.sub, "#ffe14d", 1.8, 3);
    AudioSys.playZone();
    showInfoCard(z.jp, z.desc || "", "", 2600);
    addLog(`ENTERING ${z.name}: ${z.sub}`);
  }

  // 増水：警報 → 水位の上下
  if (!floodWarned && distance >= FLOOD_WARN_AT) {
    floodWarned = true;
    sirenTime = 3.2;
    FX.showBanner("WARNING!", "HEAVY RAIN", "#ff4d6d", 2.2, 3);
    AudioSys.playSiren();
    showInfoCard("大雨警報！ 水位が上がってくるぞ！", "水にふれるとダメージ！ 上へにげよう！", "", 3000);
    addLog("ALERT: HEAVY RAIN - WATER LEVEL RISING", "danger");
  }
  floodK = floodAmountAt(distance);
  waterLevel = WATER_BASE + floodK * diff.floodRise;
  Music.intense = floodK > 0.05;
}

