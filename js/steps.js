// スライド先生: 手順の表示と進め方（レッスンの読み込み・次へ・戻る・できた？・記録）

// ─── Lessons UI ──────────────────────────────────────
for (const [id, lesson] of Object.entries(LESSONS)) {
  el.lessonSelect.append(new Option(lesson.name, id));
}

function lesson() { return LESSONS[state.lessonId]; }
function currentStep() { return lesson().steps[state.step]; }

function render() {
  const L = lesson();
  const total = L.steps.length;
  // おまかせ（L.coach）は手順が AI によって1つずつ増えるので、全体の数は分からない
  const finished = L.coach ? !!L.finished : state.step >= total;
  const done = L.coach ? coach.done.length : Math.min(state.step, total);

  el.tutorLessonName.textContent = `${L.coach ? "おまかせ" : "レッスン"}: ${L.name}`;
  el.progressCount.textContent = L.coach ? `${done} 完了` : `${done} / ${total}`;
  el.progressFill.style.width = `${(finished ? 1 : L.coach ? done / (done + 1) : done / total) * 100}%`;
  el.progressTitle.textContent = finished ? "完了" : L.coach ? `${state.step + 1} 手目` : `ステップ ${state.step + 1}`;

  el.stepCard.hidden = finished;
  el.doneCard.hidden = !finished;
  if (!finished) {
    const step = currentStep();
    el.stepNum.textContent = L.coach ? `STEP ${state.step + 1}` : `STEP ${state.step + 1} / ${total}`;
    el.stepText.textContent = step?.text ?? "🧭 AI が画面を見て、最初の一手を考えています…";
    el.stepHint.textContent = step?.hint ?? "";
    el.expectChip.textContent = L.coach ? "🧭 画面が変わるたびに AI ができたかを確かめます" : EXPECT_LABEL[step.expect];
    const useOcr = ocr.on && !!step?.check;
    el.checkChip.hidden = !useOcr;
    if (useOcr) el.checkChip.textContent = `🔤 自動確認: ${step.when}`;
  }
  el.backBtn.disabled = state.step === 0 || !!L.coach;
  el.nextBtn.textContent = finished ? "次のレッスン →" : "次へ →";
  renderTarget();
}

// 「次のレッスン」で巡回する決まったレッスン（おまかせは含めない）
function fixedLessonIds() { return Object.keys(LESSONS).filter((id) => !LESSONS[id].coach); }

function loadLesson(id) {
  if (LESSONS[id]?.coach) { startCoach(coach.goal); return; }
  state.lessonId = id;
  el.lessonSelect.value = id;
  addLog(`レッスン開始: ${lesson().name}`);
  goTo(0);
}

// knownRead: 移動先ステップ開始時の画面の文字が分かっていれば渡す（読み直しを省く）
// cheer: ステップを終えて進んだときは「できました」と読み上げてから次の手順を伝える
function goTo(step, knownRead = null, cheer = false) {
  state.step = Math.max(0, Math.min(step, lesson().steps.length));
  state.stepToken++;
  state.lastChangeAt = Date.now();
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
    addLog("レッスン完了 🎉");
    speak("レッスン完了です。お疲れさまでした。");
  } else {
    speak(`${cheer ? "できました。" : ""}ステップ${state.step + 1}。${next.text}`);
  }
  if (watching() && !state.paused) setWatch("見守り中 — 操作してみてください");
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
  addLog("まだ — 引き続き見守ります");
});

// ─── Buttons ─────────────────────────────────────────
el.lessonSelect.addEventListener("change", (e) => loadLesson(e.target.value));
el.backBtn.addEventListener("click", () => goTo(state.step - 1));
el.restartBtn.addEventListener("click", () => loadLesson(state.lessonId));
el.nextBtn.addEventListener("click", () => {
  const L = lesson();
  if (L.coach && !L.finished) {
    coachManualDone();
    return;
  }
  if (L.coach || state.step >= L.steps.length) {
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

