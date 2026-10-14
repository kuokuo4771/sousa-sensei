// スライド先生 Office 版: 作業ウィンドウの中の案内（🧭 AIにおまかせ の Office 版）
// - やりたいことを書くと、AI が文書の状態を見て次の一手を1つ出す
// - 押す場所はリボンの道順（ホーム › 罫線 › 格子）で見せて読み上げ、文書の中の場所は選択して見せる
// - 文書の状態が変わったら、AI が「できたか」を確かめて次へ。判断できないときは「できた？」で人に聞く
"use strict";

const POLL_MS = 1500;       // 文書の状態を読む間隔
const SETTLE_MS = 1000;     // 状態が変わってから、これだけ落ち着いたら AI に聞く

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "appName", "notice", "goalForm", "goalInput", "stepCard", "stepNum", "stepText", "stepHint", "pathRow", "targetRow",
  "targetText", "showBtn", "inputBox", "inputText", "copyBtn", "doneCard", "aiBox", "aiText", "confirmBox", "confirmText", "yesBtn", "notYetBtn",
  "askBtn", "nextBtn", "restartBtn", "watch", "log", "aiProvider", "geminiKey", "geminiModel", "aiSave", "aiState", "voiceOn",
].map((id) => [id, $(id)]));

const office = { host: null };   // office-host.js の ExcelHost / WordHost / PowerPointHost
const run = {
  goal: "", done: [], current: null, path: [], target: "", input: "", before: null, finished: false,
  busy: false, again: false, lastState: "", settleTimer: 0, pollTimer: 0,
};

// ─── 表示 ───────────────────────────────────────
function render() {
  ui.appName.textContent = office.host ? `for ${office.host.name}` : "";
  ui.doneCard.hidden = !run.finished;
  ui.stepCard.hidden = run.finished || !run.goal;
  ui.stepNum.textContent = `STEP ${run.done.length + 1}`;
  ui.stepText.textContent = run.current ?? "🧭 AI が文書を見て、最初の一手を考えています…";
  ui.pathRow.hidden = ui.stepHint.hidden = !run.path.length;
  ui.pathRow.replaceChildren(...run.path.flatMap((p, i) => {
    const chip = document.createElement("span");
    chip.className = "path-chip";
    chip.textContent = p;
    if (i === 0) return [chip];
    const sep = document.createElement("span");
    sep.className = "path-sep";
    sep.textContent = "›";
    return [sep, chip];
  }));
  ui.targetRow.hidden = !run.target;
  ui.targetText.textContent = run.target;
  ui.inputBox.hidden = !run.current || !run.input;
  ui.inputText.textContent = run.input;
}

