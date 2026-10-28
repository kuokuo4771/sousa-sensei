// そうさ先生 Web 連携: サイドパネルの案内（Google Colab などのページの横に出す）
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
  "pageName", "notice", "goalForm", "goalInput", "stepCard", "stepNum", "stepText", "inputBox", "inputText", "copyBtn", "doneCard", "aiBox", "aiText",
  "confirmBox", "confirmText", "yesBtn", "notYetBtn", "loopBox", "finishBtn", "continueBtn", "askBtn", "restartBtn", "nextBtn", "watch", "log", "aiState",
  "providerOff", "providerBuiltin", "providerGemini", "builtinState", "builtinPrepare", "geminiKey", "geminiModel",
  "aiSave", "aiTest", "aiResult", "voiceOn", "learnOn",
  "teachBox", "teachText", "thinkBox", "hintText", "revealBtn", "answerBox", "explainBtn", "explainList",
  "doneSummary", "learnedBox", "learnedList", "questionForm", "questionInput",
].map((id) => [id, $(id)]));

const run = {
  tab: null,                // 案内しているタブ { id, windowId, title, url }
  goal: "", done: [], current: null, before: null, finished: false,
  input: "",                // いまの手順で入力する中身（コードなど。AI が書いたもの）
  teach: "",                // いまの手順で学べること（💡 ポイント）
  hint: "",                 // 答えを見る前のヒント
  revealed: false,          // 学習モードで「答えを見る」を押したか
  learned: [],              // これまでのポイント（完了したときに「学んだこと」として見せる）
  summary: "",              // 完了したときの AI のまとめ
  busy: false, again: false, retry: 0, lastChangeAt: 0, stuckShown: false,
  loopAsked: new Set(),     // 「くり返されています」をもう聞いた手順
  lastHighlight: null,      // 最後に光らせた場所 { tabId, msg }（タブを行き来したときに光らせ直す）
};

