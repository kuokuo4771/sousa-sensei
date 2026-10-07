// スライド先生: AI との連携（番号札を付けて場所を選ばせる）と、🧭 AIにおまかせ

// ─── AI ─────────────────────────────────────────────
// 文字認識で見つけた画面上の文字に番号札を付け、AI には「どの番号を操作するか」を選んでもらう。
// AI は画面上の正確な位置や名前を作るのが苦手なので、位置は文字認識の値をそのまま使う
const MAX_ITEMS = 120;  // AI に渡す番号札の数の上限（多すぎると小さいモデルが迷う）

function renderAiButton() { el.aiBtn.textContent = `🤖 AI ${AI.label()}`; }
renderAiButton();

function showAi(text, cls = "") {
  el.aiBox.hidden = false;
  el.aiBox.className = `ai-box ${cls}`;
  el.aiText.textContent = text;
}

// 文字認識の単語を、AI に選ばせる番号札にまとめる。
// 同じ行で近い単語はつなげる（「新しい」「スラ」「イド」→「新しいスライド」）。
// 日本語では語の中のすき間と隣のボタンとのすき間が同じくらいなので、隣のボタン名までつながることがある。
// そのため元の単語（parts）を残し、光らせるときに AI が答えた文字の部分だけに絞る（boxForText）
function buildItems(read) {
  const items = [];
  for (const w of read.words) {
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
  // 枠線や罫線を「|」「一」と読んだだけのものは除く
  return items
    .filter((it) => /[\p{L}\p{N}]/u.test(it.text) && !/^[|｜_\-—ー一]+$/.test(it.text))
    .slice(0, MAX_ITEMS)
    .map((it, i) => ({ ...it, id: i + 1 }));
}

// AI に見せる画像: 画面を縮小したもの（plain）と、それに番号札（赤い枠と番号）を描き込んだもの（tagged）
// 番号どうしが重なると AI が隣の番号を読んでしまうので、重ならない位置（上→下→左→右）を探して置く
function tagImage(frame, items) {
  const scale = Math.min(1, AI.IMAGE_MAX_SIDE / Math.max(frame.width, frame.height));
  const plain = document.createElement("canvas");
  plain.width = Math.round(frame.width * scale);
  plain.height = Math.round(frame.height * scale);
  plain.getContext("2d").drawImage(frame.source, 0, 0, plain.width, plain.height);

  const tagged = document.createElement("canvas");
  tagged.width = plain.width;
  tagged.height = plain.height;
  const ctx = tagged.getContext("2d");
  ctx.drawImage(plain, 0, 0);
  ctx.font = "bold 13px sans-serif";
  ctx.textBaseline = "top";
  const placed = [];   // 置いた番号札の範囲
  const overlaps = (r) => placed.some((p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h);
  for (const it of items) {
    const x0 = it.x0 * tagged.width, y0 = it.y0 * tagged.height;
    const x1 = it.x1 * tagged.width, y1 = it.y1 * tagged.height;
    ctx.strokeStyle = "rgba(229, 51, 42, 0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    const label = String(it.id);
    const w = ctx.measureText(label).width + 6, h = 15;
    const spots = [
      { x: x0 - 1, y: y0 - h - 1 },               // 上
      { x: x0 - 1, y: y1 + 1 },                   // 下
      { x: x0 - w - 2, y: (y0 + y1 - h) / 2 },    // 左
      { x: x1 + 2, y: (y0 + y1 - h) / 2 },        // 右
    ].map((s) => ({ ...s, w, h }));
    const spot = spots.find((s) => !overlaps(s) && s.x >= 0 && s.y >= 0) ?? spots[0];
    placed.push(spot);
    ctx.fillStyle = "#e5332a";
    ctx.fillRect(spot.x, spot.y, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, spot.x + 3, spot.y + 1);
  }
  return { plain, tagged };
}

// 文字の比べ方をそろえる（空白・全角半角の違いを無視）
const norm = (s) => s.normalize("NFKC").replace(/\s+/g, "");

// 前の画面と今の画面の番号札の文字を比べ、新しく現れた文字と消えた文字を返す（AI の「できた？」判断の手がかり）
function textChanges(beforeTexts, items) {
  if (!beforeTexts) return { appeared: [], disappeared: [] };
  const now = new Set(items.map((it) => norm(it.text)));
  // 1文字の読み違い（「ー」「ロ」など）は除く。ただし漢字1文字（「表」「図」など）はボタン名に多いので残す
  const pick = (list) => [...new Set(list)].filter((t) => t.length >= 2 || /\p{Script=Han}/u.test(t)).slice(0, 15);
  return {
    appeared: pick(items.map((it) => norm(it.text)).filter((t) => !beforeTexts.has(t))),
    disappeared: pick([...beforeTexts].filter((t) => !now.has(t))),
  };
}

// 今の画面を AI に見せて次の一手を聞く。
// ctx: { goal, done, current }。before: { image, texts }（指示を出したときの画面。比べないなら null）
async function askCoach(ctx, before = null) {
  const read = ocr.on ? await readScreen() : null;
  const items = read ? buildItems(read) : [];
  const frame = await grabFrame();
  if (!frame) throw new Error("画面を取得できませんでした");
  let images;
  try {
    images = tagImage(frame, items);
  } finally {
    frame.close();
  }
  const app = state.surface === "monitor"
    ? "画面全体を共有中（どのアプリかは画面から判断する。白い四角は案内用の窓を隠したもので、操作の対象ではない）"
    : state.stream?.getVideoTracks?.()[0]?.label ?? "";
  const { appeared, disappeared } = textChanges(before?.texts, items);
  const r = await AI.coach({
    image: images.tagged, before: before?.image ?? null, appeared, disappeared, app, items, ...ctx,
  });
  // 次の比較に使う「今の画面」（番号札なし）と文字
  const snapshot = { image: images.plain, texts: new Set(items.map((it) => norm(it.text))) };
  return { r, items, snapshot };
}

// AI が選んだ番号札を決める。番号の読み違いに備え、AI が答えた文字（targetText）と照らし合わせる:
// 番号の札の文字と合っていればそのまま、違えば同じ文字の札（複数あれば番号の札にいちばん近いもの）を使う
function resolveTarget(r, items) {
  const byId = items.find((i) => i.id === r.targetId) ?? null;
  const want = r.targetText ? norm(r.targetText) : "";
  if (!want || (byId && norm(byId.text) === want)) return byId;
  const exact = items.filter((i) => norm(i.text) === want);
  const loose = exact.length ? exact : items.filter((i) => norm(i.text).includes(want) || want.includes(norm(i.text)));
  if (!loose.length) return byId;
  if (!byId) return loose[0];
  const dist = (i) => Math.hypot(i.x0 - byId.x0, i.y0 - byId.y0);
  return loose.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
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
  if (it) state.target = { box: boxForText(it, r.targetText, items), name: r.targetText || it.text, say: r.say };
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
    if (state.pip) showAi("AI が OFF です。ブラウザの「🤖 AI」ボタンから設定してください。", "error");
    else openAiDialog();
    return;
  }
  if (!state.stream) { showAi("先に「▶ はじめる」で画面を共有してください。", "error"); return; }
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
const coach = { goal: "", done: [], current: null, before: null, busy: false, again: false, retry: null };

function startCoach(goal) {
  coach.goal = goal;
  coach.done = [];
  coach.current = null;
  coach.before = null;
  LESSONS.coach ={ name: `🧭 ${goal}`, coach: true, steps: [] };
  let opt = [...el.lessonSelect.options].find((o) => o.value === "coach");
  if (!opt) {
    opt = new Option("", "coach");
    el.lessonSelect.append(opt);
  }
  opt.text = LESSONS.coach.name;
  state.lessonId = "coach";
  el.lessonSelect.value = "coach";
  state.step = 0;
  state.stepToken++;
  state.target = null;
  state.targetMissing = null;
  hideConfirm();
  el.aiBox.hidden = true;
  addLog(`🧭 おまかせ開始: ${goal}`);
  render();
  if (state.stream) runCoach();
  else setWatch("「▶ はじめる」で画面を共有すると、AI が案内を始めます。");
}

// force: 「AIに聞く」から呼ばれたとき（考え中の表示を出す）
async function runCoach(force = false) {
  const L = lesson();
  if (!L.coach || L.finished || !state.stream || !AI.enabled()) return;
  if (coach.busy) { coach.again = true; return; }
  coach.busy = true;
  setStatus("AI 考え中");
  if (!coach.current || force) setWatch("🧭 AI が画面を見て、次の一手を考えています…", "moving");
  try {
    // 案内中の手順があれば、それを出したときの画面（coach.before）と比べて「できたか」を判断してもらう
    const { r, items, snapshot } = await askCoach(
      { goal: coach.goal, done: coach.done, current: coach.current },
      coach.current ? coach.before : null,
    );
    if (lesson() === L) applyCoach(L, r, items, snapshot);
  } catch (e) {
    if (/間をあけて|上限/.test(e.message)) {
      // 呼び出し回数の制限に当たったら、少し待ってやり直す（やり直しの予約は1つだけ）
      if (!coach.retry) {
        coach.retry = timerHost().setTimeout(() => { coach.retry = null; runCoach(); }, 4500);
      }
    } else {
      showAi(`AI に聞けませんでした: ${e.message}`, "error");
    }
  } finally {
    coach.busy = false;
    setStatus(state.stream ? "見守り中" : "共有待ち");
    if (coach.again) {
      coach.again = false;
      runCoach();
    }
  }
}

function applyCoach(L, r, items, snapshot) {
  let cheer = false;
  if (coach.current && r.currentDone === true) {
    coach.done.push(coach.current);
    addLog(`✓ ${coach.current}`);
    coach.current = null;
    cheer = true;
    flashCard();
  }
  if (!coach.current && r.status === "done") {
    L.finished = true;
    state.step = L.steps.length;
    state.target = null;
    hideConfirm();
    el.aiBox.hidden = true;
    render();
    addLog("🎉 やりたいことが完了しました");
    speak("できました。やりたいことは完了です。お疲れさまでした。");
    return;
  }
  if (!coach.current && r.status === "next" && r.say) {
    L.steps.push({ text: r.say, hint: r.reason, expect: "any" });
    state.step = L.steps.length - 1;
    state.stepToken++;
    state.lastChangeAt = Date.now();
    coach.current = r.say;
    coach.before = snapshot;   // 次に「できたか」を判断するとき、この画面と比べる
    hideConfirm();
    el.aiBox.hidden = true;
    render();
    targetFromAI(r, items, true);
    setWatch("見守り中 — 操作してみてください");
    speak(`${cheer ? "できました。" : ""}${r.say}`);
    return;
  }
  if (coach.current && r.currentDone === false && r.status !== "unsure") {
    showAi(`まだのようです。${r.say}`);
    targetFromAI(r, items);
    // AI の判定が厳しすぎることもあるので、できていれば人がすぐ進められるようにする（自動では進めない）
    el.confirmText.textContent = "AI は「まだ」と判断しました。できていれば「できた ✓」を押してください。";
    el.confirmBox.hidden = false;
    el.countdown.hidden = true;
    setWatch("見守り中 — 操作してみてください");
    return;
  }
  // AI が判断できないときは人に聞く
  if (coach.current) {
    el.confirmText.textContent = "AI では判断できませんでした。この手順はできましたか？";
    el.confirmBox.hidden = false;
    startCountdown();
    speak("できましたか？");
  } else {
    showAi(r.say || "AI が次の一手を決められませんでした。「🤖 AIに聞く」でもう一度試してください。", "error");
  }
}

// 「できた ✓」「次へ」を押したとき（AI の判定を待たずに次の一手へ）
function coachManualDone() {
  if (coach.current) {
    coach.done.push(coach.current);
    addLog(`✓ ${coach.current}（手動）`);
    coach.current = null;
    flashCard();
  }
  hideConfirm();
  runCoach();
}

