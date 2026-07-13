// 初期設定
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("gameCanvas"),
});
renderer.setSize(window.innerWidth, window.innerHeight);

// コンクリートのカラーテクスチャを生成
function createConcreteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // ベースカラー（茶褐色に変色した汚れたコンクリート）
  ctx.fillStyle = "#4e3f30";
  ctx.fillRect(0, 0, 512, 512);

  // 細かなノイズでざらざら感を出す
  for (let i = 0; i < 30000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 1.5 + 0.5;
    const shade = Math.random() * 30 - 15; // 明るさ変化
    ctx.fillStyle = `rgba(${78 + shade}, ${63 + shade}, ${48 + shade}, 0.45)`;
    ctx.fillRect(x, y, size, size);
  }

  // 大きな汚れ・染みを描画
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = Math.random() * 60 + 20;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, "rgba(30, 20, 10, 0.65)");
    grad.addColorStop(0.5, "rgba(30, 20, 10, 0.3)");
    grad.addColorStop(1, "rgba(30, 20, 10, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // コンクリート管の目地（継ぎ目）を描画
  ctx.strokeStyle = "rgba(15, 10, 5, 0.85)";
  ctx.lineWidth = 6;
  // 横方向（円周方向）の継ぎ目
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  // 縦方向の継ぎ目
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300); // 歪みを減らすためのリピート設定
  return texture;
}

// 凹凸を表現するバンプマップを生成
function createConcreteBumpTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // 中間グレー（高さ0の基準）
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 512);

  // ザラザラした凹凸ノイズ
  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = Math.random() * 1.2 + 0.5;
    const val = Math.random() * 80 - 40; // 凹凸値
    const colorVal = Math.min(255, Math.max(0, 128 + val));
    ctx.fillStyle = `rgb(${colorVal}, ${colorVal}, ${colorVal})`;
    ctx.fillRect(x, y, size, size);
  }

  // 継ぎ目の溝（黒に近い色でへこませる）
  ctx.strokeStyle = "#202020";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300);
  return texture;
}

// 粗さ（水濡れ・光沢）を表現するラフネスマップを生成
function createConcreteRoughnessTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // 基本は粗い（反射が少ない＝白に近い）
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(0, 0, 512, 512);

  // 下水管の下部に水が溜まって濡れているのを表現（円周方向の一部を濃い黒にする）
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, "#d0d0d0");
  grad.addColorStop(0.35, "#c0c0c0");
  grad.addColorStop(0.45, "#151515"); // 濡れてテカテカ（低いラフネス）
  grad.addColorStop(0.55, "#151515");
  grad.addColorStop(0.65, "#c0c0c0");
  grad.addColorStop(1, "#d0d0d0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // ランダムな濡れ染みを追加（壁面から垂れる水滴の跡など）
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = Math.random() * 40 + 10;
    const rGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    rGrad.addColorStop(0, "#101010"); // 非常に滑らか
    rGrad.addColorStop(1, "#d0d0d0");
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 300);
  return texture;
}

// 下水管（コンクリート質感シリンダー）
const pipeRadius = 10;
const pipeLength = 3000;
const pipeGeo = new THREE.CylinderGeometry(
  pipeRadius,
  pipeRadius,
  pipeLength,
  32, // 分割数を増やしてバンプマップを滑らかに表現
  100,
  true,
);

const pipeMat = new THREE.MeshStandardMaterial({
  map: createConcreteTexture(),
  bumpMap: createConcreteBumpTexture(),
  bumpScale: 0.15,
  roughnessMap: createConcreteRoughnessTexture(),
  metalness: 0.1,
  side: THREE.BackSide,
});

const pipe = new THREE.Mesh(pipeGeo, pipeMat);
pipe.rotation.x = Math.PI / 2;
pipe.position.z = -pipeLength / 2;
scene.add(pipe);

// ライティングの追加
const ambientLight = new THREE.AmbientLight(0x222222); // 弱い環境光
scene.add(ambientLight);

// ドローンのヘッドライト（スポットライト）
const headLight = new THREE.SpotLight(
  0xffffff,
  4.0,
  150,
  Math.PI / 4,
  0.4,
  0.8,
);
headLight.position.set(0, 0, 0);
scene.add(camera); // スポットライトを追従させるためカメラをシーンに登録
camera.add(headLight);

