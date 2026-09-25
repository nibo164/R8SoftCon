// ============================================================
// js/ui.js — 画面表示：ログ・通知カード・HUD・点検レポート・点検図鑑
// ※ pixel.html から決まった順番で読み込む（普通の <script>。変数や関数はファイルをまたいで共有される）
//    読み込んだ時点で動く処理は、自分より前のファイルの中身だけを使うこと
// ============================================================

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

// ============================================================
// 通知カード（発見・区間・警報などを短く知らせる。テンポを止めないよう小さく短く）
//   desc が空なら1行だけの通知になる。詳しい解説は結果画面で読める
// ============================================================
let infoCardTimer = null;
function showInfoCard(title, desc, extraClass = "", duration = 1800) {
  const card = document.getElementById("infoCard");
  document.getElementById("infoTitle").innerText = title;
  const descEl = document.getElementById("infoDesc");
  descEl.innerText = desc;
  descEl.style.display = desc ? "block" : "none";
  card.className = extraClass;
  card.style.display = "block";
  card.offsetHeight; // リフロー強制
  card.classList.add("show");

  if (infoCardTimer) clearTimeout(infoCardTimer);
  infoCardTimer = setTimeout(hideInfoCard, duration);
}

function hideInfoCard() {
  const card = document.getElementById("infoCard");
  if (!card) return;
  card.classList.remove("show");
  if (infoCardTimer) clearTimeout(infoCardTimer);
  infoCardTimer = setTimeout(() => {
    card.style.display = "none";
  }, 300);
}

// コンボ表示の更新（表示そのものは renderOverlay でドット文字として描く）
function updateComboUI() {
  if (combo >= 2) FX.comboPop = 0.15; // 増えた瞬間だけ文字を大きくする
  else FX.comboPop = 0;
}

// UI更新
const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const inspectedEl = document.getElementById("inspected");
const distanceEl = document.getElementById("distance");
const hpBarEl = document.getElementById("hpBar");
const distBarEl = document.getElementById("distBar");
const sysStatusEl = document.getElementById("sysStatus");

