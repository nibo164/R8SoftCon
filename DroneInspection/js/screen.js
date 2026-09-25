// ============================================================
// js/screen.js — 低解像度の画面の準備とドローン（カメラ）の位置
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 下水道インスペクター ドット絵疑似3D版（pixel.html 用）
// Three.js を使わず、Canvas 2D だけで疑似3Dを描画する。
//   - 下水管：低解像度画面の1ピクセルごとに視線と管の交点を計算して
//             ドット絵テクスチャを貼る（トンネル描画）。管は曲がりくねる
//   - 水面　：高さを持った水平な面。増水イベントで水位が上がる
//   - 壁の異常：管の壁面に直接描き込むデカール（遠近が正しくつく）
//   - 障害物：距離に応じて拡大縮小するスプライト（スペースハリアー方式）
//   - ドローン：少し後ろから追いかける視点で画面に表示する
// 動画映えする演出（破片・フラッシュ・ヒットストップ・BGM など）もここで行う。
// ============================================================

// 画面設定（縦180ピクセル固定。横幅はウィンドウの縦横比に合わせる）
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const SCREEN_H = 180;
const FOV = 75; // 縦方向の視野角（元の3D版と同じ）
const BASE_FOCAL = SCREEN_H / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
let focal = BASE_FOCAL; // スピードが上がると小さくして視野を広げる（ワープ感）
let SCREEN_W = 320;
let frameImage = null; // 管を描き込む画像バッファ
let frameBuf32 = null; // 上のバッファを32bit単位で書き込むためのビュー
let idBuf = null; // ピクセルごとに「どのデカール（壁の異常）が映っているか」
let depthBuf = null; // ピクセルごとの奥行き

function setupScreen() {
  SCREEN_W = Math.round(
    SCREEN_H * (window.innerWidth / Math.max(1, window.innerHeight)),
  );
  SCREEN_W = Math.max(200, Math.min(480, SCREEN_W));
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  ctx.imageSmoothingEnabled = false; // ドットをにじませない
  frameImage = ctx.createImageData(SCREEN_W, SCREEN_H);
  frameBuf32 = new Uint32Array(frameImage.data.buffer);
  idBuf = new Int16Array(SCREEN_W * SCREEN_H);
  depthBuf = new Float32Array(SCREEN_W * SCREEN_H);
}
setupScreen();

// ドローンの位置（「まっすぐな管」の座標系。管の曲がりは描画のときだけ加える）
//   x: 右が正 / y: 上が正 / z: 奥へ進むほど負
const cam = { x: 0, y: 0, z: 0 };

