// そうさ先生 Office 版: 作業ウィンドウの中の案内（🧭 AIにおまかせ の Office 版）
// - やりたいことに合うテンプレがあれば、AI を使わずにその手順で案内する
// - なければ AI が最初に全体の手順を1回だけ立て、あとは文書の状態に現れる言葉で「できた」を確かめて進む（AI を使わない）
// - 計画を立てられなかったとき（または「手順を先に考える」が OFF のとき）は、これまでどおり一手ごとに AI に聞く
// - 押す場所はリボンの道順（ホーム › 罫線 › 格子）で見せて読み上げ、文書の中の場所は選択して見せる
"use strict";

const POLL_MS = 1500;       // 文書の状態を読む間隔
const SETTLE_MS = 1000;     // 状態が変わってから、これだけ落ち着いたら確かめる
const PLAN_ASK_MS = 5000;   // 計画の手順で、文書が変わったのに言葉で確かめられないとき、これだけ待ってから「できた？」と聞く

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "appName", "notice", "goalForm", "goalInput", "tplSelect", "tplNote", "tplNoteText", "tplAiBtn",
  "stepCard", "stepNum", "stepText", "stepHint", "whereText", "pathRow", "targetRow",
  "targetText", "showBtn", "inputBox", "inputText", "copyBtn", "planBox", "planList", "doneCard", "saveTplBtn",
  "aiBox", "aiText", "confirmBox", "confirmText", "yesBtn", "notYetBtn",
  "askBtn", "nextBtn", "restartBtn", "watch", "log", "aiProvider", "geminiKey", "geminiModel", "aiSave", "aiState", "voiceOn",
  "planOn", "tplText", "tplExport", "tplImport", "tplResult", "docHelp", "docUrl", "docText", "docMake", "docResult",
].map((id) => [id, $(id)]));

const office = { host: null };   // office-host.js の ExcelHost / WordHost / PowerPointHost
const run = {
  goal: "", done: [], current: null, path: [], target: "", input: "", where: "", before: null, finished: false,
  busy: false, again: false, lastState: "", settleTimer: 0, pollTimer: 0,
  mode: "ai",          // "plan": 決まった手順（テンプレか AI の計画）で進む / "ai": 一手ごとに AI に聞く
  source: "",          // "template" | "ai"（計画の出どころ）
  steps: [], index: 0, startState: "", askTimer: 0,
};

// ─── 設定（この作業ウィンドウに保存） ─────────────────
const prefs = { plan: true };
try { Object.assign(prefs, JSON.parse(localStorage.getItem("sousaOfficePrefs") || "{}")); } catch { /* 初期値のまま */ }
function savePrefs() {
  try { localStorage.setItem("sousaOfficePrefs", JSON.stringify(prefs)); } catch { /* 保存できない環境 */ }
}

