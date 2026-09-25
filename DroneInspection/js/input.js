// ============================================================
// js/input.js — 入力：キーボード・ゲームパッド・ポーズメニュー・難易度の選択・メニューボタン
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// 入力状態
const keys = {};
function normalizeKey(e) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}
window.addEventListener("keydown", (e) => {
  keys[normalizeKey(e)] = true;
  // 図鑑を開いているあいだは、図鑑の操作だけ受け付ける
  if (codexOpen) {
    const k = normalizeKey(e);
    if (k === "ArrowLeft" || k === "a") moveCodexSel(-1, 0);
    else if (k === "ArrowRight" || k === "d") moveCodexSel(1, 0);
    else if (k === "ArrowUp" || k === "w") moveCodexSel(0, -1);
    else if (k === "ArrowDown" || k === "s") moveCodexSel(0, 1);
    else if (k === "Escape" || k === "c" || k === "Backspace") closeCodexScreen();
    e.preventDefault();
    return;
  }
  // タイトル画面：C で図鑑を開く
  if (!isGameStarted && !isGameOver && normalizeKey(e) === "c") {
    openCodexScreen();
    return;
  }
  // タイトル画面：←→（A・D）で難易度を選ぶ
  if (!isGameStarted && !isGameOver) {
    const k = normalizeKey(e);
    if (k === "ArrowLeft" || k === "a") selectDifficulty(-1);
    if (k === "ArrowRight" || k === "d") selectDifficulty(1);
  }
  // スペースキーで起動
  if (e.key === " " && !isGameStarted && !isGameOver) {
    startGame();
  }
  // 一時停止中のメニュー操作（↑↓ / W・S で選び、Enter / スペースで決定）
  if (isPaused && !isGameOver) {
    const k = normalizeKey(e);
    if (k === "ArrowUp" || k === "w") {
      e.preventDefault();
      setPauseSel(pauseSel - 1);
    } else if (k === "ArrowDown" || k === "s") {
      e.preventDefault();
      setPauseSel(pauseSel + 1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      decidePauseSel();
      return;
    }
  }
  // スペース / Enter で点検 QTE のタイミング押し
  if ((e.key === " " || e.key === "Enter") && isGameStarted && !isGameOver && !isPaused) {
    if (qtePress()) e.preventDefault();
  }
  // ESCキーで一時停止トグル
  if (e.key === "Escape" && isGameStarted && !isGameOver) {
    togglePause();
  }
  // Mキーでサウンドのミュート切り替え
  if (normalizeKey(e) === "m") {
    AudioSys.init();
    const muted = AudioSys.toggleMute();
    addLog(muted ? "SOUND: OFF" : "SOUND: ON");
  }
});
window.addEventListener("keyup", (e) => (keys[normalizeKey(e)] = false));

// ============================================================
// ゲームパッド対応（Gamepad API）
// 展示会でコントローラーを使って遊べるようにする。
//   左スティック / 十字キー : 移動
//   A(0) / R2(7)            : 点検スキャン（画面中央のレティクルで狙う）
//   START(9)                : 一時停止
//   A(0)                    : スタート・リスタート
//   一時停止中              : 上下で選択、A で決定、START / B(1) ですぐ再開
// ============================================================
const Pad = {
  connected: false,
  index: null,
  prevButtons: [],
  prevMenuDir: 0, // 一時停止メニューの上下入力（押した瞬間だけ反応させる）
  prevMenuDirX: 0, // タイトル画面の難易度選択の左右入力
  axisX: 0,
  axisY: 0,
  DEADZONE: 0.22,

  // ブラウザによっては getGamepads() が毎回新しいオブジェクトを返すのでフレーム毎に取得する
  get() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    // 記憶しているindexを優先し、なければ最初に見つかったものを使う
    if (this.index !== null && pads[this.index]) return pads[this.index];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        this.index = i;
        return pads[i];
      }
    }
    return null;
  },

  setConnected(on, label) {
    if (this.connected === on) return;
    this.connected = on;

    const item = document.getElementById("padStatusItem");
    if (item) item.style.display = on ? "flex" : "none";
    const status = document.getElementById("padStatus");
    if (status) status.innerText = on ? "GAMEPAD" : "KEYBOARD";

    // スタート画面の操作説明をパッド用に切り替える
    const padInfo = document.getElementById("padInstructions");
    if (padInfo) padInfo.style.display = on ? "block" : "none";
    const prompt = document.getElementById("startPrompt");
    if (prompt) {
      prompt.innerText = on
        ? "PRESS [A] BUTTON TO LAUNCH DRONE"
        : "PRESS [SPACE] TO LAUNCH DRONE";
    }

    if (on) addLog(`GAMEPAD CONNECTED: ${label || "CONTROLLER"}`);
    else addLog("GAMEPAD DISCONNECTED", "warning");
  },

  // 押した瞬間だけ true を返す（エッジ検出）
  pressed(pad, i) {
    const now = !!(pad.buttons[i] && pad.buttons[i].pressed);
    const before = !!this.prevButtons[i];
    return now && !before;
  },

  // 毎フレーム呼ぶ。移動量を this.axisX / this.axisY に入れる
  poll() {
    const pad = this.get();
    if (!pad) {
      this.setConnected(false);
      this.axisX = 0;
      this.axisY = 0;
      this.prevButtons = [];
      return;
    }
    this.setConnected(true, pad.id);

    // --- スティック入力（デッドゾーン処理つき） ---
    let ax = pad.axes[0] || 0;
    let ay = pad.axes[1] || 0;
    if (Math.abs(ax) < this.DEADZONE) ax = 0;
    if (Math.abs(ay) < this.DEADZONE) ay = 0;

    // --- 十字キー（D-pad: 12=上 13=下 14=左 15=右） ---
    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    if (btn(14)) ax = -1;
    if (btn(15)) ax = 1;
    if (btn(12)) ay = -1;
    if (btn(13)) ay = 1;

    this.axisX = Math.max(-1, Math.min(1, ax));
    // Gamepad APIのY軸は下が正。ゲーム内の上下と合わせるため反転する
    this.axisY = -Math.max(-1, Math.min(1, ay));

    // --- ボタン処理 ---
    const aPressed = this.pressed(pad, 0);
    const r2Pressed = this.pressed(pad, 7);
    const startPressed = this.pressed(pad, 9);
    const bPressed = this.pressed(pad, 1);
    const yPressed = this.pressed(pad, 3);
    // メニュー用の上下（-1: 上 / 1: 下）。スティックは大きく倒したときだけ
    const menuDir = ay < -0.5 ? -1 : ay > 0.5 ? 1 : 0;
    const menuMoved = menuDir !== 0 && menuDir !== this.prevMenuDir;
    this.prevMenuDir = menuDir;
    // 難易度選択用の左右（-1: 左 / 1: 右）
    const menuDirX = ax < -0.5 ? -1 : ax > 0.5 ? 1 : 0;
    const menuMovedX = menuDirX !== 0 && menuDirX !== this.prevMenuDirX;
    this.prevMenuDirX = menuDirX;

    if (aPressed || r2Pressed) {
      AudioSys.init();
      AudioSys.resume();
    }

    if (!isGameStarted && !isGameOver) {
      // 十字キー / スティックの左右で難易度を選び、A で発進
      // Y で点検図鑑を開く（図鑑の中は十字キーで選び、B / Y / START でもどる）
      if (codexOpen) {
        if (menuMovedX) moveCodexSel(menuDirX, 0);
        if (menuMoved) moveCodexSel(0, menuDir);
        if (bPressed || yPressed || startPressed) closeCodexScreen();
      } else if (yPressed) {
        openCodexScreen();
      } else {
        if (menuMovedX) selectDifficulty(menuDirX);
        if (aPressed) startGame();
      }
    } else if (isGameOver) {
      // クリア／ゲームオーバー画面：Aボタンでタイトルへ戻る
      // （結果画面が出てから。演出の途中で押してもタイトルへは戻らない）
      if (aPressed && resultShown) resetGame();
    } else if (isPaused) {
      // 一時停止中：上下で選んで A で決定。START / B はすぐ再開
      if (menuMoved) setPauseSel(pauseSel + menuDir);
      if (startPressed || bPressed) togglePause();
      else if (aPressed) decidePauseSel();
    } else {
      if (startPressed) togglePause();
      // 点検 QTE のタイミング押し
      if (aPressed || r2Pressed) qtePress();
    }

    // 次フレームのエッジ検出用に押下状態を保存
    this.prevButtons = pad.buttons.map((b) => b.pressed);
  },
};

