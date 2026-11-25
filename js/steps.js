// そうさ先生: 手順の表示と進め方（レッスンの読み込み・次へ・戻る・できた？・記録）

// ─── Lessons UI ──────────────────────────────────────
// テンプレ（アプリごと）と PowerPoint のレッスンを、まとめてメニューに並べる。テンプレを保存・読み込みしたら作り直す
function fillLessonSelect() {
  const group = (label, options) => {
    const g = document.createElement("optgroup");
    g.label = label;
    g.append(...options);
    return g;
  };
  const byApp = new Map();
  for (const t of Templates.all()) {
    const app = t.app || "どのソフトでも";
    if (!byApp.has(app)) byApp.set(app, []);
    byApp.get(app).push(new Option(`📘 ${t.title}${t.sample ? "（見本）" : ""}`, `tpl:${t.id}`));
  }
  el.lessonSelect.replaceChildren(
    new Option("（選ばない）", "idle"),
    ...[...byApp].map(([app, options]) => group(`テンプレ: ${app}`, options)),
    group("PowerPoint のレッスン", fixedLessonIds().map((id) => new Option(LESSONS[id].name, id))),
  );
}
fillLessonSelect();

function lesson() { return LESSONS[state.lessonId]; }
function currentStep() { return lesson().steps[state.step]; }