// スポットライトの照射ターゲット（カメラの前方）
const lightTarget = new THREE.Object3D();
lightTarget.position.set(0, 0, -10);
camera.add(lightTarget);
headLight.target = lightTarget;

// オブジェクト管理
const hazards = []; // 漏水・堆積物等の障害物
const anomalies = []; // 腐食等のスコア対象

// ランダム配置
const objectCount = 60;
for (let i = 0; i < objectCount; i++) {
  // Z座標（進行方向）
  let z = -(Math.random() * (pipeLength - 50) + 50);
  let rand = Math.random();

  if (rand < 0.3) {
    // 障害物：漏水（天井から底まで流れる水柱）
    let x = (Math.random() * 2 - 1) * (pipeRadius - 3);
    let height = Math.sqrt(pipeRadius * pipeRadius - x * x) * 2;

    let geo = new THREE.CylinderGeometry(0.8, 2, height, 8);
    let mat = new THREE.MeshStandardMaterial({
      color: 0x33aaff,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.75,
      emissive: 0x002244,
    });
    let mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);

    const h = { mesh: mesh, active: true };
    mesh.userData = { type: "hazard", parent: h };
    hazards.push(h);
    scene.add(mesh);
  } else if (rand < 0.6) {
    // 障害物：堆積物（床の茶色い土砂山）
    // 高さは直径の最大4割 (20 * 0.4 = 8)
    let hVal = Math.random() * 6 + 2; // 2〜8のランダム

    let geo = new THREE.SphereGeometry(1, 16, 16);
    let mat = new THREE.MeshStandardMaterial({
      color: 0x5c4033, // 茶色（ダークブラウン）
      roughness: 0.9,
      metalness: 0.1,
    });
    let mesh = new THREE.Mesh(geo, mat);
    // 床面 (-pipeRadius) を中心に配置し、X方向の幅とZ方向の厚みをスケールで調整
    mesh.scale.set(7, hVal, 4);
    mesh.position.set(0, -pipeRadius, z);

    const h = { mesh: mesh, active: true };
    mesh.userData = { type: "sediment", parent: h };
    hazards.push(h);
    scene.add(mesh);
  } else {
    // スコアアノマリー：壁面の腐食・苔（扁平なカビや錆の塊）
    let angle = Math.random() * Math.PI * 2;
    let radius = pipeRadius - 0.3;
    let x = Math.cos(angle) * radius;
    let y = Math.sin(angle) * radius;

    let geo = new THREE.SphereGeometry(1.2, 8, 8);
    let isRust = Math.random() > 0.5;
    let color = isRust ? 0x8b4513 : 0x4d5d2f;
    let mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.9,
      metalness: 0.1,
    });
    let mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);

    mesh.lookAt(new THREE.Vector3(0, 0, z));
    mesh.scale.set(1.6, 1.6, 0.25);

    const a = { mesh: mesh, active: true };
    mesh.userData = { type: "anomaly", parent: a };
    anomalies.push(a);
    scene.add(mesh);
  }
}

// ゲーム状態
let hp = 100;
let score = 0;
let distance = 0;
const goalDistance = 300; // メートル換算
const zToMeterRatio = 10; // Z座標10単位 = 1メートル
const speed = 1.3;
let isGameOver = false;
let isGameStarted = false;
let isPaused = false;
let shakeIntensity = 0.0; // 画面ブレ（カメラシェイク）の強度

// 入力状態
const keys = {
  ArrowUp: false,
  ArrowDown: false,
  ArrowLeft: false,
  ArrowRight: false,
  w: false,
  a: false,
  s: false,
  d: false,
};
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  // スペースキーで起動
  if (e.key === " " && !isGameStarted && !isGameOver) {
    isGameStarted = true;
    const startScreen = document.getElementById("startScreen");
    if (startScreen) {
      startScreen.style.opacity = 0;
      setTimeout(() => {
        startScreen.style.display = "none";
      }, 500);
    }
  }
  // ESCキーで一時停止トグル
  if (e.key === "Escape" && isGameStarted && !isGameOver) {
    togglePause();
  }
});
window.addEventListener("keyup", (e) => (keys[e.key] = false));