// ─── 表示 ───────────────────────────────────────
function render() {
  ui.appName.textContent = office.host ? `for ${office.host.name}` : "";
  ui.doneCard.hidden = !run.finished;
  ui.saveTplBtn.hidden = !(run.finished && run.mode === "plan" && run.source === "ai");
  ui.stepCard.hidden = run.finished || !run.goal;
  ui.stepNum.textContent = run.mode === "plan" ? `STEP ${run.index + 1} / ${run.steps.length}` : `STEP ${run.done.length + 1}`;
  ui.stepText.textContent = run.current ?? (run.mode === "plan" ? "📝 AI が全体の手順を考えています…" : "🧭 AI が文書を見て、最初の一手を考えています…");
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
  ui.whereText.hidden = !run.where;
  ui.whereText.textContent = run.where ? `場所: ${run.where}` : "";
  ui.targetRow.hidden = !run.target;
  ui.targetText.textContent = run.target;
  ui.inputBox.hidden = !run.current || !run.input;
  ui.inputText.textContent = run.input;
  // 全体の手順（計画で進むときだけ）
  ui.planBox.hidden = run.mode !== "plan" || !run.steps.length;
  ui.planList.replaceChildren(...run.steps.map((s, i) => {
    const li = document.createElement("li");
    li.textContent = s.do;
    if (i < run.index) li.className = "done";
    if (i === run.index && !run.finished) li.className = "now";
    return li;
  }));
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

// Gemini が混んでいてやり直しているときなどは、待っている理由を見せる
AI.setNotice((msg) => {
  setWatch(msg);
  addLog(`⚠ ${msg}`);
});

// ─── 案内の始め方 ─────────────────────────────────
// template: このテンプレで案内する / auto: やりたいことから自動で選んだテンプレ / useAi: テンプレを使わず AI に任せる
function startGoal(goal, { template = null, auto = false, useAi = false } = {}) {
  clearTimeout(run.askTimer);
  Object.assign(run, {
    goal, done: [], current: null, path: [], target: "", input: "", where: "", before: null, finished: false,
    mode: "ai", source: "", steps: [], index: 0, startState: "",
  });
  ui.aiBox.hidden = true;
  ui.confirmBox.hidden = true;
  ui.tplNote.hidden = true;
  const t = template ?? (useAi || !office.host ? null : Templates.match(goal, office.host.name));
  if (t) {
    if (auto || !template) {
      ui.tplNote.hidden = false;
      ui.tplNoteText.textContent = `📘 テンプレ「${t.title}」で案内します（AI を使いません）${t.sample ? "。見本なので、実物と違うことがあります" : ""}`;
    }
    addLog(`📘 テンプレで開始: ${t.title}`);
    startSteps(t.steps, "template");
    return;
  }
  addLog(`🧭 開始: ${goal}`);
  if (!AI.enabled()) {
    render();
    showAi("合うテンプレがありません。AI を使うには、下の「AI の設定」で Gemini の APIキーを入れてください。", true);
    return;
  }
  if (prefs.plan) {
    run.mode = "plan";
    render();
    makePlan();
  } else {
    render();
    ask();
  }
}

// AI に全体の手順を1回だけ立ててもらう。立てられなければ、一手ごとに AI に聞く案内に切り替える
async function makePlan() {
  if (!office.host) return;
  if (run.busy) { run.again = true; return; }
  run.busy = true;
  setWatch("📝 AI が全体の手順を考えています…");
  const goal = run.goal;
  try {
    const now = await office.host.readState();
    const steps = await AI.planOffice({ host: office.host.name, goal, now, targetKind: office.host.targetKind });
    if (run.goal !== goal) return;
    run.busy = false;
    if (!steps.length) throw new Error("手順が空でした");
    addLog(`📝 全体の手順: ${steps.length} 手`);
    startSteps(steps, "ai");
  } catch (e) {
    run.busy = false;
    if (run.goal !== goal) return;
    const wait = AI.retryDelay(e);
    if (wait) {   // 回数制限なら、一手ごとの案内に切り替えず、待ってから計画を立て直す（そのほうが回数を使わない）
      showAi(`${e.message}。${Math.ceil(wait / 1000)}秒後に自動でもう一度考えます。`);
      setTimeout(() => { if (run.goal === goal && run.mode === "plan" && !run.steps.length) makePlan(); }, wait);
      return;
    }
    addLog(`📝 全体の手順を立てられませんでした: ${e.message}`);
    run.mode = "ai";
    render();
    ask();
  } finally {
    run.busy = false;
  }
}

// ─── 決まった手順で進む（テンプレ・AI の計画） ───────────
function startSteps(steps, source) {
  Object.assign(run, { mode: "plan", source, steps: steps.map((s) => ({ path: [], state: [], ...s })), index: 0 });
  enterStep();
}

async function enterStep() {
  clearTimeout(run.askTimer);
  ui.confirmBox.hidden = true;
  if (run.index >= run.steps.length) { finish(); return; }
  const step = run.steps[run.index];
  Object.assign(run, { current: step.do, path: step.path ?? [], target: step.doc ?? "", input: step.input ?? "", where: step.where ?? "" });
  render();
  speak(`ステップ${run.index + 1}。${step.do}`);
  setWatch("見守り中 — 操作してみてください");
  const index = run.index;
  if (step.doc) await showTarget(step.doc);
  // この手順を始めたときの状態。ここになかった言葉が現れたら「できた」
  if (office.host && run.index === index) {
    try { run.startState = run.lastState = await office.host.readState(); } catch { /* 読めなければ空のまま */ }
  }
}

// 文書が変わったとき。いまの手順（か2つ先まで）の言葉が新しく現れていたら、そこまで進む
function checkPlanned(state) {
  const newly = (step) => step.state?.some((w) => state.includes(w) && !run.startState.includes(w));
  for (let j = Math.min(run.index + 2, run.steps.length - 1); j >= run.index; j--) {
    if (!newly(run.steps[j])) continue;
    if (j > run.index) addLog(`→ ステップ ${j + 1} まで進んでいたので追いつきました`);
    stepDone(j, "文書の状態で確認");
    return;
  }
  // 言葉で確かめられないときは、操作が落ち着いてから「できた？」と聞く
  clearTimeout(run.askTimer);
  run.askTimer = setTimeout(() => {
    if (run.mode !== "plan" || run.finished) return;
    ui.confirmText.textContent = "文書が変わりました。この手順はできましたか？";
    ui.confirmBox.hidden = false;
    speak("できましたか？");
  }, PLAN_ASK_MS);
}

function stepDone(j, how = "") {
  for (let i = run.index; i <= j; i++) run.done.push(run.steps[i].do);
  addLog(`✓ ステップ ${j + 1} 完了${how ? `（${how}）` : ""}`);
  run.index = j + 1;
  flash();
  if (run.index < run.steps.length) speak("できました。");
  enterStep();
}

function finish() {
  clearTimeout(run.askTimer);
  Object.assign(run, { finished: true, current: null, path: [], target: "", input: "", where: "" });
  ui.confirmBox.hidden = true;
  ui.aiBox.hidden = true;
  render();
  addLog("🎉 完了");
  speak("できました。やりたいことは完了です。");
}

// ─── 一手ごとに AI に聞く（計画を立てられなかったとき） ──────
async function ask() {
  if (!run.goal || run.finished || !office.host || run.mode !== "ai") return;
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
    const wait = AI.retryDelay(e);
    if (wait) {   // 呼び出し回数の制限なら少し待ってやり直す
      if (e.retryMs) showAi(`${e.message}。${Math.ceil(wait / 1000)}秒後に自動でもう一度確かめます。`);
      setTimeout(ask, wait);
    } else showAi(`AI に聞けませんでした: ${e.message}`, true);
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
    finish();
    return;
  }
  if (!run.current && r.status === "next" && r.say) {
    Object.assign(run, { current: r.say, path: r.path, target: r.docTarget, input: r.inputText ?? "", where: "", before: now });
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

// 「🤖 AIに聞く」を決まった手順の途中で押したとき: いまの手順のやり方だけを聞く（手順の進み方は変えない）
async function askAboutStep() {
  if (!AI.enabled()) { showAi("AI が OFF です。下の「AI の設定」で Gemini の APIキーを入れてください。", true); return; }
  showAi("🤖 AI が文書を見ています…");
  try {
    const now = await office.host.readState();
    const r = await AI.coachOffice({
      host: office.host.name, goal: run.goal, done: run.done, current: run.current, before: run.startState, now,
      targetKind: office.host.targetKind,
    });
    const path = r.path.length ? `（道順: ${r.path.join(" › ")}）` : "";
    showAi(`${r.currentDone === true ? "この手順はできているようです。「できた ✓」を押してください。" : r.say}${path}`);
  } catch (e) {
    showAi(`AI に聞けませんでした: ${e.message}`, true);
  }
}

// 文書の中の場所を選択して見せる。自分で選択を変えたことを「利用者の操作」と数えないよう、見せたあとの状態を基準にする
async function showTarget(target) {
  try {
    const ok = await office.host.show(target);
    if (!ok) { addLog(`⚠「${target}」を文書の中で見つけられませんでした`); return; }
    run.lastState = await office.host.readState();
    run.before = run.lastState;
    if (run.mode === "plan") run.startState = run.lastState;
    clearTimeout(run.settleTimer);
  } catch (e) {
    addLog(`⚠ 場所を見せられませんでした: ${e.message}`);
  }
}

// 「できた ✓」「次へ」: 判定を待たずに次の手順へ
function manualDone() {
  if (run.mode === "plan") {
    if (run.finished || run.index >= run.steps.length) return;
    stepDone(run.index, "手動");
    return;
  }
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
  if (run.mode === "plan") {
    if (run.steps.length) checkPlanned(run.lastState);
    return;
  }
  ask();
}

// ─── テンプレ ───────────────────────────────────────
function fillTplSelect() {
  const list = office.host ? Templates.all(office.host.name) : [];
  ui.tplSelect.replaceChildren(new Option("📘 テンプレから選ぶ（AI を使いません）", ""),
    ...list.map((t) => new Option(`${t.title}${t.sample ? "（見本）" : ""}`, t.id)));
  ui.tplSelect.hidden = !list.length;
}
ui.tplSelect.addEventListener("change", () => {
  const t = Templates.get(ui.tplSelect.value);
  ui.tplSelect.value = "";
  if (!t) return;
  ui.goalInput.value = t.title;
  startGoal(t.title, { template: t });
});
ui.tplAiBtn.addEventListener("click", () => {
  if (!AI.enabled()) { showAi("AI を使うには、下の「AI の設定」で Gemini の APIキーを入れてください。", true); return; }
  startGoal(run.goal, { useAi: true });
});
// AI の計画でうまくいった手順を、テンプレとして保存する（次からは AI を使わない）
ui.saveTplBtn.addEventListener("click", () => {
  const t = Templates.save(Templates.fromOfficePlan(run.goal, office.host?.name ?? "", run.steps));
  if (!t) return;
  fillTplSelect();
  ui.saveTplBtn.hidden = true;
  addLog(`📘 テンプレに保存しました: ${t.title}`);
  showAi(`📘 テンプレ「${t.title}」に保存しました。次から同じことを書くと、AI を使わずに案内します。`);
});
ui.tplExport.addEventListener("click", async () => {
  ui.tplText.value = Templates.exportJson();
  try {
    await navigator.clipboard.writeText(ui.tplText.value);
    ui.tplResult.textContent = "✓ コピーしました";
  } catch {
    ui.tplText.select();
    ui.tplResult.textContent = "欄の文字を選びました。⌘C / Ctrl+C でコピーしてください";
  }
});
ui.tplImport.addEventListener("click", () => {
  try {
    ui.tplResult.textContent = `✓ ${Templates.importJson(ui.tplText.value)} 個のテンプレを読み込みました`;
    fillTplSelect();
  } catch (e) {
    ui.tplResult.textContent = `✗ ${e.message}`;
  }
});

// 公式ヘルプの文章から、このアプリのテンプレを作る（AI を1回使う）
ui.docMake.addEventListener("click", async () => {
  const text = ui.docText.value.trim();
  const app = office.host?.name ?? "";
  if (text.length < 40) { ui.docResult.textContent = "公式ヘルプのページの文章を貼り付けてください"; return; }
  if (!AI.enabled()) { ui.docResult.textContent = "テンプレを作るには、下の「AI の設定」で Gemini の APIキーを入れてください"; return; }
  ui.docMake.disabled = true;
  ui.docResult.textContent = "🤖 AI が公式ヘルプを読んで、テンプレを作っています…";
  try {
    const url = ui.docUrl.value.trim();
    const r = await AI.templateFromDoc({ text, url, app, hint: Templates.appInfo(app)?.hint ?? "" });
    const t = r.steps.length ? Templates.save(Templates.fromDoc(r, { url, app })) : null;
    if (!t) { ui.docResult.textContent = "✗ この文章からは手順を読み取れませんでした"; return; }
    ui.docText.value = "";
    ui.docResult.textContent = `✓ テンプレ「${t.title}」（${t.steps.length} 手）を作りました`;
    fillTplSelect();
  } catch (e) {
    ui.docResult.textContent = `✗ 作れませんでした: ${e.message}`;
  } finally {
    ui.docMake.disabled = false;
  }
});

// ─── ボタン ─────────────────────────────────────────
ui.goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = ui.goalInput.value.trim();
  if (goal) startGoal(goal, { auto: true });
});
ui.yesBtn.addEventListener("click", manualDone);
ui.nextBtn.addEventListener("click", manualDone);
ui.notYetBtn.addEventListener("click", () => { ui.confirmBox.hidden = true; clearTimeout(run.askTimer); });
ui.askBtn.addEventListener("click", () => {
  if (run.mode === "plan" && run.steps.length && !run.finished) askAboutStep();
  else ask();
});
ui.restartBtn.addEventListener("click", () => { if (run.goal) startGoal(run.goal, { useAi: run.source === "ai" }); });
ui.showBtn.addEventListener("click", () => run.target && showTarget(run.target));

