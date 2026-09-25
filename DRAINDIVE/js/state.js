// ============================================================
// js/state.js — ゲーム状態（体力・スコア・進行の変数）
// ※ index.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// ゲーム状態
// ============================================================
let hp = 100;
let score = 0;
let distance = 0;
const goalDistance = 300; // メートル換算
const zToMeterRatio = 10; // Z座標10単位 = 1メートル
const baseSpeed = 1.3;
let isGameOver = false;
let isGameStarted = false;
let isPaused = false;
let shakeIntensity = 0.0; // 画面ブレ（カメラシェイク）の強度

// 点検成績の集計
let inspectedCount = 0; // スキャン成功数
let missedCount = 0; // 見逃し（スキャンせず通過）数
let collidedCount = 0; // 障害物への衝突数

// コンボ状態
let combo = 0;
let maxCombo = 0;
let comboExpire = 0; // このミリ秒時刻までに次を発見しないとコンボが切れる
const COMBO_WINDOW = 4000;
const COMBO_MAX_MULT = 5;

// カメラの傾き（ドローンの機体挙動演出）は描画セクションの camRoll / camPitch を使う

// 演出・進行の状態
let anomalyFound = 0; // 点検に成功した壁の異常の数（ランクは QTE の成功数 qteSuccess で決める）
let hitStop = 0; // >0 のあいだ時間を止める（当たった瞬間の強調）
let countdown = 0; // >0 のあいだはスタート前のカウントダウン
let goalAnim = -1; // >=0 のときゴール演出中（経過秒）
let gameOverDelay = 0; // 墜落してからゲームオーバー画面を出すまでの残り時間
let resultShown = false; // クリア／ゲームオーバー画面が出ているか
let speedFactor = 0; // 0〜1：スピード演出の強さ
let currentZone = 0;
let floodWarned = false;
let sirenTime = 0; // 大雨警報の警告灯を出す残り時間