// ─── 表示 ───────────────────────────────────────
function render() {
  ui.pageName.textContent = run.tab ? run.tab.title : "";
  ui.doneCard.hidden = !run.finished;
  ui.stepCard.hidden = run.finished || !run.goal;
  ui.stepNum.textContent = `STEP ${run.done.length + 1}`;
  ui.stepText.textContent = run.current ?? "🧭 AI がページを見て、最初の一手を考えています…";
  ui.teachBox.hidden = !run.current || !run.teach;
  ui.teachText.textContent = run.teach;
  // 学習モードでは、コードの答えの前にヒントを出して、自分で考える時間をとる
  ui.inputBox.hidden = run.finished || !run.current || !run.input;
  const thinking = ui.learnOn.checked && !run.revealed;
  ui.thinkBox.hidden = !thinking;
  ui.answerBox.hidden = ui.copyBtn.hidden = thinking;
  ui.hintText.textContent = run.hint ? `ヒント: ${run.hint}` : "";
  ui.inputText.textContent = run.input;
  ui.doneSummary.textContent = run.summary || "やりたいことは完了です。";
  ui.learnedBox.hidden = !run.learned.length;
  ui.learnedList.replaceChildren(...run.learned.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
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
  const back = run.tab?.id !== tab.id;
  run.tab = { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url };
  ui.notice.hidden = true;
  // 別のタブから戻ってきたら、案内中の場所をもう一度光らせる（離れるときに消しているため）
  if (back && run.current && run.lastHighlight?.tabId === tab.id) tabApi.send(tab.id, run.lastHighlight.msg).catch(() => {});
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
  return { items: info.items, gen: info.gen, shot, app };
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

// gen: その番号札を集めた回（読み取り係は、回ごとに番号→部品を覚えている）
function highlight(r, items, gen) {
  if (!run.tab) return;
  const it = resolveTarget(r, items);
  const msg = it ? { type: "highlight", gen, id: it.id, label: it.text }
    : r.box ? { type: "highlight", box: r.box, label: "ここ（AI の推定）" } : null;
  if (!msg) return;
  run.lastHighlight = { tabId: run.tab.id, msg };
  tabApi.send(run.tab.id, msg).catch(() => {});
}
function clearHighlight() {
  run.lastHighlight = null;
  if (run.tab) tabApi.send(run.tab.id, { type: "clear" }).catch(() => {});
}

// ─── 案内の流れ ─────────────────────────────────────
async function startGoal(goal) {
  if (!AI.enabled()) {
    showAi("AI が OFF です。下の「設定」で AI を選んでください。", true);
    return;
  }
  if (!(await attach())) return;
  Object.assign(run, {
    goal, done: [], current: null, before: null, finished: false, input: "", teach: "", hint: "", revealed: false,
    learned: [], summary: "", stuckShown: false, loopAsked: new Set(),
  });
  ui.aiBox.hidden = ui.loopBox.hidden = true;
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
    const { items, gen, shot, app } = await observe();
    const images = tagImage({ source: shot, width: shot.width, height: shot.height }, items);
    const before = run.current ? run.before : null;
    const { appeared, disappeared } = textChanges(before?.texts, items);
    const r = await AI.coach({
      image: images.tagged, before: before?.image ?? null, appeared, disappeared, app, items,
      goal: run.goal, done: run.done, current: run.current,
    });
    apply(r, items, gen, { image: images.plain, texts: new Set(items.map((it) => norm(it.text))) });
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

function apply(r, items, gen, snapshot) {
  let cheer = false;
  if (run.current && r.currentDone === true) {
    completeStep();
    cheer = true;
  }
  if (!run.current && r.status === "done") {
    finish(r.teach || r.say);
    return;
  }
  if (!run.current && r.status === "next" && r.say) {
    Object.assign(run, {
      current: r.say, input: r.inputText ?? "", teach: r.teach ?? "", hint: r.hint ?? "", revealed: false,
      before: snapshot, lastChangeAt: Date.now(), stuckShown: false,
    });
    ui.explainList.hidden = true;
    ui.confirmBox.hidden = true;
    ui.aiBox.hidden = ui.loopBox.hidden = true;
    // 終わった手順と同じ手順がまた出たら、AI が堂々めぐりしているかもしれないので、もう達成できたか聞く（1手順に1回）
    const key = stepKey(r.say);
    if (run.done.some((d) => stepKey(d) === key) && !run.loopAsked.has(key)) {
      run.loopAsked.add(key);
      ui.loopBox.hidden = false;
    }
    render();
    clearHighlight();
    highlight(r, items, gen);
    speak(`${cheer ? "できました。" : ""}${r.say}`);
    return;
  }
  if (run.current && r.currentDone === false && r.status !== "unsure") {
    showAi(`まだのようです。${r.say}`);
    if (r.inputText) { run.input = r.inputText; render(); }
    highlight(r, items, gen);
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

// いまの手順を終わりにする。その手順のポイントは「学んだこと」に残す
function completeStep(manual = false) {
  run.done.push(run.current);
  if (run.teach && !run.learned.includes(run.teach)) run.learned.push(run.teach);
  addLog(`✓ ${run.current}${manual ? "（手動）" : ""}`);
  Object.assign(run, { current: null, input: "", teach: "", hint: "" });
  flash();
}

function finish(summary = "") {
  run.finished = true;
  run.summary = summary;
  ui.confirmBox.hidden = ui.aiBox.hidden = ui.loopBox.hidden = true;
  clearHighlight();
  render();
  addLog("🎉 完了");
  speak("できました。やりたいことは完了です。");
}

// 手順を比べるための目印。「」の中の名前（ボタン名など）があればそれで、なければ記号と空白を除いた文で比べる
function stepKey(say) {
  const names = [...say.matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => m[1].trim()).sort();
  return names.length ? names.join("|") : say.replace(/[\s、。・「」『』（）()]/g, "");
}

// 「できた ✓」「次へ」: AI の判定を待たずに次の一手へ
function manualDone() {
  ui.loopBox.hidden = true;
  if (run.current) completeStep(true);
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
ui.finishBtn.addEventListener("click", () => finish());
// 入力する中身をコピーする（Colab のセルなどに貼り付けてもらう）
ui.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(run.input);
    ui.copyBtn.textContent = "✓ コピーしました";
  } catch {
    // コピーできない環境では、選んだ状態にして ⌘C / Ctrl+C を促す
    getSelection().selectAllChildren(ui.inputText);
    ui.copyBtn.textContent = "選びました。⌘C / Ctrl+C でコピー";
  }
  setTimeout(() => { ui.copyBtn.textContent = "📋 コピー"; }, 2000);
});
ui.continueBtn.addEventListener("click", () => { ui.loopBox.hidden = true; });
ui.askBtn.addEventListener("click", async () => {
  if (!run.goal) { ui.goalInput.focus(); return; }
  if (await attach()) ask();
});
ui.restartBtn.addEventListener("click", () => { if (run.goal) startGoal(run.goal); });


// ─── 学ぶための補助 ─────────────────────────────────
// 学習モード（答えの前にヒント）は、このパネルを開き直しても続くように覚えておく
try { ui.learnOn.checked = localStorage.getItem("slideSenseiLearn") !== "off"; } catch { /* 覚えられない環境では ON のまま */ }
ui.learnOn.addEventListener("change", () => {
  try { localStorage.setItem("slideSenseiLearn", ui.learnOn.checked ? "on" : "off"); } catch { /* 覚えられなくても動く */ }
  render();
});
ui.revealBtn.addEventListener("click", () => { run.revealed = true; render(); });

// 「🔍 1行ずつ説明」: いまのコードを、1行ずつ AI に説明してもらう
ui.explainBtn.addEventListener("click", async () => {
  if (!run.input) return;
  ui.explainBtn.disabled = true;
  ui.explainBtn.textContent = "🔍 説明を考えています…";
  try {
    const lines = await AI.explainCode({ code: run.input, goal: run.goal });
    ui.explainList.replaceChildren(...lines.map((l) => {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("code"), { textContent: l.code }), l.explain);
      return li;
    }));
    ui.explainList.hidden = !lines.length;
    if (!lines.length) showAi("説明を作れませんでした。もう一度押してみてください。", true);
  } catch (e) {
    showAi(`説明を作れませんでした: ${e.message}`, true);
  } finally {
    ui.explainBtn.disabled = false;
    ui.explainBtn.textContent = "🔍 1行ずつ説明";
  }
});

// 「❓ 質問」: いつでも、いまのページを見せながら AI に質問できる
ui.questionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = ui.questionInput.value.trim();
  if (!question) return;
  if (!AI.enabled()) { showAi("AI が OFF です。下の「設定」で AI を選んでください。", true); return; }
  showAi(`❓ ${question}\n💬 考えています…`);
  try {
    let image = null, app = "";
    if (run.tab || (await attach())) {
      const obs = await observe().catch(() => null);
      if (obs) { image = tagImage({ source: obs.shot, width: obs.shot.width, height: obs.shot.height }, []).plain; app = obs.app; }
    }
    const answer = await AI.answerQuestion({ question, goal: run.goal, done: run.done, current: run.current, app, image });
    showAi(`❓ ${question}\n💬 ${answer || "うまく答えられませんでした。聞き方を変えてみてください。"}`);
    ui.questionInput.value = "";
  } catch (err) {
    showAi(`質問に答えられませんでした: ${err.message}`, true);
  }
});

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
