// そうさ先生: 設定値・状態・画面の部品（el）・保存される設定・読み上げ
// ほかのファイルはすべて、ここで作る state と el を使う

// ─── Change detection（tools/capture-test.html と同じ） ─
const GRID_W = 192, GRID_H = 108; // 変化検出用の縮小グリッド（文字入力とカーソルを見分けられる細かさ）
const PIXEL_DIFF = 18;            // 1セルを「変化あり」とみなす輝度差 (0-255)
const STABLE_MAX = 0.05;          // 確定画面との差の増減がこれ未満なら「操作が落ち着いた」(%)
const CURSOR_CELLS = 14;          // これ以下のマス数の小さな変化の塊はカーソルとみなして無視
const CURSOR_BLOBS_MAX = 3;       // 小さな塊がこれより多く同時に出たら、カーソルではなく本当の変化とみなす（カーソルの前後＋点滅する文字カーソルで3つまで）
const BLOB_GAP = 3;               // この距離（マス）以内の変化は同じ塊とみなす（文字の画数がばらけても1つにまとまる）
const THRESHOLD = 0.05;           // 確定画面との差がこれ以上なら「変化あり」(%)
const BAND_MEDIUM = 3, BAND_LARGE = 20;
const INTERVAL_MS = 1500;
const MAX_LOG = 8;
const PLAN_READ = { keepShot: true, icons: false };   // 計画の手順の文字認識（タブの見た目を比べるので画面も残す）
const IDLE_WATCH = "画面を見ています。やりたいことを書くと案内を始めます。";

function bandOf(ratio) { return ratio >= BAND_LARGE ? 3 : ratio >= BAND_MEDIUM ? 2 : 1; }

// ─── State ────────────────────────────────────────────
const state = {
  lessonId: "idle",
  step: 0,
  stream: null,
  imageCapture: null,
  timer: null,          // { host, id }
  paused: false,
  prevGray: null,
  baseGray: null,
  prevNet: 0,           // 前回サンプル時の「確定画面との差」
  changes: 0,
  noticeUntil: 0,       // この時刻までは見守り表示で上書きしない
  pip: null,
  stepToken: 0,         // ステップが変わるたびに増やす（読み取り中にステップが変わったら結果を捨てる）
  startRead: null,      // このステップ開始時に読んだ画面の文字
  prevStartRead: null,  // 1つ前のステップ開始時に読んだ画面の文字（読み落とし対策で一緒に使う）
  countdown: null,      // 「自動で次へ」の残り時間タイマー { host, id }
  surface: null,        // 共有している面: monitor（画面全体）/ window（ウインドウ）/ browser（タブ）
  lastChangeAt: 0,      // 最後に画面が変わった（または新しい手順を出した）時刻
  stuckToken: -1,       // 「しばらく変化がない」助け舟をどのステップで出したか（1ステップ1回まで）
  detectedApp: "",      // 画面から見分けたソフト（「使うソフト」が自動のとき使う）
  noAskUntil: 0,        // 「まだ」と答えたあと、この時刻までは「できた？」を聞き直さない
  plannedChanged: false, // 計画の手順の間に画面が変わり、まだ「できた？」を聞いていない
  target: null,         // 光らせる場所 { box: {x0,y0,x1,y1}（画面に対する割合）, name, say }
};

// ─── DOM refs（ミニ窓へ移動しても使えるよう起動時に取得） ─
const el = Object.fromEntries([
  "captureChip", "lessonSelect", "ocrBtn", "pipBtn", "themeToggle", "captureStage", "emptyState",
  "captureVideo", "targetBox", "targetTag", "startCaptureBtn", "practiceBtn", "stopCaptureBtn",
  "pauseBtn", "statMotion", "statNet", "statChanges", "tutorHome", "tutorHomeNote", "tutor",
  "tutorLessonName", "tutorStatus", "progressTitle", "progressCount", "progressFill",
  "stepCard", "stepNum", "stepText", "stepHint", "inputBox", "inputText", "copyInputBtn", "expectChip", "checkChip",
  "guide", "guideCanvas", "guideBox", "guideSay", "guideMissing",
  "doneCard", "confirmBox", "confirmText", "yesBtn", "notYetBtn", "watch", "log",
  "ocrMeta", "ocrText", "backBtn", "restartBtn", "nextBtn",
  "autoBtn", "voiceBtn", "countdown", "countdownBar",
  "appSelect", "tplSource", "docApp", "docHelp", "docUrl", "docText", "docMake",
  "planBox", "planList", "planBtn", "tplNote", "tplNoteText", "tplAiBtn", "saveTplBtn", "tplBtn", "tplDialog", "tplList",
  "tplText", "tplResult", "tplExport", "tplImport", "tplClose", "doneTitle", "doneNote", "loopBox", "finishBtn", "continueBtn", "shareTopBtn", "captureFoot", "makeBtn", "aiBtn", "askBtn", "aiBox", "aiText",
  "aiDialog", "builtinRadio", "builtinState", "builtinPrepare", "geminiFields", "geminiKey", "geminiModel",
  "aiTestResult", "aiTest", "aiClose", "aiSave", "goalForm", "goalInline", "settingsBtn", "settingsPop",
  "webBtn", "webDialog", "webMissing", "webReady", "webTabs", "webResult", "webRefresh", "webClose", "webDisconnect",
  "webConnect", "webState", "webStateTitle", "webStateDisconnect",
].map((id) => [id, document.getElementById(id)]));