function setWatch(text) { ui.watch.textContent = text; }
function showAi(text, error = false) {
  ui.aiBox.hidden = false;
  ui.aiBox.classList.toggle("error", error);
  ui.aiText.textContent = text;
}
function addLog(text) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString().slice(0, -3)} ${text}`;
  ui.log.prepend(li);
  while (ui.log.children.length > 6) ui.log.lastChild.remove();
}
function speak(text) {
  if (!ui.voiceOn.checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  speechSynthesis.speak(u);
}
function flash() {
  ui.stepCard.classList.remove("flash");
  void ui.stepCard.offsetWidth;   // アニメーションをやり直すため
  ui.stepCard.classList.add("flash");
}

// ─── 案内の流れ ─────────────────────────────────────
function startGoal(goal) {
  Object.assign(run, { goal, done: [], current: null, path: [], target: "", input: "", before: null, finished: false });
  ui.aiBox.hidden = true;
  ui.confirmBox.hidden = true;
  addLog(`🧭 開始: ${goal}`);
  render();
  ask();
}

async function ask() {
  if (!run.goal || run.finished || !office.host) return;
  if (!AI.enabled()) { showAi("AI が OFF です。下の「AI の設定」で Gemini の APIキーを入れてください。", true); return; }
  if (run.busy) { run.again = true; return; }
  run.busy = true;
  setWatch("🧭 AI が文書を見て考えています…");
  try {
    const now = await office.host.readState();
    const r = await AI.coachOffice({
      host: office.host.name, goal: run.goal, done: run.done, current: run.current,
      before: run.current ? run.before : null, now, targetKind: office.host.targetKind,
    });
    await apply(r, now);
  } catch (e) {
    if (/間をあけて|上限/.test(e.message)) setTimeout(ask, 4500);   // 呼び出し回数の制限なら少し待ってやり直す
    else showAi(`AI に聞けませんでした: ${e.message}`, true);
  } finally {
    run.busy = false;
    setWatch(run.finished ? "完了しました" : "見守り中 — 操作してみてください");
    if (run.again) { run.again = false; ask(); }
  }
}

async function apply(r, now) {
  let cheer = false;
  if (run.current && r.currentDone === true) {
    run.done.push(run.current);
    addLog(`✓ ${run.current}`);
    run.current = null;
    cheer = true;
    flash();
  }
  if (!run.current && r.status === "done") {
    run.finished = true;
    run.path = [];
    run.target = "";
    ui.confirmBox.hidden = true;
    ui.aiBox.hidden = true;
    render();
    addLog("🎉 完了");
    speak("できました。やりたいことは完了です。");
    return;
  }
  if (!run.current && r.status === "next" && r.say) {
    Object.assign(run, { current: r.say, path: r.path, target: r.docTarget, input: r.inputText ?? "", before: now });
    ui.confirmBox.hidden = true;
    ui.aiBox.hidden = true;
    render();
    speak(`${cheer ? "できました。" : ""}${r.say}`);
    if (r.docTarget) await showTarget(r.docTarget);
    return;
  }
  if (run.current && r.currentDone === false && r.status !== "unsure") {
    showAi(`まだのようです。${r.say}`);
    if (r.inputText) { run.input = r.inputText; render(); }
    ui.confirmText.textContent = "AI は「まだ」と判断しました。できていれば「できた ✓」を押してください。";
    ui.confirmBox.hidden = false;
    return;
  }
  if (run.current) {
    ui.confirmText.textContent = "AI では判断できませんでした。この手順はできましたか？";
    ui.confirmBox.hidden = false;
    speak("できましたか？");
  } else {
    showAi(r.say || "AI が次の一手を決められませんでした。「🤖 AIに聞く」でもう一度試してください。", true);
  }
}

// 文書の中の場所を選択して見せる。自分で選択を変えたことを「利用者の操作」と数えないよう、見せたあとの状態を基準にする
async function showTarget(target) {
  try {
    const ok = await office.host.show(target);
    if (!ok) { addLog(`⚠「${target}」を文書の中で見つけられませんでした`); return; }
    run.lastState = await office.host.readState();
    run.before = run.lastState;
    clearTimeout(run.settleTimer);
  } catch (e) {
    addLog(`⚠ 場所を見せられませんでした: ${e.message}`);
  }
}

// 「できた ✓」「次へ」: AI の判定を待たずに次の一手へ
function manualDone() {
  if (run.current) {
    run.done.push(run.current);
    addLog(`✓ ${run.current}（手動）`);
    run.current = null;
    flash();
  }
  ui.confirmBox.hidden = true;
  ask();
}

// ─── 文書の変化を見守る ────────────────────────────────
async function poll() {
  try {
    if (office.host && !run.busy) {
      const state = await office.host.readState();
      if (run.lastState && state !== run.lastState) {
        clearTimeout(run.settleTimer);
        run.settleTimer = setTimeout(onChanged, SETTLE_MS);
      }
      run.lastState = state;
    }
  } catch (e) {
    console.warn("文書の状態を読めませんでした:", e.message);
  } finally {
    run.pollTimer = setTimeout(poll, POLL_MS);
  }
}

function onChanged() {
  if (!run.goal || run.finished) return;
  addLog("文書が変わりました");
  ask();
}

// ─── ボタン ─────────────────────────────────────────
ui.goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = ui.goalInput.value.trim();
  if (goal) startGoal(goal);
});
ui.yesBtn.addEventListener("click", manualDone);
ui.nextBtn.addEventListener("click", manualDone);
ui.notYetBtn.addEventListener("click", () => { ui.confirmBox.hidden = true; });
ui.askBtn.addEventListener("click", () => ask());
ui.restartBtn.addEventListener("click", () => { if (run.goal) startGoal(run.goal); });
ui.showBtn.addEventListener("click", () => run.target && showTarget(run.target));

// ─── AI の設定（Office の中では Chrome 内蔵AI が使えないので Gemini のみ） ─────
function renderAi() {
  ui.aiProvider.checked = AI.settings.provider === "gemini";
  ui.geminiKey.value = AI.settings.geminiKey;
  ui.geminiModel.value = AI.settings.geminiModel;
  ui.aiState.textContent = AI.enabled() ? "AI: Gemini" : "AI: OFF";
}
ui.aiSave.addEventListener("click", () => {
  AI.save({
    provider: ui.aiProvider.checked ? "gemini" : "off",
    geminiKey: ui.geminiKey.value.trim(),
    geminiModel: AI.normalizeModel(ui.geminiModel.value),
  });
  renderAi();
  addLog(`AI: ${AI.enabled() ? "Gemini" : "OFF"}`);
});

// ─── 起動 ─────────────────────────────────────────
// startWith(host): Office の準備ができたら、そのアプリの読む係で見守りを始める（テストでは偽物の係を渡す）
function startWith(host) {
  office.host = host;
  ui.notice.hidden = !!host;
  render();
  if (host) {
    setWatch("🧭 欄にやりたいことを書いて「開始」を押してください");
    poll();
  }
}

renderAi();
render();
if (new URLSearchParams(location.search).has("test")) {
  const s = document.createElement("script");
  s.src = "office-selftest.js";
  document.body.append(s);
} else if (window.Office) {
  Office.onReady((info) => startWith(hostFor(info.host)));
} else {
  ui.notice.hidden = false;
}

// 「📋 コピー」: AI が書いた入力する中身（数式・文章など）をコピーする
ui.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(run.input);
    ui.copyBtn.textContent = "✓ コピーしました";
  } catch {
    getSelection().selectAllChildren(ui.inputText);
    ui.copyBtn.textContent = "選びました。⌘C / Ctrl+C でコピー";
  }
  setTimeout(() => { ui.copyBtn.textContent = "📋 コピー"; }, 2000);
});