window.addEventListener("gamepadconnected", (e) => {
  Pad.index = e.gamepad.index;
});
window.addEventListener("gamepaddisconnected", () => {
  Pad.index = null;
});

// ============================================================
// 一時停止メニュー
//   0: つづける / 1: やめてタイトルへもどる
//   マウス・キーボード（↑↓＋Enter）・ゲームパッド（上下＋A）で選べる
// ============================================================
const pauseBtnEl = document.getElementById("pauseBtn");
const pauseMenuBtns = [
  document.getElementById("resumeBtn"),
  document.getElementById("restartBtn"),
];
let pauseSel = 0;
let pausedAt = 0; // 一時停止した時刻（止めている間にコンボが切れないようにする）

function setPauseSel(i) {
  const n = pauseMenuBtns.length;
  pauseSel = (i + n) % n;
  pauseMenuBtns.forEach((b, k) => b.classList.toggle("selected", k === pauseSel));
}

function decidePauseSel() {
  if (pauseSel === 0) togglePause();
  else resetGame();
}

// プレイ中だけ画面上のポーズボタンを出す
function updatePauseBtn() {
  if (!pauseBtnEl) return;
  pauseBtnEl.style.display = isGameStarted && !isGameOver ? "block" : "none";
}

// ボタンに残ったフォーカスを外す（あとでスペースキーを押したときに
// フォーカスの残ったボタンが勝手に押されるのを防ぐ）
function blurActiveButton() {
  const el = document.activeElement;
  if (el && el.tagName === "BUTTON") el.blur();
}

