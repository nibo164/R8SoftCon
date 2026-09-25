// ============================================================
// js/main.js — メインループと起動処理
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// メインループ
let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  // 経過秒（フレームレートが変わっても同じ速さで進むように、移動量はすべてこれを掛ける）
  const nowTime = performance.now();
  let dt = Math.min(0.05, (nowTime - lastFrameTime) / 1000);
  lastFrameTime = nowTime;
  let f60 = dt * 60; // 60fps 換算で何フレーム分か

  // ゲームパッドはタイトル・ポーズ・リザルト画面でも操作できるよう常にポーリングする
  Pad.poll();

  // 一時停止状態（演出も止める）
  if (isPaused) {
    renderFrame();
    return;
  }

  // ゴール演出中
  if (goalAnim >= 0) {
    updateGoal(dt);
    FX.update(dt, 0);
    renderFrame();
    return;
  }

  // 墜落後・リザルト表示中
  if (isGameOver) {
    if (gameOverDelay > 0) {
      gameOverDelay -= dt;
      if (gameOverDelay <= 0) showGameOverScreen();
    }
    FX.update(dt, 0);
    let sx = 0;
    let sy = 0;
    if (shakeIntensity > 0) {
      sx = (Math.random() - 0.5) * shakeIntensity;
      sy = (Math.random() - 0.5) * shakeIntensity;
      shakeIntensity *= Math.pow(0.9, f60);
    }
    renderFrame(sx, sy);
    return;
  }

  // 開始前の待機状態（ホバリング演出）
  if (!isGameStarted || countdown > 0) {
    cam.y = Math.sin(Date.now() * 0.002) * 0.15;
    cam.x = Math.cos(Date.now() * 0.0015) * 0.15;
    if (countdown > 0) updateCountdown(dt);
    FX.update(dt, 0);
    renderFrame();
    return;
  }

  // ヒットストップ：一瞬だけ時間を止めて「当たった！」を強調する
  if (hitStop > 0) {
    hitStop -= dt;
    FX.flashA = Math.max(0, FX.flashA - dt * 2);
    renderFrame();
    return;
  }

  // 点検 QTE（開始判定・判定・スローモーションの出入り）は実時間で進める。
  // ここから下の dt / f60 は「ゲーム内の時間」で、スロー中はゆっくり進む
  updateQte(dt);
  const realDt = dt;
  dt *= timeScale;
  f60 = dt * 60;

  // 進行処理（奥へ進むほど少しずつ加速する。増水中は流れに押されてさらに速い）
  const speedPerFrame = (baseSpeed + (distance / goalDistance) * 0.6) * diff.speedMul;
  const speed = speedPerFrame * 60 * (1 + floodK * 0.25); // 1秒あたり
  cam.z -= speed * dt;
  distance = Math.abs(cam.z) / zToMeterRatio;
  speedFactor = Math.max(0, Math.min(1, (speed / 60 - baseSpeed) / 0.8 + 0.25));

  // スピードに応じて視野を広げる（ワープ感）。スロー中は少しズームして対象に寄る
  focal = BASE_FOCAL * (1 - 0.16 * speedFactor) * (1 + 0.2 * slowAmount());

  // ゴール判定
  if (distance >= goalDistance) {
    updateUI();
    startGoal();
    return;
  }

  updateCourseEvents();

  // プレイヤー移動処理（キーボードとゲームパッドの両対応）
  const moveSpeed = 0.25 * 60; // 1秒あたり
  let inputX = 0;
  let inputY = 0;
  if (keys.ArrowUp || keys.w) inputY += 1;
  if (keys.ArrowDown || keys.s) inputY -= 1;
  if (keys.ArrowLeft || keys.a) inputX -= 1;
  if (keys.ArrowRight || keys.d) inputX += 1;

  // ゲームパッドのアナログ入力を合成（キーボード入力がない軸のみ採用）
  if (Pad.connected) {
    if (inputX === 0) inputX = Pad.axisX;
    if (inputY === 0) inputY = Pad.axisY;
  }

  // 斜め移動が速くなりすぎないよう正規化
  const inputLen = Math.hypot(inputX, inputY);
  if (inputLen > 1) {
    inputX /= inputLen;
    inputY /= inputLen;
  }

  cam.x += inputX * moveSpeed * dt;
  cam.y += inputY * moveSpeed * dt;

  // カーブの遠心力：曲がる向きと反対へ押し流される（ハンドル操作が必要になる）
  const curv = courseCurvature(cam.z);
  const v2 = speed * speed;
  cam.x -= curv.x * v2 * 0.08 * dt;
  cam.y -= curv.y * v2 * 0.08 * dt;

  // 移動方向とカーブに応じて機体とカメラを傾ける（ロール・ピッチ演出）
  const lerp = 1 - Math.pow(1 - 0.08, f60);
  const bankTarget = -inputX * 0.1 - curv.x * v2 * 0.003;
  camRoll += (bankTarget - camRoll) * lerp;
  camPitch += (inputY * 0.05 - camPitch) * lerp;
  droneBank += (-inputX * 0.35 - droneBank) * (1 - Math.pow(1 - 0.2, f60));
  hurtBlink = Math.max(0, hurtBlink - dt);
  sirenTime = Math.max(0, sirenTime - dt);

  // ドローンの噴射の粒（後ろへ流れてスピード感を出す）
  if (Math.random() < f60 * 0.6) {
    FX.mote(
      cam.x + (Math.random() - 0.5) * 1.2,
      cam.y - 0.2,
      cam.z + 0.5,
      (Math.random() - 0.5) * 2,
      -1,
      speed * 0.35,
      Math.random() < 0.5 ? "#8fe8ff" : "#ffffff",
      0.25,
      0.15,
    );
  }

  // 増水中の雨だれ（天井から落ちてくる水）
  if (floodK > 0 && Math.random() < f60 * floodK * 1.5) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 2;
    FX.mote(
      Math.cos(a) * (pipeRadius - 0.5),
      Math.sin(a) * (pipeRadius - 0.5),
      cam.z - 20 - Math.random() * 60,
      0,
      -18,
      0,
      "#9fd4ff",
      1.2,
      0.18,
    );
  }

  // 壁との衝突判定
  const distFromCenter = Math.sqrt(cam.x ** 2 + cam.y ** 2);
  if (distFromCenter > pipeRadius - 1) {
    hp -= dmg(30) * dt; // 壁接触ダメージ（持続）
    shakeIntensity = Math.min(0.2, shakeIntensity + 1.8 * dt); // 壁接触時は微小な画面ブレ
    // 壁の外に出ないように押し戻す
    const push = Math.pow(0.95, f60);
    cam.x *= push;
    cam.y *= push;

    // 火花
    if (Math.random() < f60 * 0.5) {
      FX.burst(cam.x * 1.05, cam.y * 1.05, cam.z, ["#ffe14d", "#ffffff", "#ff9a3c"], 3, 6, 0.3);
    }
    // ログ表示と接触音を間引いて出力
    if (Math.random() < f60 * 0.1) AudioSys.playScrape();
    if (Math.random() < f60 * 0.05) {
      addLog("SYS WARNING: HULL CONTACT DETECTED", "warning");
    }
  }

  // 水面との接触判定（増水中に下を飛ぶとダメージ）
  if (cam.y - 0.5 < waterLevel) {
    hp -= dmg(20) * dt;
    shakeIntensity = Math.min(0.25, shakeIntensity + 1.8 * dt);
    if (Math.random() < f60 * 0.6) {
      FX.burst(cam.x, waterLevel, cam.z - 1, ["#9fd4ff", "#e0f6ff", "#6d8f7a"], 4, 7, 0.5);
    }
    if (Math.random() < f60 * 0.06) AudioSys.playSplash();
    if (Math.random() < f60 * 0.04) addLog("SYS WARNING: WATER CONTACT", "warning");
  }

  // オブジェクトとの衝突判定
  hazards.forEach((h) => {
    if (h.active && hitsBox(h.box)) {
      hp -= dmg(15);
      shakeIntensity = 0.9; // 障害物衝突時は大きな画面ブレ
      hitStop = 0.1;
      hurtBlink = 0.7;
      h.active = false;
      h.counted = true;
      collidedCount++;
      h.visible = false;
      AudioSys.playDamage();
      FX.flash("255,40,40", 0.55);
      FX.crack();
      FX.burst(cam.x, cam.y, cam.z - 1, HAZARD_COLORS[h.type], 30, 10, 0.9);
      combo = 0; // ぶつかるとコンボが切れる
      updateComboUI();

      if (h.type === "sediment") {
        addLog("SYS DANGER: SEDIMENT COLLISION DETECTED (-15%)", "danger");
      } else if (h.type === "roots") {
        addLog("SYS DANGER: TREE ROOT COLLISION DETECTED (-15%)", "danger");
      } else {
        addLog("SYS DANGER: LEAK COLLISION DETECTED (-15%)", "danger");
      }
    }
  });

  // マンホール整備ポイント（チェックポイント）の通過判定
  manholes.forEach((m) => {
    if (!m.passed && cam.z < m.z) {
      m.passed = true;
      hp = Math.min(100, hp + 15);
      AudioSys.playCheckpoint();
      FX.showBanner("CHECKPOINT!", "HP +15", "#6dff7a", 1.5, 2);
      FX.flash("255,240,180", 0.35);
      addLog("MAINTENANCE POINT: INTEGRITY +15%");
      showInfoCard("チェックポイント！ 体力+15%", "", "trivia", 1800);
    }
  });

  // コンボは QTE の連続成功で数える（MISS か衝突で切れる。時間切れはない）
  FX.update(realDt, speedFactor * timeScale, dt);

  // 墜落判定
  if (hp <= 0) {
    updateUI();
    crashDrone();
    return;
  }

  updateUI();

  // 画面ブレ（描画用のカメラ位置だけ一時的にずらす）
  let shakeX = 0;
  let shakeY = 0;
  if (shakeIntensity > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity;
    shakeY = (Math.random() - 0.5) * shakeIntensity;
  }

  renderFrame(shakeX, shakeY);

  // 画面ブレの減衰
  if (shakeIntensity > 0) {
    shakeIntensity *= Math.pow(0.85, f60);
    if (shakeIntensity < 0.01) {
      shakeIntensity = 0;
    }
  }
}

// リサイズ対応（縦横比が変わったら画面バッファを作り直す）
window.addEventListener("resize", setupScreen);

// 難易度の初期値（タイトル画面のボタンの表示もそろえる）
setDifficulty(diff.key);
updateModeLabels();

// タイトル画面のドローン（ゲーム内と同じドット絵。2コマを切り替えてローターを回す）
(function setupTitleDrone() {
  const img = document.getElementById("titleDrone");
  if (!img) return;
  const urls = droneFrames.map((c) => c.toDataURL());
  let f = 0;
  img.src = urls[0];
  setInterval(() => {
    if (isGameStarted) return; // タイトルが見えているときだけ回す
    f = (f + 1) % urls.length;
    img.src = urls[f];
  }, 70);
})();

// ゲーム開始
animate();