function updateUI() {
  const safeHp = Math.max(0, Math.floor(hp));
  hpEl.innerText = `${safeHp}%`;
  hpBarEl.style.width = `${safeHp}%`;

  scoreEl.innerText = score;
  inspectedEl.innerText = `${qteSuccess} / ${qteTargets.length}`;

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

// ============================================================
// 点検レポート（クリア時）：発見率から技師ランクを認定
//   成功率 = 点検 QTE の成功数 / 点検ポイントの数（9か所）
//   しきい値はゲーム内の目安。実際に遊んで調整する
// ============================================================
const RANKS = [
  {
    min: 0.85,
    rank: "S",
    cls: "rank-S",
    title: "マスター点検技師",
    comment:
      "パーフェクトに近い点検！きみは未来のまちのインフラを守るエースだ！",
  },
  {
    min: 0.65,
    rank: "A",
    cls: "rank-A",
    title: "一人前の点検技師",
    comment: "すばらしい点検技術！本物の点検技師も顔負けだ！",
  },
  {
    min: 0.4,
    rank: "B",
    cls: "rank-B",
    title: "見習い点検技師",
    comment: "いい調子！見逃した異常を、もう一度探しに行ってみよう！",
  },
  {
    min: 0,
    rank: "C",
    cls: "rank-C",
    title: "点検研修生",
    comment: "まずは無事にゴールできてOK！次はもっと異常を見つけてみよう！",
  },
];

// ============================================================
// 土木PR演出：点検が守った暮らし（世帯数）
// 異常を1件見つけるごとに、その先の暮らしを守れたものとして換算する。
// ※実データではなくゲーム内の目安。画面にも注記を出している。
// ============================================================
const HOUSEHOLDS_PER_FIND = 40; // 点検ポイントが9か所に減ったので、1か所あたりの目安を大きくした

// 世帯数を実感しやすい身近なスケールに言い換える
function householdComment(n) {
  if (n <= 0) {
    return "異常を見つけると、その先の暮らしを守ることができるよ。次はきっと見つかる！";
  }
  const people = n * 2.2; // 1世帯あたり約2.2人として概算
  if (n < 40) {
    return `およそ ${Math.round(people)} 人ぶんの毎日の水まわりを、きみが守ったよ。`;
  }
  if (n < 150) {
    return `小学校ひとクラス〜1学年ぶんをこえる人数の暮らしを守ったよ。すごい！`;
  }
  if (n < 400) {
    return `小さな町内会まるごとの暮らしを、きみの点検が支えたよ！`;
  }
  return `${Math.round(people)} 人ぶん、小学校まるごとの暮らしを守り抜いた！文句なしのプロだ！`;
}

// 数字のカウントアップ演出
function animateCount(el, to, duration = 1200) {
  if (!el) return;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    // ease-out
    const eased = 1 - Math.pow(1 - t, 3);
    el.innerText = Math.round(to * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// 図鑑のアイコン：ゲーム内と同じドット絵を、コンクリートの上に描いた 32x32 の画像
//   未発見のものは黒いシルエットにする（何がいるのか気になるように）
const codexIconCache = {};
function codexIconURL(type, found) {
  const key = type + (found ? "" : "?");
  if (codexIconCache[key]) return codexIconCache[key];

  const c = makeCanvas(TEX, TEX);
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  if (found) {
    const bg = g.createImageData(TEX, TEX);
    bg.data.set(zoneTextures[0]);
    g.putImageData(bg, 0, 0);
  } else {
    g.fillStyle = "#0c1018";
    g.fillRect(0, 0, TEX, TEX);
  }

  let art;
  if (type === "corrosion") art = pixelsToCanvas(createCorrosion(0).img);
  else if (type === "crack") art = pixelsToCanvas(createCrack(0).img);
  else if (type === "rebar") art = pixelsToCanvas(createRebar(0).img);
  else if (type === "leak") art = leakFrames[0][LIGHT_LEVELS];
  else if (type === "sediment") art = createSedimentSprite()[LIGHT_LEVELS];
  else art = createRootsSprite()[LIGHT_LEVELS];

  if (!found) {
    // シルエット：ドット絵の形だけを暗い色でぬりつぶす
    const sil = makeCanvas(art.width, art.height);
    const sg = sil.getContext("2d");
    sg.drawImage(art, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = "#2a3242";
    sg.fillRect(0, 0, art.width, art.height);
    art = sil;
  }

  // 縦横比を保って中央に置く（大きいものだけ縮める）
  const s = Math.min(1, (TEX - 4) / art.width, (TEX - 4) / art.height);
  const w = Math.round(art.width * s);
  const h = Math.round(art.height * s);
  g.drawImage(art, Math.floor((TEX - w) / 2), Math.floor((TEX - h) / 2), w, h);

  codexIconCache[key] = c.toDataURL();
  return codexIconCache[key];
}

// 点検図鑑グリッドの描画
function renderCodex() {
  const grid = document.getElementById("codexGrid");
  if (!grid) return;
  grid.innerHTML = "";

  let discovered = 0;
  CODEX_ORDER.forEach((key) => {
    const info = ANOMALY_INFO[key];
    const total = codexSession[key];
    const thisRun = codexRun[key];
    const found = total > 0;
    if (found) discovered++;

    const cell = document.createElement("div");
    cell.className = `codex-cell${found ? " found" : ""}${thisRun > 0 ? " fresh" : ""}`;

    const icon = document.createElement("div");
    icon.className = "codex-icon";
    const iconImg = document.createElement("img");
    iconImg.src = codexIconURL(key, found);
    iconImg.alt = found ? info.short : "？";
    icon.appendChild(iconImg);
    cell.appendChild(icon);

    const name = document.createElement("div");
    name.className = "codex-name";
    name.innerText = found ? info.short : "？？？";
    cell.appendChild(name);

    const count = document.createElement("div");
    count.className = "codex-count";
    count.innerText = found ? `累計 ${total} 件` : "みはっけん";
    cell.appendChild(count);

    if (thisRun > 0) {
      const badge = document.createElement("div");
      badge.className = "codex-new";
      badge.innerText = `+${thisRun}`;
      cell.appendChild(badge);
    }

    // 発見済みなら解説をツールチップとして持たせる
    if (found) cell.title = info.desc;

    grid.appendChild(cell);
  });

  const prog = document.getElementById("codexProgress");
  if (prog) prog.innerText = `${discovered} / ${CODEX_ORDER.length} 種類`;

  const hint = document.getElementById("codexHint");
  if (hint) {
    if (discovered >= CODEX_ORDER.length) {
      hint.innerText = "★ 図鑑コンプリート！6種類すべての異常を見つけたよ！";
      hint.className = "codex-hint complete";
    } else {
      hint.innerText = `あと ${CODEX_ORDER.length - discovered} 種類でコンプリート！もう一度もぐって探そう！`;
      hint.className = "codex-hint";
    }
  }
}

// ============================================================
// タイトル画面から開く点検図鑑
//   左：6種類のマス（未発見はシルエットと「？？？」） / 右：選んだものの詳しい説明
//   開く：C キー / ゲームパッド Y / 右上のボタン
//   選ぶ：←→↑↓・十字キー・マウス　もどる：ESC・C / B・Y / もどるボタン
// ============================================================
let codexOpen = false;
let codexSel = 0;
const CODEX_COLS = 3;
const CODEX_KIND_TEXT = {
  corrosion: "壁の異常（撮影して記録する）",
  crack: "壁の異常（撮影して記録する）",
  rebar: "壁の異常（撮影して記録する）",
  leak: "障害物（撮影して取りのぞく）",
  sediment: "障害物（撮影して取りのぞく）",
  roots: "障害物（撮影して取りのぞく）",
};
const codexScreenEl = document.getElementById("codexScreen");

function openCodexScreen() {
  if (codexOpen || isGameStarted || isGameOver || !codexScreenEl) return;
  codexOpen = true;
  codexSel = 0;
  buildCodexScreen();
  codexScreenEl.style.display = "flex";
  codexScreenEl.offsetHeight; // リフロー強制
  codexScreenEl.style.opacity = 1;
  AudioSys.init();
  AudioSys.resume();
  AudioSys.tone(660, 990, 0.1, "square", 0.08);
}

function closeCodexScreen() {
  if (!codexOpen) return;
  codexOpen = false;
  blurActiveButton();
  codexScreenEl.style.opacity = 0;
  setTimeout(() => {
    if (!codexOpen) codexScreenEl.style.display = "none";
  }, 300);
  AudioSys.tone(990, 660, 0.1, "square", 0.08);
}

// 選択を動かす（左右は1マス、上下は1段。端まで行くと反対側へ回る）
function moveCodexSel(dx, dy) {
  const n = CODEX_ORDER.length;
  const i = (((codexSel + dx + dy * CODEX_COLS) % n) + n) % n;
  if (i === codexSel) return;
  codexSel = i;
  updateCodexSelection();
  AudioSys.tone(880, 880, 0.05, "square", 0.06);
}

function buildCodexScreen() {
  const grid = document.getElementById("codexScreenGrid");
  grid.innerHTML = "";
  let discovered = 0;
  CODEX_ORDER.forEach((key, i) => {
    const info = ANOMALY_INFO[key];
    const found = codexSession[key] > 0;
    if (found) discovered++;

    const cell = document.createElement("div");
    cell.className = `codex-cell${found ? " found" : ""}`;
    const icon = document.createElement("div");
    icon.className = "codex-icon";
    const img = document.createElement("img");
    img.src = codexIconURL(key, found);
    img.alt = found ? info.short : "？";
    icon.appendChild(img);
    cell.appendChild(icon);
    const name = document.createElement("div");
    name.className = "codex-name";
    name.innerText = found ? info.short : "？？？";
    cell.appendChild(name);

    cell.addEventListener("mouseenter", () => {
      if (codexSel === i) return;
      codexSel = i;
      updateCodexSelection();
    });
    grid.appendChild(cell);
  });

  const prog = document.getElementById("codexScreenProgress");
  if (prog) {
    prog.innerText =
      discovered >= CODEX_ORDER.length
        ? `★ コンプリート！ ${discovered} / ${CODEX_ORDER.length} 種類`
        : `発見 ${discovered} / ${CODEX_ORDER.length} 種類　点検ポイント「！」で撮影して集めよう`;
  }
  updateCodexSelection();
}

function updateCodexSelection() {
  const grid = document.getElementById("codexScreenGrid");
  [...grid.children].forEach((c, i) => c.classList.toggle("selected", i === codexSel));

  const key = CODEX_ORDER[codexSel];
  const info = ANOMALY_INFO[key];
  const count = codexSession[key];
  const found = count > 0;
  document.getElementById("codexDetail").classList.toggle("found", found);
  document.getElementById("codexDetailImg").src = codexIconURL(key, found);
  document.getElementById("codexDetailName").innerText = found ? info.name : "？？？";
  document.getElementById("codexDetailKind").innerText = CODEX_KIND_TEXT[key];
  document.getElementById("codexDetailDesc").innerText = found
    ? info.desc
    : "まだ見つけていない。点検ポイント「！」で撮影すると、ここに記録されるよ。";
  document.getElementById("codexDetailCount").innerText = found
    ? `これまでに ${count} 回 点検した`
    : "";
}

document.getElementById("codexOpenBtn").addEventListener("click", () => {
  blurActiveButton();
  openCodexScreen();
});
document.getElementById("codexCloseBtn").addEventListener("click", () => {
  closeCodexScreen();
});

function showClearScreen() {
  updatePauseBtn();
  resultShown = true;
  const rate = qteTargets.length > 0 ? qteSuccess / qteTargets.length : 0;
  const r = RANKS.find((x) => rate >= x.min);

  const badge = document.getElementById("rankBadge");
  badge.innerText = r.rank;
  badge.className = `rank-badge ${r.cls}`;
  document.getElementById("rankTitle").innerText = `認定: ${r.title}`;
  document.getElementById("rankComment").innerText = r.comment;

  const sub = document.getElementById("clearSubtitle");
  if (sub) sub.innerText = `点検完了レポート（300m / ${diff.label}）`;
  document.getElementById("finalFound").innerText =
    `${qteSuccess} / ${qteTargets.length} 回（PERFECT ${qtePerfect}）`;
  document.getElementById("finalMissed").innerText = `${missedCount} 回`;
  document.getElementById("finalRate").innerText = `${Math.round(rate * 100)}%`;
  document.getElementById("finalCombo").innerText = `×${Math.max(1, maxCombo)}`;
  document.getElementById("finalScore").innerText = score;
  document.getElementById("finalHp").innerText =
    `${Math.max(0, Math.floor(hp))}%`;

  // 土木PR: 守った暮らし（世帯数）
  const households = inspectedCount * HOUSEHOLDS_PER_FIND;
  const noteEl = document.getElementById("impactNote");
  if (noteEl) noteEl.innerText = householdComment(households);
  animateCount(document.getElementById("impactHouseholds"), households);

  // 土木PR: 点検図鑑
  renderCodex();

  // 土木PR: 豆知識（プレイ中はテンポを優先して出さず、結果画面で1つ読んでもらう）
  const triviaEl = document.getElementById("resultTrivia");
  if (triviaEl) {
    triviaEl.innerText = `【土木マメ知識】${TRIVIA[triviaIdx % TRIVIA.length]}`;
    triviaIdx++;
  }

  const clearScreen = document.getElementById("clearScreen");
  if (clearScreen) {
    clearScreen.style.display = "flex";
    clearScreen.offsetHeight;
    clearScreen.style.opacity = 1;
  }
}