// ============================================================
// 難易度の選択（タイトル画面）
//   ←→ / 十字キー / スティックで選び、SPACE / A で発進。クリックするとそのまま発進
// ============================================================
const DIFF_NOTES = {
  easy: "ゆっくり進むよ。最初に「撮影」の練習ができる",
  normal: "ふつうのスピード。点検ポイントは9か所",
  hard: "とても速い！点検ポイント12か所、判定もきびしい",
};
const diffBtns = DIFFICULTY_ORDER.map((k) => document.getElementById(`diff-${k}`));

function setDifficulty(key) {
  diff = DIFFICULTIES[key];
  diffBtns.forEach((b, i) => {
    if (b) b.classList.toggle("selected", DIFFICULTY_ORDER[i] === key);
  });
  const note = document.getElementById("diffNote");
  if (note) note.innerText = DIFF_NOTES[key];
}

function selectDifficulty(step) {
  const i = DIFFICULTY_ORDER.indexOf(diff.key);
  const ni = Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, i + step));
  if (ni === i) return;
  setDifficulty(DIFFICULTY_ORDER[ni]);
  AudioSys.init();
  AudioSys.resume();
  AudioSys.tone(880, 880, 0.06, "square", 0.08);
}

// HUD と結果画面に難易度を出す
function updateModeLabels() {
  const el = document.getElementById("modeLabel");
  if (el) el.innerText = diff.label;
}

diffBtns.forEach((b, i) => {
  if (!b) return;
  b.addEventListener("click", () => {
    blurActiveButton(); // あとでスペースキーを押したときに、このボタンが押されないように
    if (isGameStarted || isGameOver) return;
    setDifficulty(DIFFICULTY_ORDER[i]);
    startGame();
  });
  b.addEventListener("mouseenter", () => {
    if (!isGameStarted) setDifficulty(DIFFICULTY_ORDER[i]);
  });
});

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
// プレイ中のポーズボタン
pauseBtnEl.addEventListener("click", () => {
  if (isGameStarted && !isGameOver && !isPaused) togglePause();
  blurActiveButton();
});
// マウスを乗せたボタンを選択中にする（キー操作の選択と表示をそろえる）
pauseMenuBtns.forEach((b, i) => {
  b.addEventListener("mouseenter", () => setPauseSel(i));
});