function render() {
  const L = lesson();
  const total = L.steps.length;
  // おまかせ（L.coach）は手順が AI によって1つずつ増えるので、全体の数は分からない
  const finished = L.coach ? !!L.finished : !L.idle && state.step >= total;
  const done = L.coach ? coach.done.length : Math.min(state.step, total);

  el.tutorLessonName.textContent = L.idle ? "" : `${L.coach || L.planned ? "おまかせ" : "レッスン"}: ${L.name}`;
  el.progressCount.textContent = L.idle ? "" : L.coach ? `${done} 完了` : `${done} / ${total}`;
  el.progressFill.style.width = `${(L.idle ? 0 : finished ? 1 : L.coach ? done / (done + 1) : done / total) * 100}%`;
  el.progressTitle.textContent = L.idle ? "まだ始まっていません" : finished ? "完了" : L.coach ? `${state.step + 1} 手目` : `ステップ ${state.step + 1}`;

  el.stepCard.hidden = finished;
  el.doneCard.hidden = !finished;
  if (finished) {
    // 完了した瞬間に1回だけ紙ふぶきを出し、成績（時間・手数・AI の回数）を見せる
    if (!state.finishedAt) {
      state.finishedAt = Date.now();
      celebrate(el.doneCard.ownerDocument);
      // 成績が案内パネルの下に隠れないよう、完了カードまでスクロールする
      requestAnimationFrame(() => el.doneCard.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
    el.doneStats.textContent = summaryText({
      ms: state.finishedAt - state.startedAt, steps: L.coach ? coach.done.length : total, aiCalls: AI.totalCalls() - state.startCalls,
    });
    el.doneTitle.textContent = L.coach || L.planned ? "できました！" : "レッスン完了！";
    el.doneNote.textContent = L.coach || L.planned
      ? "お疲れさまでした。「🧭 新しくはじめる」で次のやりたいことを案内します。"
      : "お疲れさまでした。「次のレッスン →」で続けられます。";
  } else if (L.idle) {
    el.stepNum.textContent = "はじめに";
    el.stepText.textContent = "やりたいことを上の欄に書いて「開始」を押してください";
    el.stepHint.textContent = AI.enabled()
      ? "例: 表を入れたい、背景を消したい、セルを実行したい。どのソフトでも案内します。"
      : "AI の設定（⚙ 設定 → 🤖 AI）が必要です。AI なしで試すなら、下の「PowerPoint のレッスン」から選べます。";
    el.inputBox.hidden = true;
    el.checkChip.hidden = true;
  } else {
    const step = currentStep();
    el.stepNum.textContent = L.coach ? `STEP ${state.step + 1}` : `STEP ${state.step + 1} / ${total}`;
    el.stepText.textContent = step?.text ?? "🧭 AI が画面を見て、最初の一手を考えています…";
    el.stepHint.textContent = step?.hint ?? "";
    el.inputBox.hidden = !step?.input;
    el.inputText.textContent = step?.input ?? "";
    el.expectChip.textContent = L.coach ? "🧭 画面が変わるたびに AI ができたかを確かめます"
      : L.planned ? "📝 計画どおりに、画面の文字と変化で確かめます" : EXPECT_LABEL[step.expect];
    const useOcr = ocr.on && !!step?.check;
    el.checkChip.hidden = !useOcr;
    if (useOcr) el.checkChip.textContent = `🔤 自動確認: ${step.when}`;
  }
  el.expectChip.hidden = !!L.idle;
  el.saveTplBtn.hidden = !(finished && L.planned && coach.source === "ai");
  el.backBtn.disabled = state.step === 0 || !!L.coach;
  el.restartBtn.disabled = !!L.idle;
  el.nextBtn.disabled = !!L.idle;
  el.nextBtn.textContent = !finished ? "次へ →" : L.coach || L.planned ? "🧭 新しくはじめる" : "次のレッスン →";
  renderTarget();
  renderPlan();
}

// 「次のレッスン」で巡回する決まったレッスン（おまかせは含めない）
function fixedLessonIds() { return Object.keys(LESSONS).filter((id) => !LESSONS[id].coach && !LESSONS[id].idle && !LESSONS[id].planned); }

function loadLesson(id) {
  if (LESSONS[id]?.coach) { startCoach(coach.goal); return; }
  state.lessonId = id;
  markStart();
  el.lessonSelect.value = LESSONS[id].planned ? "idle" : id;
  if (!lesson().idle) addLog(`レッスン開始: ${lesson().name}`);
  goTo(0);
}

// knownRead: 移動先ステップ開始時の画面の文字が分かっていれば渡す（読み直しを省く）
// cheer: ステップを終えて進んだときは「できました」と読み上げてから次の手順を伝える
function goTo(step, knownRead = null, cheer = false) {
  state.step = Math.max(0, Math.min(step, lesson().steps.length));
  state.stepToken++;
  state.lastChangeAt = Date.now();
  state.plannedChanged = false;
  state.noAskUntil = 0;
  coach.fineBase = null;
  state.prevStartRead = state.startRead;
  state.startRead = null;
  const next = currentStep();
  state.target = next?.keep && state.target ? { ...state.target, say: next.keep } : null;
  state.targetMissing = null;
  hideConfirm();
  el.aiBox.hidden = true;
  resetBase();
  render();
  if (!next) {
    if (!lesson().idle) {
      addLog("レッスン完了 🎉");
      speak("レッスン完了です。お疲れさまでした。");
    }
  } else {
    speak(`${cheer ? "できました。" : ""}ステップ${state.step + 1}。${next.text}`);
  }
  if (watching() && !state.paused) setWatch(lesson().idle ? IDLE_WATCH : "見守り中 — 操作してみてください");
  readStepStart(knownRead);
}

// ステップを終えて次へ進む（how: 記録に残す確かめ方）
function completeStep(how, read = null) {
  addLog(`✓ ステップ ${state.step + 1} 完了${how ? `（${how}）` : ""}`);
  goTo(state.step + 1, read, true);
  flashCard();
  if (state.step < lesson().steps.length) {
    setWatch("できました！ 次のステップへ進みました。");
    state.noticeUntil = Date.now() + 5000;
  }
}

// 手順カードを緑に光らせる（できたときの演出）
function flashCard() {
  el.stepCard.classList.remove("flash");
  void el.stepCard.offsetWidth;   // アニメーションをやり直すため
  el.stepCard.classList.add("flash");
}

// 文字で確認できたので、確認なしで次へ進む
function autoAdvance(read) { completeStep("文字で確認", read); }

// 今の画面を新しい基準にする（ステップ移動時）
function resetBase() { state.baseGray = state.prevGray; state.prevNet = 0; }

// ─── Confirm prompt ──────────────────────────────────
function showConfirm(net, band) {
  const wasOpen = !el.confirmBox.hidden;
  el.confirmText.textContent =
    `画面が変わりました（${BAND_NAME[band]}・${net.toFixed(2)}%）。このステップはできましたか？`;
  el.confirmBox.hidden = false;
  if (!wasOpen) speak("できましたか？");
  startCountdown();
}
function hideConfirm() {
  stopCountdown();
  el.confirmBox.hidden = true;
}

// 「自動で次へ」が ON なら、残り時間のバーを出して AUTO_NEXT_SEC 秒後に次へ進む。
// 操作が続いている間（画面が変化中）は、そのたびに最初から数え直す
function startCountdown() {
  stopCountdown();
  el.countdown.hidden = !prefs.autoNext;
  if (!prefs.autoNext) return;
  el.countdownBar.style.animation = "none";
  void el.countdownBar.offsetWidth;   // アニメーションをやり直すため
  el.countdownBar.style.animation = `countdown ${AUTO_NEXT_SEC}s linear forwards`;
  const host = timerHost();
  state.countdown = {
    host,
    id: host.setTimeout(() => {
      state.countdown = null;
      if (lesson().coach) coachManualDone();
      else completeStep("自動");
    }, AUTO_NEXT_SEC * 1000),
  };
}
function stopCountdown() {
  if (state.countdown) state.countdown.host.clearTimeout(state.countdown.id);
  state.countdown = null;
}

el.yesBtn.addEventListener("click", () => {
  if (lesson().coach) coachManualDone();
  else completeStep("");
});
el.notYetBtn.addEventListener("click", () => {
  hideConfirm();
  state.noAskUntil = Date.now() + PLANNED_REASK_MS;
  addLog("まだ — 引き続き見守ります");
});

// ─── Buttons ─────────────────────────────────────────
el.lessonSelect.addEventListener("change", (e) => {
  const v = e.target.value;
  if (v.startsWith("tpl:")) {
    const t = Templates.get(v.slice(4));
    if (t) startCoach(t.title, t);
    return;
  }
  loadLesson(v);
});
el.backBtn.addEventListener("click", () => goTo(state.step - 1));
el.restartBtn.addEventListener("click", () => loadLesson(state.lessonId));
el.nextBtn.addEventListener("click", () => {
  const L = lesson();
  if (L.coach && !L.finished) {
    coachManualDone();
    return;
  }
  if (L.coach || (L.planned && state.step >= L.steps.length)) {   // おまかせが終わったら、次のやりたいことを書いてもらう
    el.goalInline.value = "";
    loadLesson("idle");
    el.goalInline.focus();
    return;
  }
  if (state.step >= L.steps.length) {
    const ids = fixedLessonIds();
    loadLesson(ids[(ids.indexOf(state.lessonId) + 1) % ids.length]);
    return;
  }
  addLog(`→ ステップ ${state.step + 1} をスキップ`);
  goTo(state.step + 1);
});
el.practiceBtn.addEventListener("click", () => {
  window.open("practice.html", "practice", "width=1280,height=800");
});

// ─── Log / status ────────────────────────────────────
function addLog(text) {
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString().slice(0, -3);
  li.append(time, text);
  el.log.prepend(li);
  while (el.log.children.length > MAX_LOG) el.log.lastChild.remove();
}
function setWatch(text, cls = "on") {
  el.watch.textContent = text;
  el.watch.className = "watch " + cls;
}
function setStatus(text) { el.tutorStatus.textContent = text; }

