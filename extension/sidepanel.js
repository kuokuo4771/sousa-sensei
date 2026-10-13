// スライド先生 Web 連携: サイドパネルの案内（Google Colab などのページの横に出す）
// - いま見ているタブ（Colab など）に読み取り係（web-agent.js）を入れ、ボタンやメニューの名前と位置を読む
// - やりたいことを書くと、AI がページを見て次の一手を1つ出し、ページの上に直接光らせる
// - 操作してページが落ち着いたら、AI が前後を比べて「できたか」を確かめ、次の一手へ
// 本体（index.html）とは独立して動く。AI 連携と番号札は本体と同じもの（shared/）を使う
"use strict";

const STUCK_MS = 25000;   // 手順を出してからこれだけ変化がなければ助け舟を出す

// ─── Chrome の API（テストでは差し替える） ─────────────────
const tabApi = {
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  },
  async inject(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["web-agent.js"] });
  },
  send(tabId, msg) {
    return chrome.tabs.sendMessage(tabId, msg);
  },
  shot(windowId) {
    return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
  },
};

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "pageName", "notice", "goalForm", "goalInput", "stepCard", "stepNum", "stepText", "doneCard", "aiBox", "aiText",
  "confirmBox", "confirmText", "yesBtn", "notYetBtn", "askBtn", "restartBtn", "nextBtn", "watch", "log", "aiState",
  "providerOff", "providerBuiltin", "providerGemini", "builtinState", "builtinPrepare", "geminiKey", "geminiModel",
  "aiSave", "aiTest", "aiResult", "voiceOn",
].map((id) => [id, $(id)]));

const run = {
  tab: null,                // 案内しているタブ { id, windowId, title, url }
  goal: "", done: [], current: null, before: null, finished: false,
  busy: false, again: false, retry: 0, lastChangeAt: 0, stuckShown: false,
};

// ─── 表示 ───────────────────────────────────────
function render() {
  ui.pageName.textContent = run.tab ? run.tab.title : "";
  ui.doneCard.hidden = !run.finished;
  ui.stepCard.hidden = run.finished || !run.goal;
  ui.stepNum.textContent = `STEP ${run.done.length + 1}`;
  ui.stepText.textContent = run.current ?? "🧭 AI がページを見て、最初の一手を考えています…";
  ui.aiState.textContent = `AI: ${AI.label()}`;
}
function setWatch(text) { ui.watch.textContent = text; }
function showAi(text, error = false) {
  ui.aiBox.hidden = false;
  ui.aiBox.classList.toggle("error", error);
  ui.aiText.textContent = text;
}
function showConfirm(text) {
  ui.confirmText.textContent = text;
  ui.confirmBox.hidden = false;
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

// ─── タブにつなぐ ───────────────────────────────────
// いま見ているタブに読み取り係を入れる。chrome:// など、拡張機能が入れないページでは案内できない
async function attach() {
  const tab = await tabApi.activeTab();
  if (run.tab && tab && run.tab.id !== tab.id) tabApi.send(run.tab.id, { type: "clear" }).catch(() => {});
  if (!tab || !/^(https?|file):/.test(tab.url ?? "")) {
    run.tab = null;
    ui.notice.hidden = false;
    ui.notice.textContent = "このページでは案内できません。Google Colab などの Web ページのタブを開いてください。";
    render();
    return false;
  }
  try {
    await tabApi.inject(tab.id);
  } catch (e) {
    run.tab = null;
    ui.notice.hidden = false;
    ui.notice.textContent = `このページに入れませんでした（${e.message}）。ページを再読み込みしてから、もう一度開いてください。`;
    render();
    return false;
  }
  run.tab = { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url };
  ui.notice.hidden = true;
  render();
  return true;
}

// ページの部品（番号札）と、見えている部分のスクリーンショット
async function observe() {
  let info;
  try {
    info = await tabApi.send(run.tab.id, { type: "items" });
  } catch {
    // ページを移動・再読み込みすると読み取り係がいなくなるので、入れ直してもう一度
    await tabApi.inject(run.tab.id);
    info = await tabApi.send(run.tab.id, { type: "items" });
  }
  const shot = await loadCanvas(await tabApi.shot(run.tab.windowId));
  run.tab.title = info.title;
  run.tab.url = info.url;
  const app = `Web ページ「${info.title}」（${info.url}）${info.focused ? `。入力中の場所: ${info.focused}` : ""}`;
  return { items: info.items, shot, app };
}

function loadCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("スクリーンショットを読めませんでした"));
    img.src = dataUrl;
  });
}