// ─── 設定（このブラウザに保存） ───────────────────────
//   autoNext: 「できた？」のあと AUTO_NEXT_SEC 秒で自動的に次へ進む（初期値は OFF。確認は必ず出す）
//   voice   : 次の手順や「できましたか？」を読み上げる
//   plan    : おまかせの最初に AI に全体の手順を立てさせ、あとはその計画どおりに AI なしで進める（実験中）
const AUTO_NEXT_SEC = 4;
const prefs = { autoNext: false, voice: true, plan: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("slideSenseiPrefs") || "{}")); } catch { /* 保存できない環境では初期値のまま */ }
function savePrefs() {
  try { localStorage.setItem("slideSenseiPrefs", JSON.stringify(prefs)); } catch { /* 同上 */ }
}
function renderPrefs() {
  el.autoBtn.textContent = `⏩ 自動で次へ ${prefs.autoNext ? "ON" : "OFF"}`;
  el.voiceBtn.textContent = `${prefs.voice ? "🔊" : "🔈"} 音声 ${prefs.voice ? "ON" : "OFF"}`;
  el.planBtn.textContent = `📝 手順を先に考える ${prefs.plan ? "ON" : "OFF"}`;
}
el.autoBtn.addEventListener("click", () => {
  prefs.autoNext = !prefs.autoNext;
  savePrefs();
  renderPrefs();
  if (!el.confirmBox.hidden) startCountdown();
});
el.planBtn.addEventListener("click", () => {
  prefs.plan = !prefs.plan;
  savePrefs();
  renderPrefs();
});
el.voiceBtn.addEventListener("click", () => {
  prefs.voice = !prefs.voice;
  savePrefs();
  renderPrefs();
  if (!prefs.voice && "speechSynthesis" in window) speechSynthesis.cancel();
});
renderPrefs();

// 案内を読み上げる（共有中だけ）。PowerPoint を操作しながら、画面を見に行かなくても次の手順が分かるように
function speak(text) {
  if (!prefs.voice || !watching() || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.rate = 1.05;
  const ja = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith("ja"));
  if (ja) u.voice = ja;
  speechSynthesis.speak(u);
}

// タイマーはミニ窓が開いている間はそちらで動かす（裏のタブはタイマーが間引かれるため）
function timerHost() { return state.pip && !state.pip.closed ? state.pip : window; }

// いま案内中か（画面を共有している、または Web アプリのタブにつないでいる）。web は connector.js で作る
function watching() { return !!state.stream || !!web.tabId; }

const gridCanvas = document.createElement("canvas");
gridCanvas.width = GRID_W; gridCanvas.height = GRID_H;
const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });

// ─── 使うソフト ─────────────────────────────────────
// 選んだソフト、なければ画面から見分けたソフト（分からなければ ""）。テンプレ選びと AI への説明に使う
function currentApp() { return el.appSelect.value || state.detectedApp; }

function renderAppSelect() {
  const auto = state.detectedApp ? `自動（${state.detectedApp} を検出）` : "自動（画面から見分けます）";
  if (!el.appSelect.options.length) {
    el.appSelect.append(new Option(auto, ""), ...Templates.apps.map((a) => new Option(a.id, a.id)));
  }
  el.appSelect.options[0].text = auto;
}

// 画面の文字やウインドウ名から、使っているソフトを見分けて覚える
function noteApp(text, label = "") {
  const app = Templates.detectApp(text, label);
  if (!app || app === state.detectedApp) return;
  state.detectedApp = app;
  renderAppSelect();
  if (!el.appSelect.value) addLog(`使うソフト: ${app}（画面から検出）`);
}