// ─── AI の設定（Office の中では Chrome 内蔵AI が使えないので Gemini のみ） ─────
function renderAi() {
  ui.aiProvider.checked = AI.settings.provider === "gemini";
  ui.geminiKey.value = AI.settings.geminiKey;
  AI.fillModelSelect(ui.geminiModel, AI.settings.geminiModel);
  ui.planOn.checked = prefs.plan;
  ui.aiState.textContent = AI.enabled() ? "AI: Gemini" : "AI: OFF";
}
ui.aiSave.addEventListener("click", () => {
  AI.save({
    provider: ui.aiProvider.checked ? "gemini" : "off",
    geminiKey: ui.geminiKey.value.trim(),
    geminiModel: AI.normalizeModel(ui.geminiModel.value),
  });
  prefs.plan = ui.planOn.checked;
  savePrefs();
  renderAi();
  addLog(`AI: ${AI.enabled() ? "Gemini" : "OFF"}`);
});

// ─── 起動 ─────────────────────────────────────────
// startWith(host): Office の準備ができたら、そのアプリの読む係で見守りを始める（テストでは偽物の係を渡す）
function startWith(host) {
  office.host = host;
  ui.notice.hidden = !!host;
  ui.docHelp.href = Templates.appInfo(host?.name)?.help ?? "#";
  fillTplSelect();
  render();
  if (host) {
    setWatch("🧭 欄にやりたいことを書いて「開始」を押すか、テンプレから選んでください");
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

// 「📋 コピー」: 入力する中身（数式・文章など）をコピーする
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
