// そうさ先生: 画面の変化検知（カーソルを無視し、操作が落ち着いてから判定する）

function toGray(frame) {
  gridCtx.drawImage(frame.source, 0, 0, GRID_W, GRID_H);
  const px = gridCtx.getImageData(0, 0, GRID_W, GRID_H).data;
  const gray = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  }
  return gray;
}

// 変化したセルの割合 (%)。近くの変化セルを塊にまとめ、
// CURSOR_CELLS 以下の小さな塊（カーソル・キャレットなど）は数えない。
// ただしカーソルが作る小さな塊は多くても3つ（動く前と後・点滅する文字カーソル）なので、小さな塊が CURSOR_BLOBS_MAX を超えて
// 同時に出たら、リボンのタブ切替やメニューの文字が入れ替わった「本当の変化」として数える
function diffRatio(a, b) {
  const n = a.length;
  const mask = new Uint8Array(n);   // 0: 変化なし, 1: 変化あり(未処理), 2: 処理済み
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > PIXEL_DIFF) mask[i] = 1;
  let kept = 0;
  let small = 0, smallBlobs = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] !== 1) continue;
    const blob = [i];
    mask[i] = 2;
    for (let q = 0; q < blob.length; q++) {
      const x = blob[q] % GRID_W, y = (blob[q] / GRID_W) | 0;
      for (let dy = -BLOB_GAP; dy <= BLOB_GAP; dy++) {
        for (let dx = -BLOB_GAP; dx <= BLOB_GAP; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
          const k = ny * GRID_W + nx;
          if (mask[k] === 1) { mask[k] = 2; blob.push(k); }
        }
      }
    }
    if (blob.length > CURSOR_CELLS) kept += blob.length;
    else { small += blob.length; smallBlobs++; }
  }
  if (smallBlobs > CURSOR_BLOBS_MAX) kept += small;
  return (kept / n) * 100;
}

// 動きが止まるのを待ってから、最後に確定した画面と比べる
async function sample() {
  if (!state.stream || state.paused) return;
  const frame = await grabFrame();
  if (!state.stream || state.paused) { frame?.close(); return; }
  if (!frame) { schedule(500); return; }
  const gray = toGray(frame);
  drawGuide(frame);
  // おまかせの手順を待っている間だけ、細かいマス目でも見る（細い線や小さな文字の変化を見逃さない）
  const fine = lesson().planned || (lesson().coach && coach.current) ? grayGrid(frame.source) : null;
  frame.close();

  state.prevGray = gray;
  if (!state.baseGray) {
    state.baseGray = gray;
    state.prevNet = 0;
    setWatch("画面を記録しました。操作を待っています。");
    schedule();
    return;
  }
  // 確定画面との差が増減しなくなったら「落ち着いた」とみなす。
  // カーソルを動かすだけなら差はカーソル分でほぼ一定なので「変化中」にならない
  const net = diffRatio(gray, state.baseGray);
  const growth = Math.abs(net - state.prevNet);
  state.prevNet = net;
  el.statMotion.textContent = `増減 ${growth.toFixed(2)}%`;
  el.statNet.textContent = `差 ${net.toFixed(2)}%`;

  if (growth >= STABLE_MAX) {
    setWatch("変化中… 操作が落ち着くのを待っています", "moving");
    if (!el.confirmBox.hidden) startCountdown();   // 操作中は自動で進まない
  } else if (net >= THRESHOLD) {
    state.baseGray = gray;
    state.prevNet = 0;
    onChange(net, bandOf(net));
  } else if (el.confirmBox.hidden && Date.now() > state.noticeUntil) {
    setWatch(lesson().idle ? IDLE_WATCH : "見守り中 — 操作してみてください");
  }
  checkFineChange(fine);
  maybeHintStuck();
  maybeAskPlanned();
  schedule();
}

// 粗いマス目では見えない変化（細い近似直線・数式・小さなパネル）に気づいたら、AI に確かめてもらう。
// カーソルを重ねただけの色の変化でも反応するので、落ち着いてから、FINE_MIN_MS に1回までにする
const FINE_MIN_MS = 10000;
const FINE_PLANNED_MIN_MS = 3000;   // 計画の手順では AI を呼ばないので、短い間隔で見てよい
function checkFineChange(fine) {
  if (!fine) return;
  const prev = coach.finePrev;
  coach.finePrev = fine;
  if (!coach.fineBase) { coach.fineBase = fine; return; }
  const planned = lesson().planned;
  if (coach.busy || Date.now() - coach.fineAt < (planned ? FINE_PLANNED_MIN_MS : FINE_MIN_MS)) return;
  if (!hasRealChange(coach.fineBase, fine) || !prev || hasRealChange(prev, fine)) return;
  coach.fineAt = Date.now();
  state.lastChangeAt = Date.now();
  addLog("細かい変化");
  if (planned) onPlannedChange();
  else runCoach();
}