function highlight(r, items) {
  if (!run.tab) return;
  const it = resolveTarget(r, items);
  if (it) tabApi.send(run.tab.id, { type: "highlight", id: it.id, label: it.text }).catch(() => {});
  else if (r.box) tabApi.send(run.tab.id, { type: "highlight", box: r.box, label: "ここ（AI の推定）" }).catch(() => {});
}
function clearHighlight() {
  if (run.tab) tabApi.send(run.tab.id, { type: "clear" }).catch(() => {});
}

// ─── 案内の流れ ─────────────────────────────────────
async function startGoal(goal) {
  if (!AI.enabled()) {
    showAi("AI が OFF です。下の「AI の設定」で AI を選んでください。", true);
    return;
  }
  if (!(await attach())) return;
  Object.assign(run, { goal, done: [], current: null, before: null, finished: false, stuckShown: false });
  ui.aiBox.hidden = true;
  ui.confirmBox.hidden = true;
  addLog(`🧭 開始: ${goal}`);
  render();
  ask();
}

async function ask() {
  if (!run.goal || run.finished || !run.tab) return;
  if (run.busy) { run.again = true; return; }
  run.busy = true;
  setWatch("🧭 AI がページを見て考えています…");
  try {
    const { items, shot, app } = await observe();
    const images = tagImage({ source: shot, width: shot.width, height: shot.height }, items);
    const before = run.current ? run.before : null;
    const { appeared, disappeared } = textChanges(before?.texts, items);
    const r = await AI.coach({
      image: images.tagged, before: before?.image ?? null, appeared, disappeared, app, items,
      goal: run.goal, done: run.done, current: run.current,
    });
    apply(r, items, { image: images.plain, texts: new Set(items.map((it) => norm(it.text))) });
  } catch (e) {
    if (/間をあけて|上限/.test(e.message)) {
      // 呼び出し回数の制限に当たったら、少し待ってやり直す（やり直しの予約は1つだけ）
      if (!run.retry) run.retry = setTimeout(() => { run.retry = 0; ask(); }, 4500);
    } else {
      showAi(`AI に聞けませんでした: ${e.message}`, true);
    }
  } finally {
    run.busy = false;
    setWatch(run.finished ? "完了しました" : "見守り中 — ページで操作してみてください");
    if (run.again) { run.again = false; ask(); }
  }
}

function apply(r, items, snapshot) {
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
    ui.confirmBox.hidden = true;
    ui.aiBox.hidden = true;
    clearHighlight();
    render();
    addLog("🎉 完了");
    speak("できました。やりたいことは完了です。");
    return;
  }
  if (!run.current && r.status === "next" && r.say) {
    Object.assign(run, { current: r.say, before: snapshot, lastChangeAt: Date.now(), stuckShown: false });
    ui.confirmBox.hidden = true;
    ui.aiBox.hidden = true;
    render();
    clearHighlight();
    highlight(r, items);
    speak(`${cheer ? "できました。" : ""}${r.say}`);
    return;
  }
  if (run.current && r.currentDone === false && r.status !== "unsure") {
    showAi(`まだのようです。${r.say}`);
    highlight(r, items);
    showConfirm("AI は「まだ」と判断しました。できていれば「できた ✓」を押してください。");
    return;
  }
  if (run.current) {
    showConfirm("AI では判断できませんでした。この手順はできましたか？");
    speak("できましたか？");
  } else {
    showAi(r.say || "AI が次の一手を決められませんでした。「🤖 AIに聞く」でもう一度試してください。", true);
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

// ページで操作があり、落ち着いたら読み取り係から知らせが来る
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.from !== "web" || msg.event !== "changed" || sender.tab?.id !== run.tab?.id) return;
  run.lastChangeAt = Date.now();
  if (run.goal && !run.finished) {
    addLog("ページが変わりました");
    ask();
  }
});

