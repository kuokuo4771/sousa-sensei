// そうさ先生: AI との連携（番号札を付けて場所を選ばせる）と、🧭 AIにおまかせ

// ─── AI ─────────────────────────────────────────────
// 文字認識で見つけた画面上の文字に番号札を付け、AI には「どの番号を操作するか」を選んでもらう。
// AI は画面上の正確な位置や名前を作るのが苦手なので、位置は文字認識の値をそのまま使う
const MAX_ITEMS = 120;  // AI に渡す番号札の数の上限（多すぎると小さいモデルが迷う）
const ICON_TEXT = "［アイコン］";   // 文字のない番号札（アイコンだけのボタン）の札の文字

function renderAiButton() { el.aiBtn.textContent = `🤖 AI ${AI.label()}`; }

// Gemini が混んでいてやり直しているときなどは、待っている理由を見せる
AI.setNotice((msg) => {
  setWatch(msg, "moving");
  addLog(`⚠ ${msg}`);
});
renderAiButton();

function showAi(text, cls = "") {
  el.aiBox.hidden = false;
  el.aiBox.className = `ai-box ${cls}`;
  el.aiText.textContent = text;
}

// 文字認識の単語の範囲の行き過ぎを直す（光らせる範囲が大きく崩れるのを防ぐ）
// - 文字の高さがほかの単語よりずっと高いもの（アイコンや図形を文字と読んだもの）は除く
// - 自信度がとても低い1文字（アイコンや「⌄」を「隊」「較」などと読んだもの）は除く。2文字以上は、本物でも低いことがある（「パス」が 0）
// - 文字数のわりに横に長すぎる範囲（後ろの余白やとなりの部品まで伸びたもの）は、文字数に見合う幅に切り詰める
function tidyWords(read) {
  const heights = read.words.map((w) => (w.y1 - w.y0) * read.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const out = [];
  for (const w of read.words) {
    const hPx = (w.y1 - w.y0) * read.h;
    if (median && hPx > median * 3) continue;
    if ([...norm(w.t)].length === 1 && (w.c ?? 100) < 20) continue;
    if (!/[\p{L}\p{N}]/u.test(norm(w.t))) continue;   // 「。」「・」だけ（選んだタブの下線などを読んだもの）は文字ではない
    const chars = [...norm(w.t)];
    const est = chars.reduce((s, ch) => s + (/[\x20-\x7e]/.test(ch) ? 0.6 : 1), 0) * hPx;   // 文字数に見合う幅（px）
    const widthPx = (w.x1 - w.x0) * read.w;
    out.push(widthPx > est * 1.8 + hPx ? { ...w, x1: w.x0 + (est * 1.3) / read.w } : w);
  }
  return out;
}

// 文字認識の単語（と、画像から見つけたアイコン）を、AI に選ばせる番号札にまとめる。
// 同じ行で近い単語はつなげる（「新しい」「スラ」「イド」→「新しいスライド」）。
// 日本語では語の中のすき間と隣のボタンとのすき間が同じくらいなので、隣のボタン名までつながることがある。
// そのため元の単語（parts）を残し、光らせるときに AI が答えた文字の部分だけに絞る（boxForText）
function buildItems(read) {
  const items = [];
  const icons = (read.icons ?? []).map((b) => ({ ...b, text: ICON_TEXT, parts: [], icon: true }));
  for (const w of dropMisreadIcons(tidyWords(read), icons, read.h / read.w)) {
    const last = items[items.length - 1];
    const hPx = (w.y1 - w.y0) * read.h;
    const sameLine = last && Math.abs((last.y0 + last.y1) / 2 - (w.y0 + w.y1) / 2) * read.h < hPx * 0.6;
    if (sameLine && w.x0 >= last.x0 && (w.x0 - last.x1) * read.w < hPx * 1.2) {
      // 文字認識は単語の範囲を後ろの文字まで広く返すことがある（「新しい」が「スライド」の上まで伸びる等）ので、
      // 前の単語の右端を、この単語の左端までで切り詰める
      const prev = last.parts[last.parts.length - 1];
      if (w.x0 > prev.x0 && w.x0 < prev.x1) prev.x1 = w.x0;
      last.text += w.t;
      last.parts.push({ ...w });
      last.x1 = Math.max(last.x1, w.x1);
      last.y0 = Math.min(last.y0, w.y0);
      last.y1 = Math.max(last.y1, w.y1);
    } else {
      items.push({ text: w.t, parts: [{ ...w }], x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 });
    }
  }
  // 枠線や罫線を「|」「一」と読んだだけのものは除く。アイコンの札は文字の札のあとに並べる
  const texts = items
    .filter((it) => /[\p{L}\p{N}]/u.test(it.text) && !/^[|｜_\-—ー一]+$/.test(it.text))
    .slice(0, MAX_ITEMS - icons.length);
  return [...texts, ...icons].map((it, i) => ({ ...it, id: i + 1 }));
}

// 今の画面を読み、番号札と AI に見せる画像を作る
async function observeScreen() {
  let items, images, app;
  if (web.tabId) {
    // Web アプリにつないでいるときは、文字認識の代わりにページの部品（名前と位置）をそのまま番号札にする
    const obs = await webObserve();
    items = obs.items;
    images = tagImage({ source: obs.shot, width: obs.shot.width, height: obs.shot.height }, items);
    app = obs.app;
  } else {
    // 番号札の位置と AI に見せる画像は、文字認識で読んだのと同じ瞬間の画面を使う
    // （別々に撮ると、読む間（数秒）に画面が動いたとき、札とハイライトがずれる）
    const read = ocr.on ? await readScreen({ keepShot: true }) : null;
    items = read ? buildItems(read) : [];
    if (read?.shot) {
      images = tagImage({ source: read.shot, width: read.shot.width, height: read.shot.height }, items);
    } else {
      const frame = await grabFrame();
      if (!frame) throw new Error("画面を取得できませんでした");
      try {
        images = tagImage(frame, items);
      } finally {
        frame.close();
      }
    }
    app = state.surface === "monitor"
      ? "画面全体を共有中（どのアプリかは画面から判断する。白い四角は案内用の窓を隠したもので、操作の対象ではない）"
      : state.stream?.getVideoTracks?.()[0]?.label ?? "";
  }
  return { items, images, app };
}

// 今の画面を AI に見せて次の一手を聞く。
// ctx: { goal, done, current }。before: { image, texts }（指示を出したときの画面。比べないなら null）
async function askCoach(ctx, before = null) {
  const { items, images, app } = await observeScreen();
  const words = items.filter((it) => !it.icon);
  const { appeared, disappeared } = textChanges(before?.texts, words);
  const change = before?.image ? compareShots(before.image, images.plain) : null;
  // 次の比較に使う「今の画面」（番号札なし）と文字
  const snapshot = { image: images.plain, texts: new Set(words.map((it) => norm(it.text))) };
  const answer = await AI.coach({
    image: images.tagged, before: before?.image ?? null, appeared, disappeared, change, app, items, ...ctx,
  });
  // Web アプリはページから「変わった」と知らせが来るので、スクリーンショットの比較では疑わない
  const clicked = !web.tabId && tabClicked({ step: ctx.current, box: ctx.targetBox, before: before?.image, now: images.plain, appeared });
  const r = checkDoneAnswer(answer, { change: web.tabId ? null : change, doneText: ctx.doneText, beforeTexts: before?.texts, nowTexts: snapshot.texts, clicked });
  return { r, items, snapshot };
}

// 番号札 chosen のうち、文字 want に当たる部分の範囲を返す。
// - 札が want より長い（隣のボタン名までつながっている）→ want に当たる単語だけに絞る
// - 札が want の一部（1語がばらばらに読まれた）→ 同じ行の隣の札をつなげて want を含む範囲にする
function boxForText(chosen, want, items) {
  const w = norm(want);
  const text = norm(chosen.text);
  if (!w) return chosen;
  const idx = text.indexOf(w);
  if (idx >= 0) return sliceParts(chosen.parts, idx, idx + w.length) ?? chosen;
  if (w.includes(text)) {
    const cy = (chosen.y0 + chosen.y1) / 2, h = chosen.y1 - chosen.y0;
    const line = items.filter((i) => Math.abs((i.y0 + i.y1) / 2 - cy) < h * 0.6).sort((a, b) => a.x0 - b.x0);
    const at = line.indexOf(chosen);
    for (let s = Math.max(0, at - 3); s <= at; s++) {
      for (let e = at; e < Math.min(line.length, at + 4); e++) {
        const run = line.slice(s, e + 1);
        const k = norm(run.map((i) => i.text).join("")).indexOf(w);
        if (k >= 0) return sliceParts(run.flatMap((i) => i.parts), k, k + w.length) ?? unionBox(run);
      }
    }
  }
  // 文字認識の読み違い（「挿入」→「挿人」など）でぴったり合わないときは、札の中でいちばん似ている部分に絞る。
  // 札まるごと（隣のボタン名までつながった長い行）を光らせると、範囲が大きく外れて見えるため
  if (text.length > w.length) {
    let best = -1, bestScore = 0;
    for (let s = 0; s + w.length <= text.length; s++) {
      let score = 0;
      for (let i = 0; i < w.length; i++) if (text[s + i] === w[i]) score++;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    if (bestScore >= Math.ceil(w.length / 2)) return sliceParts(chosen.parts, best, best + w.length) ?? chosen;
  }
  return chosen;
}

// 単語の並び parts のうち、文字の位置 [start, end) に当たる範囲。
// 単語の途中で切れるときは、文字の幅の割合で縮める（英数字は日本語の文字の約半分の幅として数える）
function sliceParts(parts, start, end) {
  const charWidth = (ch) => (/[\x20-\x7e]/.test(ch) ? 0.55 : 1);
  const boxes = [];
  let pos = 0;
  for (const p of parts) {
    const chars = [...norm(p.t)];
    const a = pos, b = pos + chars.length;
    pos = b;
    if (!chars.length || b <= start || a >= end) continue;
    const widths = chars.map(charWidth);
    const total = widths.reduce((s, v) => s + v, 0);
    const upTo = (i) => widths.slice(0, i).reduce((s, v) => s + v, 0) / total;   // 単語の先頭から i 文字目までの割合
    const from = upTo(Math.max(start, a) - a), to = upTo(Math.min(end, b) - a);
    const width = p.x1 - p.x0;
    boxes.push({ x0: p.x0 + width * from, x1: p.x0 + width * to, y0: p.y0, y1: p.y1 });
  }
  return boxes.length ? unionBox(boxes) : null;
}

function unionBox(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

// AI が選んだ番号札（なければ AI の推定範囲）を光らせる。札の中では AI が答えた文字の部分だけを光らせる。
// clear: 光らせる場所がないとき、前のハイライトを消す（新しい指示に切り替わったとき）
function targetFromAI(r, items, clear = false) {
  const it = resolveTarget(r, items);
  // Web アプリの部品は名前と位置が正確なので、部品まるごとを光らせる（webId でページの上にも直接出す）
  if (it?.webId) state.target = { box: it, name: it.text, say: r.say, webId: it.webId, webGen: it.webGen };
  // アイコンは札の文字がないので、範囲まるごと。名前は AI が答えたもの（「長方形ツール」など）を使う
  else if (it?.icon) state.target = { box: it, name: r.targetText && norm(r.targetText) !== norm(ICON_TEXT) ? r.targetText : "このアイコン", say: r.say };
  else if (it) state.target = { box: boxForText(it, r.targetText, items), name: r.targetText || it.text, say: r.say };
  else if (r.box) state.target = { box: r.box, name: "ここ（AI の推定）", say: r.say };
  else if (clear) state.target = null;
  else return;
  state.targetMissing = null;
  renderTarget();
  refreshGuide();
}

// 決まったレッスンを AI に説明するときの文脈
function lessonCoachContext() {
  const L = lesson();
  return {
    goal: `${L.name}（手順: ${L.steps.map((s, i) => `${i + 1}. ${s.text}`).join(" / ")}）`,
    done: L.steps.slice(0, state.step).map((s) => s.text),
    current: currentStep()?.text ?? null,
  };
}

// 「🤖 AIに聞く」: 今の画面を見せて、次にやることを聞く
el.askBtn.addEventListener("click", async () => {
  if (!AI.enabled()) {
    // ミニ窓から押されたときは設定画面が元のページの裏に開いてしまうので、案内だけ出す
    if (state.pip) showAi("AI が OFF です。ブラウザの「⚙ 設定」→「🤖 AI」から設定してください。", "error");
    else openAiDialog();
    return;
  }
  if (lesson().idle) { showAi("先に上の欄にやりたいことを書いて「開始」を押してください。", "error"); return; }
  if (!watching()) { showAi("先に「🖥 画面を共有する」か、「🌐 Web アプリにつなぐ」でつないでください。", "error"); return; }
  if (lesson().coach) { runCoach(true); return; }   // おまかせ中は、もう一度画面を見てもらう
  const token = state.stepToken;
  showAi("画面を見ています…", "busy");
  try {
    const { r, items } = await askCoach(lessonCoachContext());
    if (token !== state.stepToken) return;
    showAi(r.reason ? `${r.say}（${r.reason}）` : r.say);
    speak(r.say);
    addLog(`🤖 ${r.say}`);
    targetFromAI(r, items);
  } catch (e) {
    showAi(`AI に聞けませんでした: ${e.message}`, "error");
  }
});

// 「できた？」に AI のひとことを添える（失敗しても「できた？」だけで進められるので、黙って諦める）
async function commentByAI(token) {
  try {
    const { r, items } = await askCoach(lessonCoachContext());
    if (token !== state.stepToken || el.confirmBox.hidden) return;
    if (r.currentDone) {
      showAi(`できているようです。${r.reason}`);
    } else {
      showAi(`まだのようです。${r.say}`);
      targetFromAI(r, items);
    }
  } catch (e) {
    console.warn("AI のひとことを付けられませんでした:", e.message);
  }
}

// ─── 🧭 AIにおまかせ（どのソフトでも） ─────────────────
// 手順を前もって作らず、AI が画面を見て次の一手を1つずつ出す。
// 画面が変わるたびに AI が「いまの手順ができたか」を確かめ、できていれば次の一手へ進む。
// AI が判断できないときは「できた？」で人に聞く
const NO_NOTICE_AFTER = 3;   // この回数続けて「まだ」と判断されたら知らせる
const coach = { source: "ai", template: null, planApp: "", goal: "", done: [], current: null, noCount: 0, doneWhen: "", doneText: "", before: null, busy: false, again: false, retry: null,
  targetBox: null, reasks: 0, repeated: "", loopAsked: new Set(),
  plan: [], planTried: false, notOnScreen: [], nameAsked: new Set(), fineBase: null, finePrev: null, fineAt: 0 };
const MAX_REASKS = 2;   // 「できた」のあと次の一手が返ってこなかったときに、すぐ聞き直す回数

// template: テンプレで案内する（AI を使わない）。auto: やりたいことから自動で選んだテンプレ（AI に切り替えるボタンを出す）
function startCoach(goal, template = null, { auto = false } = {}) {
  coach.goal = goal;
  coach.source = template ? "template" : "ai";
  coach.template = template;
  el.tplNote.hidden = !template;
  if (template) {
    el.tplNoteText.textContent = `📘 テンプレ「${template.title}」で案内します（AI を使いません）${template.sample ? "。見本なので、実物と違うことがあります" : ""}`;
    el.tplSource.hidden = !template.source;
    el.tplSource.href = template.source || "#";
    el.tplSource.textContent = template.source ? "出典: 公式ヘルプ" : "";
    el.tplAiBtn.hidden = !auto;
  }
  coach.done = [];
  coach.current = null;
  coach.before = null;
  coach.fineBase = null;
  coach.noCount = 0;
  coach.repeated = "";
  coach.loopAsked = new Set();
  coach.plan = [];
  coach.planTried = false;
  coach.notOnScreen = [];
  coach.nameAsked = new Set();
  el.loopBox.hidden = true;
  LESSONS.coach ={ name: `🧭 ${goal}`, coach: true, steps: [] };
  state.lessonId = "coach";
  el.lessonSelect.value = template ? `tpl:${template.id}` : "idle";
  state.step = 0;
  state.stepToken++;
  state.target = null;
  state.targetMissing = null;
  hideConfirm();
  el.aiBox.hidden = true;
  if (template) {
    coach.plan = Templates.toScreenSteps(template);
    coach.planTried = true;
    addLog(`📘 テンプレで開始: ${template.title}`);
    startPlanned();
    return;
  }
  addLog(`🧭 おまかせ開始: ${goal}`);
  render();
  if (watching()) runCoach();
  else setWatch("「🖥 画面を共有する」を押すと、AI が案内を始めます。");
}

// force: 「AIに聞く」から呼ばれたとき（考え中の表示を出す）
async function runCoach(force = false) {
  const L = lesson();
  if (!L.coach || L.finished || !watching() || !AI.enabled()) return;
  if (coach.busy) { coach.again = true; return; }
  coach.busy = true;
  coach.fineBase = null;   // ここからの細かい変化を見直す（detect.js）
  setStatus("AI 考え中");
  if (!coach.current || force) setWatch("🧭 AI が画面を見て、次の一手を考えています…", "moving");
  try {
    if (prefs.plan && !coach.planTried) {
      await makePlan();
      if (lesson() !== L) return;
      if (coach.plan.length) { startPlanned(); return; }
    }
    // 案内中の手順があれば、それを出したときの画面（coach.before）と比べて「できたか」を判断してもらう
    const { r, items, snapshot } = await askCoach(
      { goal: coach.goal, done: coach.done, current: coach.current, doneWhen: coach.doneWhen, doneText: coach.doneText,
        targetBox: coach.targetBox, repeated: coach.repeated, notOnScreen: coach.notOnScreen },
      coach.current ? coach.before : null,
    );
    coach.repeated = "";
    coach.notOnScreen = [];
    if (lesson() === L) applyCoach(L, r, items, snapshot, force);
  } catch (e) {
    const wait = AI.retryDelay(e);
    if (wait) {
      // 呼び出し回数の制限に当たったら、少し待ってやり直す（やり直しの予約は1つだけ）
      if (e.retryMs) showAi(`${e.message}。${Math.ceil(wait / 1000)}秒後に自動でもう一度確かめます。`, "busy");
      if (!coach.retry) {
        coach.retry = timerHost().setTimeout(() => { coach.retry = null; runCoach(); }, wait);
      }
    } else {
      showAi(`AI に聞けませんでした: ${e.message}`, "error");
    }
  } finally {
    coach.busy = false;
    setStatus(watching() ? "見守り中" : "共有待ち");
    if (coach.again) {
      coach.again = false;
      runCoach();
    }
  }
}

function applyCoach(L, r, items, snapshot, force = false) {
  let cheer = false;
  if (coach.current && r.currentDone === true) {
    coach.done.push(coach.current);
    addLog(`✓ ${coach.current}${r.evidence ? `（${r.evidence}）` : ""}`);
    coach.current = null;
    cheer = true;
    flashCard();
    showThinking();
    // AI は「まだ」のつもりで答えているので、この答えの次の一手は使わず聞き直す
    if (r.proved) {
      setWatch("できました！ 次の一手を考えています…", "moving");
      coach.again = true;
      return;
    }
  }
  if (!coach.current && r.status === "done") {
    finishCoach(L, r.teach);
    return;
  }
  let repeating = false;
  if (!coach.current && r.status === "next" && r.say) {
    // 終わった手順をまた出してきたら、1度だけ「それは終わった」と伝えて聞き直す。
    // それでも同じなら手順として出し、やりたいことがもうできていないか、利用者に聞く
    const key = stepKey(r.say);
    if (coach.done.some((d) => stepKey(d) === key)) {
      if (!coach.loopAsked.has(key)) {
        coach.loopAsked.add(key);
        coach.repeated = r.say;
        addLog(`↻ 終わった手順「${r.say}」がまた出たので、AI に聞き直します`);
        setWatch("できました！ 次の一手を考えています…", "moving");
        coach.again = true;
        return;
      }
      repeating = true;
    }
    // AI が場所を示せず、言ったボタン名が画面にもないときは、記憶で名前を作った可能性があるので1度だけ聞き直す
    const missing = prefs.plan && !r.targetId && !r.inputText ? namesNotOnScreen(r.say, items) : [];
    if (missing.length && !coach.nameAsked.has(key)) {
      coach.nameAsked.add(key);
      coach.notOnScreen = missing;
      addLog(`↻ 「${missing.join("」「")}」が画面にないので、AI に聞き直します`);
      setWatch("🧭 画面にある名前で考え直しています…", "moving");
      coach.again = true;
      return;
    }
  }
  if (!coach.current && r.status === "next" && r.say) {
    L.steps.push({ text: r.say, hint: r.teach ? `💡 ${r.teach}` : r.reason, input: r.inputText, expect: "any" });
    state.step = L.steps.length - 1;
    state.stepToken++;
    state.lastChangeAt = Date.now();
    coach.current = r.say;
    coach.noCount = 0;
    coach.doneWhen = r.doneWhen ?? "";
    coach.doneText = r.doneText ?? "";
    coach.before = snapshot;   // 次に「できたか」を判断するとき、この画面と比べる
    hideConfirm();
    el.aiBox.hidden = true;
    render();
    targetFromAI(r, items, true);
    coach.targetBox = state.target?.box ?? null;
    coach.reasks = 0;
    el.loopBox.hidden = !repeating;
    setWatch("見守り中 — 操作してみてください");
    speak(`${cheer ? "できました。" : ""}${r.say}`);
    return;
  }
  if (coach.current && r.currentDone === false && r.status !== "unsure") {
    if (r.inputText) { currentStep().input = r.inputText; render(); }
    targetFromAI(r, items);
    // 画面は操作の途中でも変わるので、「まだ」は普通のこと。何度も続くか、利用者が聞いたときだけ知らせる
    coach.noCount++;
    if (!force && coach.noCount < NO_NOTICE_AFTER) {
      setWatch("見守り中 — 操作を続けてください");
      return;
    }
    showAi(`まだのようです。${r.say}`);
    // AI の判定が厳しすぎることもあるので、できていれば人がすぐ進められるようにする（自動では進めない）
    el.confirmText.textContent = `AI は「まだ」と判断しました${r.evidence ? `（${r.evidence}）` : ""}。できていれば「できた ✓」を押してください。`;
    el.confirmBox.hidden = false;
    el.countdown.hidden = true;
    setWatch("見守り中 — 操作してみてください");
    return;
  }
  // AI が判断できないときは人に聞く
  if (coach.current) {
    el.confirmText.textContent = r.doubted
      ? "画面がほとんど変わっていないようです。この手順はできましたか？"
      : `AI では判断できませんでした${r.evidence ? `（${r.evidence}）` : ""}。この手順はできましたか？`;
    el.confirmBox.hidden = false;
    startCountdown();
    speak("できましたか？");
  } else if (cheer && coach.reasks < MAX_REASKS) {
    // 「できた」と分かったのに次の一手が返ってこなかった。画面が変わるのを待たずに聞き直す
    coach.reasks++;
    setWatch("できました！ 次の一手を考えています…", "moving");
    coach.again = true;
  } else {
    showAi(r.say || "AI が次の一手を決められませんでした。「🤖 AIに聞く」でもう一度試してください。", "error");
  }
}

// 手順が済んで次の一手を待っている間は、済んだ手順と、その場所の四角を出したままにしない
// 拡大表示は消さず（消えると画面が見えなくなる）、案内の文字だけ差し替える
function showThinking() {
  const step = currentStep();
  if (step) step.text = "🧭 AI が画面を見て、次の一手を考えています…";
  if (step) step.hint = "";
  if (state.target) state.target = { ...state.target, say: "次の一手を考えています…" };
  render();
}

// 最初に全体の手順を立てる。失敗しても、これまでどおり一手ずつ案内できるので止めない
async function makePlan() {
  setWatch("📝 AI が全体の手順を考えています…", "moving");
  try {
    const { items, images, app } = await observeScreen();
    const software = currentApp();
    const plan = await AI.planCoach({
      goal: coach.goal, app, image: images.plain, items, software, softwareHint: Templates.appInfo(software)?.hint ?? "",
    });
    coach.plan = plan.steps;
    coach.planApp = software || plan.app;
    coach.planTried = true;
    addLog(coach.plan.length ? `📝 全体の手順: ${coach.plan.length} 手` : "📝 全体の手順を立てられませんでした");
  } catch (e) {
    if (AI.retryDelay(e)) throw e;   // 回数制限なら、待ってから計画を立て直す（一手ごとの案内に切り替えると、もっと回数を使う）
    coach.planTried = true;
    coach.plan = [];
    addLog(`📝 全体の手順を立てられませんでした: ${e.message}`);
  }
}

// 計画を決まった手順に変える。ここからは AI を呼ばない。
// できたかどうかは、次に押すボタンの名前など「その手順のあとに現れる文字」で確かめる
function startPlanned() {
  const usable = (name) => !!name && norm(name).length >= 2;
  const steps = coach.plan.map((p, i) => {
    const names = [p.appears, coach.plan[i + 1]?.target].filter(usable);
    const tab = /タブ/.test(p.do);
    const hint = [p.where && `場所: ${p.where}`, p.result && `できると: ${p.result}`].filter(Boolean).join(" / ");
    const step = { text: p.do, hint, input: p.input || undefined, expect: "any" };
    // タブがもう開いていて、次に押すボタンが見えているなら、タブを押す手順は飛ばす（押しても画面が変わらず止まるため）
    if (tab && usable(coach.plan[i + 1]?.target)) step.skipIfVisible = coach.plan[i + 1].target;
    if (names.length || tab) {
      step.check = { newly: names.map(nameRe), tab };
      step.when = names.length ? `「${names[0]}」が画面に出たら次へ` : "タブが切り替わったら次へ";
    }
    if (p.target) step.targets = [{ re: nameRe(p.target), name: p.target, say: p.do }];
    return step;
  });
  LESSONS.plan = { name: coach.source === "template" ? `📘 ${coach.template.title}` : `🧭 ${coach.goal}`, planned: true, steps };
  state.lessonId = "plan";
  el.aiBox.hidden = true;
  goTo(0);
}

// ボタン名を探す正規表現。「入力」の「力」を「カ」と読み違えても通す
function nameRe(name) {
  return new RegExp(norm(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[力カ]/g, "[力カ]"));
}

function renderPlan() {
  const planned = !!lesson().planned;
  el.planBox.hidden = !planned;
  if (!planned) return;
  el.planList.replaceChildren(...coach.plan.map((p, i) => {
    const li = document.createElement("li");
    li.textContent = p.do;
    if (i < state.step) li.className = "done";
    if (i === state.step) li.className = "now";
    return li;
  }));
}

// say の「」の中の名前のうち、画面の文字にないもの。文字認識の読み違いがあるので、2文字の並びの半分以上が合えばあるとみなす
function namesNotOnScreen(say, items) {
  const screen = norm(items.map((it) => it.text).join(""));
  return [...say.matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => m[1]).filter((name) => {
    const n = norm(name);
    if (n.length < 2) return false;
    let hit = 0;
    for (let i = 0; i < n.length - 1; i++) if (screen.includes(n.slice(i, i + 2))) hit++;
    return hit / (n.length - 1) < 0.5;
  });
}

function finishCoach(L, teach = "") {
  L.finished = true;
  state.step = L.steps.length;
  state.target = null;
  hideConfirm();
  el.loopBox.hidden = true;
  el.aiBox.hidden = true;
  if (teach) showAi(`📚 学んだこと: ${teach}`);
  render();
  addLog("🎉 やりたいことが完了しました");
  speak("できました。やりたいことは完了です。お疲れさまでした。");
}

el.finishBtn.addEventListener("click", () => {
  if (coach.current) coach.done.push(coach.current);
  coach.current = null;
  finishCoach(lesson());
});
el.continueBtn.addEventListener("click", () => { el.loopBox.hidden = true; });

// 「できた ✓」「次へ」を押したとき（AI の判定を待たずに次の一手へ）
function coachManualDone() {
  if (coach.current) {
    coach.done.push(coach.current);
    addLog(`✓ ${coach.current}（手動）`);
    coach.current = null;
    flashCard();
    showThinking();
  }
  hideConfirm();
  runCoach();
}


// 「📋 コピー」: AI が書いた入力する中身（コードなど）をコピーする。
// ミニ窓の中で押されたときは、ミニ窓の側のクリップボードを使う
el.copyInputBtn.addEventListener("click", async () => {
  const btn = el.copyInputBtn;
  const win = btn.ownerDocument.defaultView;
  try {
    await win.navigator.clipboard.writeText(el.inputText.textContent);
    btn.textContent = "✓ コピーしました";
  } catch {
    win.getSelection().selectAllChildren(el.inputText);
    btn.textContent = "選びました。⌘C / Ctrl+C でコピー";
  }
  setTimeout(() => { btn.textContent = "📋 コピー"; }, 2000);
});