// 計画の手順で画面が変わったとき。AI は呼ばず、文字で確かめて進む。
// 利用者が先の手順まで進んでいたら（メニューは選ぶと閉じて、途中の目印が消える）、そこまで追いつく
async function onPlannedChange() {
  coach.fineBase = null;
  if (!currentStep()) return;
  state.plannedChanged = true;
  if (!ocr.on) return;
  const token = state.stepToken;
  const reached = async () => {
    const read = await readScreen(PLAN_READ);
    if (token !== state.stepToken || !read) return { read: null, at: -1 };
    const steps = lesson().steps;
    for (let j = Math.min(state.step + 2, steps.length - 1); j >= state.step; j--) {
      const check = steps[j].check && { ...steps[j].check, tab: j === state.step && steps[j].check.tab };
      if (check && checkPassed(check, stepBefore(), read)) return { read, at: j };
    }
    return { read, at: -1 };
  };
  let r = await reached();
  // ツールチップなどが一時的に出ただけのことがあるので、もう一度読んで確かめる
  if (r.at >= 0) r = await reached();
  if (token !== state.stepToken || !r.read) return;
  if (r.at < 0) { updateTarget(r.read); return; }
  if (r.at > state.step) addLog(`→ ステップ ${r.at + 1} まで進んでいたので追いつきました`);
  state.step = r.at;
  completeStep("文字で確認", r.read);
}

// 計画の手順で、画面が変わったあと落ち着いても文字で確かめられないときは、「できた？」と聞く（操作の途中では聞かない）
const PLANNED_ASK_MS = 6000;
const PLANNED_REASK_MS = 20000;   // 「まだ」と答えたあと、同じことをすぐ聞き直さない
function maybeAskPlanned() {
  if (!lesson().planned || !state.plannedChanged || !currentStep() || !el.confirmBox.hidden) return;
  if (Date.now() - state.lastChangeAt < PLANNED_ASK_MS || Date.now() < state.noAskUntil) return;
  state.plannedChanged = false;
  el.confirmText.textContent = "画面が変わりました。この手順はできましたか？";
  el.confirmBox.hidden = false;
  startCountdown();
  speak("できましたか？");
}

// 手順を出してからしばらく画面が変わらないときは、行き詰まっているかもしれないので助け舟を出す（1ステップ1回まで）。
// よくある原因は、ウインドウだけを共有していて、開いたメニューやダイアログが写っていないこと
const STUCK_MS = 20000;
function maybeHintStuck() {
  const L = lesson();
  const waiting = L.coach ? !!coach.current && !coach.busy : state.step < L.steps.length;
  if (!waiting || !el.confirmBox.hidden || state.stuckToken === state.stepToken) return;
  if (Date.now() - state.lastChangeAt < STUCK_MS) return;
  state.stuckToken = state.stepToken;
  const tip = state.surface !== "monitor"
    ? "メニューやダイアログを開いている場合、ウインドウだけの共有では写りません。「⏹ 画面共有を止める」→「🖥 画面を共有する」で画面全体を共有すると見えます。"
    : "迷ったら「🤖 AIに聞く」を押してください。";
  showAi(`しばらく画面に変化がありません。${tip}`, "error");
  el.confirmText.textContent = "この手順はもうできていますか？";
  el.confirmBox.hidden = false;
  el.countdown.hidden = true;
  // 変化を見逃しているだけかもしれないので、おまかせなら1度だけ AI にも確かめてもらう
  if (L.coach) runCoach();
}

async function onChange(net, band) {
  state.lastChangeAt = Date.now();
  state.changes++;
  el.statChanges.textContent = `変化 ${state.changes} 回`;
  addLog(`変化 ${BAND_NAME[band]} ${net.toFixed(2)}%`);
  // おまかせ中は、できたかどうかも次の一手も AI に画面を見て決めてもらう
  if (lesson().coach) { runCoach(); return; }
  if (lesson().planned) { await onPlannedChange(); return; }
  const step = currentStep();
  if (!step) return;

  // 画面の文字を読み、光らせる場所を更新する。完了の条件があれば確かめ、満たせば確認なしで次へ
  if (ocr.on && (step.check || step.targets)) {
    const token = state.stepToken;
    if (step.check) setWatch("文字を確認中…");
    let read = await readScreen();
    if (token !== state.stepToken) return;   // 読んでいる間にステップが変わった
    if (step.check) {
      let passed = read !== null && checkPassed(step.check, stepBefore(), read);
      // 「消えた」「増えた」はツールチップ等が一時的に重なっても満たしてしまうので、もう一度読んで確かめる
      if (passed && (step.check.gone || step.check.grows)) {
        read = await readScreen();
        if (token !== state.stepToken) return;
        passed = read !== null && checkPassed(step.check, stepBefore(), read);
      }
      // 完了したときは光らせる場所を探し直さない（次のステップが同じ場所を使う keep のため）
      if (passed) {
        autoAdvance(read);
        return;
      }
    }
    if (read) updateTarget(read);
  }

  const need = EXPECT_LEVEL[step.expect];
  if (band >= need) {
    showConfirm(net, band);
    setWatch("確認待ち");
    // 文字では確かめられない手順（色・配置・テーマなど）は、AI に画面を見てもらい「できた？」にひとこと添える
    if (!step.check && AI.enabled()) commentByAI(state.stepToken);
  } else {
    setWatch(`変化（${BAND_NAME[band]}・${net.toFixed(2)}%）がありました。このステップは「${BAND_NAME[need]}」以上の変化を待っています。`, "small");
    state.noticeUntil = Date.now() + 8000;
  }
}