// 一時停止切り替え
function togglePause() {
  isPaused = !isPaused;
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

  // カメラを初期位置へ
  camera.position.set(0, 0, 0);

  // 障害物とアノマリーの再アクティブ化とヘルパーの削除
  hazards.forEach((h) => {
    h.active = true;
    h.mesh.visible = true;
    if (h.helper) {
      scene.remove(h.helper);
      h.helper = null;
    }
  });
  anomalies.forEach((a) => {
    a.active = true;
    a.mesh.visible = true;
    if (a.helper) {
      scene.remove(a.helper);
      a.helper = null;
    }
  });

  // ログのクリア
  const logArea = document.getElementById("logArea");
  if (logArea) {
    logArea.innerHTML = "";
  }

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

// メニューボタンイベント設定
document.getElementById("resumeBtn").addEventListener("click", () => {
  if (isPaused) togglePause();
});
document.getElementById("restartBtn").addEventListener("click", () => {
  resetGame();
});
document.getElementById("clearBackBtn").addEventListener("click", () => {
  resetGame();
});
document.getElementById("gameOverBackBtn").addEventListener("click", () => {
  resetGame();
});

// システムログ出力関数
function addLog(text, type = "info") {
  const logArea = document.getElementById("logArea");
  if (!logArea) return;
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
  logArea.appendChild(entry);

  // 古いログの削除
  while (logArea.children.length > 5) {
    logArea.removeChild(logArea.firstChild);
  }

  // フェードアウト自動消去
  setTimeout(() => {
    if (entry.parentNode === logArea) {
      entry.style.opacity = 0;
      entry.style.transition = "opacity 0.5s ease";
      setTimeout(() => {
        if (entry.parentNode === logArea) logArea.removeChild(entry);
      }, 500);
    }
  }, 4000);
}

// Raycaster によるクリック判定（異常点検）
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener("click", (event) => {
  if (!isGameStarted || isPaused || isGameOver) return;
  // ボタンやHUDパネル内のクリックは除外
  if (event.target.tagName === "BUTTON" || event.target.closest("#hud")) return;

  // 正規化デバイス座標に変換
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // 判定対象メッシュの収集
  const clickTargets = [];
  hazards.forEach((h) => {
    if (h.active) clickTargets.push(h.mesh);
  });
  anomalies.forEach((a) => {
    if (a.active) clickTargets.push(a.mesh);
  });

  const intersects = raycaster.intersectObjects(clickTargets);
  if (intersects.length > 0) {
    const hitObject = intersects[0].object;
    const data = hitObject.userData;

    // 水色のレティクル（BoxHelper）を生成して対象物を囲む
    const helper = new THREE.BoxHelper(hitObject, 0x00e5ff);
    scene.add(helper);
    data.parent.helper = helper;

    if (data.type === "anomaly") {
      score += 100;
      data.parent.active = false;
      addLog("ANOMALY INSPECTED: CORROSION/MOLD (+100)", "info");
    } else if (data.type === "hazard") {
      score += 100;
      data.parent.active = false;
      addLog("LEAK INSPECTED: FLOW SECURED (+100)", "info");
    } else if (data.type === "sediment") {
      score += 100;
      data.parent.active = false;
      addLog("SEDIMENT INSPECTED: DREDGE COMPLETED (+100)", "info");
    }
    updateUI();
  }
});

// UI更新
const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const distanceEl = document.getElementById("distance");
const hpBarEl = document.getElementById("hpBar");
const distBarEl = document.getElementById("distBar");
const sysStatusEl = document.getElementById("sysStatus");

function updateUI() {
  const safeHp = Math.max(0, Math.floor(hp));
  hpEl.innerText = `${safeHp}%`;
  hpBarEl.style.width = `${safeHp}%`;

  scoreEl.innerText = score;

  const progress = Math.min(100, (distance / goalDistance) * 100);
  distBarEl.style.width = `${progress}%`;
  distanceEl.innerText = `${Math.floor(distance)}m / ${goalDistance}m`;

  // HPに応じたシステムステータスの切り替え
  if (safeHp > 50) {
    sysStatusEl.innerText = "ONLINE";
    sysStatusEl.className = "value green-text animate-pulse";
  } else if (safeHp > 20) {
    sysStatusEl.innerText = "WARNING";
    sysStatusEl.className = "value yellow-text animate-pulse";
  } else {
    sysStatusEl.innerText = "CRITICAL";
    sysStatusEl.className = "value red-text animate-pulse";
  }
}

// メインループ
function animate() {
  requestAnimationFrame(animate);
  if (isGameOver) {
    renderer.render(scene, camera);
    return;
  }

  // 一時停止状態
  if (isPaused) {
    renderer.render(scene, camera);
    return;
  }

  // 開始前の待機状態（ホバリング演出）
  if (!isGameStarted) {
    camera.position.y = Math.sin(Date.now() * 0.002) * 0.15;
    camera.position.x = Math.cos(Date.now() * 0.0015) * 0.15;
    renderer.render(scene, camera);
    return;
  }

  // 進行処理
  camera.position.z -= speed;
  distance = Math.abs(camera.position.z) / zToMeterRatio;

  // クリア判定
  if (distance >= goalDistance) {
    updateUI();
    isGameOver = true;

    // 最終リザルトをクリア画面に設定
    document.getElementById("finalScore").innerText = score;
    document.getElementById("finalHp").innerText =
      `${Math.max(0, Math.floor(hp))}%`;

    // クリア画面を表示
    const clearScreen = document.getElementById("clearScreen");
    if (clearScreen) {
      clearScreen.style.display = "flex";
      clearScreen.offsetHeight;
      clearScreen.style.opacity = 1;
    }
    return;
  }

  // プレイヤー移動処理
  let moveSpeed = 0.25;
  if (keys.ArrowUp || keys.w) camera.position.y += moveSpeed;
  if (keys.ArrowDown || keys.s) camera.position.y -= moveSpeed;
  if (keys.ArrowLeft || keys.a) camera.position.x -= moveSpeed;
  if (keys.ArrowRight || keys.d) camera.position.x += moveSpeed;

  // 壁との衝突判定
  let distFromCenter = Math.sqrt(
    camera.position.x ** 2 + camera.position.y ** 2,
  );
  if (distFromCenter > pipeRadius - 1) {
    hp -= 0.5; // 壁接触ダメージ（持続）
    shakeIntensity = Math.min(0.2, shakeIntensity + 0.03); // 壁接触時は微小な画面ブレ
    // 壁の外に出ないように押し戻す
    camera.position.x *= 0.95;
    camera.position.y *= 0.95;

    // ログ表示を間引いて出力
    if (Math.random() < 0.05) {
      addLog("SYS WARNING: HULL CONTACT DETECTED", "warning");
    }
  }

  // オブジェクトとの衝突判定
  const camBox = new THREE.Box3().setFromCenterAndSize(
    camera.position,
    new THREE.Vector3(1, 1, 1),
  );

  hazards.forEach((h) => {
    if (h.active) {
      let hBox = new THREE.Box3().setFromObject(h.mesh);
      if (camBox.intersectsBox(hBox)) {
        hp -= 15;
        shakeIntensity = 0.7; // 障害物衝突時は大きな画面ブレ
        h.active = false;
        h.mesh.visible = false;

        const type = h.mesh.userData.type;
        if (type === "sediment") {
          addLog("SYS DANGER: SEDIMENT COLLISION DETECTED (-15%)", "danger");
        } else {
          addLog("SYS DANGER: LEAK COLLISION DETECTED (-15%)", "danger");
        }
      }
    }
  });

  // 死亡判定
  if (hp <= 0) {
    updateUI();
    isGameOver = true;

    // 最終リザルトをゲームオーバー画面に設定
    document.getElementById("failDistance").innerText =
      `${Math.floor(distance)}m`;
    document.getElementById("failScore").innerText = score;

    // ゲームオーバー画面を表示
    const gameOverScreen = document.getElementById("gameOverScreen");
    if (gameOverScreen) {
      gameOverScreen.style.display = "flex";
      gameOverScreen.offsetHeight;
      gameOverScreen.style.opacity = 1;
    }
    return;
  }

  updateUI();

  // レンダリング直前に画面ブレ（一時的にカメラ位置をずらす）を適用
  let shakeX = 0;
  let shakeY = 0;
  if (shakeIntensity > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity;
    shakeY = (Math.random() - 0.5) * shakeIntensity;
    camera.position.x += shakeX;
    camera.position.y += shakeY;
  }

  renderer.render(scene, camera);

  // 描画後に元の位置に戻す
  if (shakeIntensity > 0) {
    camera.position.x -= shakeX;
    camera.position.y -= shakeY;

    // 画面ブレの減衰
    shakeIntensity *= 0.85;
    if (shakeIntensity < 0.01) {
      shakeIntensity = 0;
    }
  }
}

// リサイズ対応
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ゲーム開始
animate();