// 別のタブに切り替えたら、そのタブを案内する
chrome.tabs.onActivated.addListener(() => { attach(); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === run.tab?.id && info.status === "complete") attach();
});

// しばらく変化がないときの助け舟（1手順に1回）
setInterval(() => {
  if (!run.current || run.busy || run.stuckShown || !ui.confirmBox.hidden) return;
  if (Date.now() - run.lastChangeAt < STUCK_MS) return;
  run.stuckShown = true;
  showAi("しばらくページに変化がありません。迷ったら「🤖 AIに聞く」を押してください。");
  showConfirm("この手順はもうできていますか？");
}, 2000);

// ─── ボタン ─────────────────────────────────────────
ui.goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = ui.goalInput.value.trim();
  if (goal) startGoal(goal);
});
ui.yesBtn.addEventListener("click", manualDone);
ui.nextBtn.addEventListener("click", manualDone);
ui.notYetBtn.addEventListener("click", () => { ui.confirmBox.hidden = true; });
ui.askBtn.addEventListener("click", async () => {
  if (!run.goal) { ui.goalInput.focus(); return; }
  if (await attach()) ask();
});
ui.restartBtn.addEventListener("click", () => { if (run.goal) startGoal(run.goal); });

// ─── AI の設定 ───────────────────────────────────────
async function renderAi() {
  const s = AI.settings;
  ui.providerOff.checked = s.provider === "off";
  ui.providerBuiltin.checked = s.provider === "builtin";
  ui.providerGemini.checked = s.provider === "gemini";
  ui.geminiKey.value = s.geminiKey;
  ui.geminiModel.value = s.geminiModel;
  const status = await AI.builtinStatus();
  ui.builtinState.textContent = {
    available: "使えます（ページの画像は端末の外に出ません）",
    downloadable: "使えます。初回だけ「準備する」でモデル（約3〜4GB）を取り込みます",
    downloading: "モデルを取り込み中です…",
    unavailable: "この端末・Chrome では使えません（Chrome 148 以降、空き容量 20GB 以上などの条件があります）",
  }[status] ?? status;
  ui.providerBuiltin.disabled = status === "unavailable";
  ui.builtinPrepare.hidden = status !== "downloadable" && status !== "downloading";
  render();
}
function readAiForm() {
  return {
    provider: ui.providerBuiltin.checked ? "builtin" : ui.providerGemini.checked ? "gemini" : "off",
    geminiKey: ui.geminiKey.value.trim(),
    geminiModel: AI.normalizeModel(ui.geminiModel.value),
  };
}
ui.aiSave.addEventListener("click", () => {
  const next = readAiForm();
  if (next.provider === "gemini" && !next.geminiKey) { ui.aiResult.textContent = "Gemini を使うには APIキーを入れてください"; return; }
  AI.save(next);
  ui.aiResult.textContent = "保存しました";
  renderAi();
});
ui.aiTest.addEventListener("click", async () => {
  const before = { ...AI.settings };
  AI.save(readAiForm());
  ui.aiResult.textContent = "テスト中…";
  try {
    await AI.ping();
    ui.aiResult.textContent = "✓ つながりました";
  } catch (e) {
    ui.aiResult.textContent = `✗ ${e.message}`;
  } finally {
    AI.save(before);   // 保存は「保存」を押したときだけ
  }
});
// 内蔵AI のモデルの取り込みは、ボタンを押した直後にしか始められない（ブラウザの制限）
ui.builtinPrepare.addEventListener("click", async () => {
  ui.builtinPrepare.disabled = true;
  try {
    await AI.prepareBuiltin((p) => { ui.builtinState.textContent = `モデルを取り込み中… ${Math.round(p * 100)}%`; });
    ui.builtinState.textContent = "準備できました";
    ui.builtinPrepare.hidden = true;
  } catch (e) {
    ui.builtinState.textContent = `準備できませんでした: ${e.message}`;
  } finally {
    ui.builtinPrepare.disabled = false;
  }
});

// ─── 起動 ─────────────────────────────────────────
renderAi();
attach().then(() => setWatch(run.tab ? "やりたいことを書いて「開始」を押してください" : ""));
