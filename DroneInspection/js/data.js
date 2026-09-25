// ============================================================
// js/data.js — 図鑑データ・図鑑の記録の保存・豆知識
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

// ============================================================
// 異常・障害物の図鑑データ（土木PR: 実際の下水道点検項目に基づく）
// ============================================================
const ANOMALY_INFO = {
  corrosion: {
    name: "腐食（ふしょく）",
    short: "腐食",
    icon: "◍",
    desc: "下水から発生する硫化水素がコンクリートを溶かしてボロボロに！下水道管の一番の大敵なんだ。",
  },
  crack: {
    name: "ひび割れ（クラック）",
    short: "ひび割れ",
    icon: "⚡",
    desc: "ひびを放っておくと管がこわれて、道路が陥没する原因に！小さいうちに見つけるのが大切。",
  },
  rebar: {
    name: "鉄筋露出（てっきんろしゅつ）",
    short: "鉄筋露出",
    icon: "≡",
    desc: "コンクリートの中の鉄筋がむき出しに！管の強度がグッと落ちてしまう危険なサインだよ。",
  },
  leak: {
    name: "浸入水（しんにゅうすい）",
    short: "浸入水",
    icon: "◆",
    desc: "すき間から地下水が入りこむと、下水処理場の負担が増えてしまう。流れを直さないと！",
  },
  sediment: {
    name: "堆積物（たいせきぶつ）",
    short: "堆積物",
    icon: "▲",
    desc: "土砂がたまると水があふれる原因に。しゅんせつ（そうじ）して流れを守ろう！",
  },
  roots: {
    name: "木の根の侵入",
    short: "木の根",
    icon: "⚘",
    desc: "木の根は管の継ぎ目のすき間から入りこんで水の流れをふさぐ。実はよくあるトラブル！",
  },
};

// 図鑑のグリッド表示順
const CODEX_ORDER = [
  "corrosion",
  "crack",
  "rebar",
  "leak",
  "sediment",
  "roots",
];

// 図鑑の発見記録
//   codexSession: これまでの累計。ブラウザ（localStorage）に保存し、次に開いたときも残る
//   codexRun:     今回のプレイでの発見数
//   撮影用：URL に ?codex=all を付けると全種類を発見済みに、?codex=reset を付けると記録を消す
const CODEX_STORAGE_KEY = "drainDive.codex.v1";
const codexSession = {};
const codexRun = {};
CODEX_ORDER.forEach((k) => {
  codexSession[k] = 0;
  codexRun[k] = 0;
});

// 保存できない環境（プライベートモードなど）でもゲームは動くよう、失敗は無視する
function loadCodex() {
  try {
    const saved = JSON.parse(localStorage.getItem(CODEX_STORAGE_KEY) || "{}");
    CODEX_ORDER.forEach((k) => {
      const n = Number(saved[k]);
      if (Number.isFinite(n) && n > 0) codexSession[k] = Math.floor(n);
    });
  } catch (e) {
    // 読めなければ空の図鑑から始める
  }
}
function saveCodex() {
  try {
    localStorage.setItem(CODEX_STORAGE_KEY, JSON.stringify(codexSession));
  } catch (e) {
    // 保存できなくても、このページを開いている間の記録は残る
  }
}
loadCodex();
(function applyCodexParam() {
  let mode = null;
  try {
    mode = new URLSearchParams(location.search).get("codex");
  } catch (e) {
    return;
  }
  if (mode === "all") {
    CODEX_ORDER.forEach((k) => (codexSession[k] = Math.max(1, codexSession[k])));
    saveCodex();
  } else if (mode === "reset") {
    CODEX_ORDER.forEach((k) => (codexSession[k] = 0));
    saveCodex();
  }
})();

function recordCodex(type) {
  if (!(type in codexSession)) return;
  codexSession[type]++;
  codexRun[type]++;
  saveCodex();
}

// マンホール通過時に表示する土木豆知識
const TRIVIA = [
  "日本の下水道管は全部つなぐと約49万km！地球を12周できる長さなんだ。",
  "古くなった下水道管がどんどん増えていて、点検できる人やロボットが大活躍中！",
  "本物の下水道点検でも、ドローンやカメラロボットが実際に使われているよ。",
  "マンホールのふたが丸いのは、どの向きでも穴に落ちないようにするためなんだ。",
  "下水道のおかげで、まちが清潔に保たれて川や海もきれいになっているよ。",
  "下水道管の点検は、道路陥没などの事故を防ぐとても大事な仕事なんだ。",
];
let triviaIdx = 0;

