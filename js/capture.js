// そうさ先生: 画面共有（はじめる・停止・一時停止）と、共有画面のフレームの取得

// ─── Screen capture ──────────────────────────────────
el.startCaptureBtn.addEventListener("click", quickStart);
el.shareTopBtn.addEventListener("click", quickStart);
el.stopCaptureBtn.addEventListener("click", stopCapture);
el.pauseBtn.addEventListener("click", togglePause);
el.shareWarnBtn.addEventListener("click", switchToMonitor);

// 画面共有のいまの状態を、上のバーの表示とボタンに反映する（共有していないときだけ「共有する」を出す）
function renderShareControls() {
  const sharing = !!state.stream;
  // ウインドウだけの共有では、そのソフトが別に開く小さな窓（Photoshop の文字の設定、メニュー、ダイアログ）が写らない
  const windowOnly = sharing && state.surface === "window";
  el.captureChip.textContent = sharing
    ? (state.paused ? "画面を共有中（見守りは一時停止）" : windowOnly ? "ウインドウだけを共有中" : "画面を共有中")
    : web.tabId ? "🌐 Web アプリにつないでいます" : "画面を共有していません";
  el.shareWarn.hidden = !windowOnly;
  el.captureChip.classList.toggle("on", (sharing && !windowOnly) || !!web.tabId);
  el.shareTopBtn.hidden = sharing;
  el.pauseBtn.hidden = !sharing;
  el.stopCaptureBtn.hidden = !sharing;
  el.pauseBtn.textContent = state.paused ? "▶ 見守りを再開" : "⏸ 見守りを一時停止";
  el.captureFoot.hidden = !sharing;
}

// 共有ボタン1回で、画面共有・ミニ窓・教わりたいソフトを前面へ、までを済ませる。
// 画面共有とミニ窓はどちらも「ボタンを押した直後」にしか開けないので、待たずに続けて呼ぶ
async function quickStart() {
  const sharing = requestShare();
  let pipOpened = null;
  if (canPip && !state.pip) {
    pipOpened = openPip().catch((e) => {
      console.warn(e);
      return null;
    });
  }
  let stream;
  try {
    stream = await sharing;
  } catch (e) {
    if (pipOpened && await pipOpened) state.pip?.close();   // 共有をやめたらミニ窓も閉じて元に戻す
    const msg = e.name === "NotAllowedError"
      ? "共有がキャンセルされたか、画面収録が許可されていません。Mac では システム設定 → プライバシーとセキュリティ → 画面収録 で Chrome を許可し、Chrome を開き直してください。"
      : `${e.name}: ${e.message}`;
    setWatch(msg, "small");
    return;
  }
  await startCapture(stream);
  if (pipOpened && !(await pipOpened)) {
    // 同時に開けなかったときは、もう1回押してもらう
    el.pipBtn.classList.add("attention");
    addLog("📌「ミニ窓で表示」を押すと、案内を最前面に出せます");
  }
}

function requestShare() {
  const controller = "CaptureController" in window ? new CaptureController() : null;
  return navigator.mediaDevices.getDisplayMedia({
    // 画面全体をすすめる。Mac ではメニューやダイアログ（表のマス目・グラフの種類など）が別ウインドウなので、
    // ソフトのウインドウだけを共有するとそれが写らず、変化に気づけない
    video: { displaySurface: "monitor", frameRate: 5 },
    audio: false,
    selfBrowserSurface: "exclude",   // このページ自身は選べないようにする
    surfaceSwitching: "include",     // Chrome の共有バーから、共有するウインドウを切り替えられるようにする
    ...(controller && { controller }),
  }).then((stream) => {
    // 選んだウインドウ（PowerPoint）を前面に出す。共有が決まった直後にしか呼べない
    try { controller?.setFocusBehavior("focus-captured-surface"); } catch { /* 古い Chrome では何もしない */ }
    return stream;
  });
}

async function startCapture(stream) {
  try {
    if (web.tabId) await disconnectWeb("画面共有に切り替えたため");   // Web アプリ連携とは同時に使わない
    state.stream = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener("ended", stopCapture);
    // ImageCapture はタブが裏に回っても（video が描画されなくても）フレームを取れる
    state.imageCapture = "ImageCapture" in window ? new ImageCapture(track) : null;
    // monitor（画面全体）/ window（ウインドウ）/ browser（タブ）
    state.surface = track.getSettings?.().displaySurface ?? "window";
    el.captureVideo.srcObject = stream;
    el.captureVideo.hidden = false;
    el.emptyState.hidden = true;
    renderShareControls();
    await el.captureVideo.play();
    state.prevGray = null;
    state.baseGray = null;
    state.changes = 0;
    state.lastChangeAt = Date.now();
    el.statMotion.textContent = "増減 —";
    el.statNet.textContent = "差 —";
    el.statChanges.textContent = "変化 0 回";
    setStatus("見守り中");
    addLog(`共有開始: ${track.label || "ウインドウ"}`);
    noteApp("", track.label);
    // まだ何も始めていなければ、画面の文字を1度読んで使っているソフトを見分けておく
    if (lesson().idle && ocr.on) ensureOcr().then(() => readScreen());
    warnedHidden = false;
    const step = currentStep();
    if (step) speak(`ステップ${state.step + 1}。${step.text}`);
    if (lesson().coach) {
      // おまかせ中なら、文字認識の準備ができてから AI に最初の一手を聞く
      (ocr.on ? ensureOcr() : Promise.resolve()).then(() => runCoach());
    } else if (ocr.on) {
      ensureOcr().then(() => readStepStart());
    }
    schedule(500);
  } catch (e) {
    setWatch(`${e.name}: ${e.message}`, "small");
  }
}

// ウインドウだけの共有から、画面全体の共有に切り替える。いまのレッスンはそのまま続ける
async function switchToMonitor() {
  let stream;
  try {
    stream = await requestShare();
  } catch (e) {
    setWatch(e.name === "NotAllowedError" ? "切り替えをやめました。いまの共有のまま続けます。" : `${e.name}: ${e.message}`, "small");
    return;
  }
  // 古い共有を止める（stop() では ended が来ないが、念のため外してから止める）
  state.stream?.getTracks().forEach((t) => { t.removeEventListener("ended", stopCapture); t.stop(); });
  await startCapture(stream);
  if (state.surface === "monitor") addLog("🖥 画面全体の共有に切り替えました");
}

function stopCapture() {
  clearSchedule();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  state.imageCapture = null;
  el.captureVideo.srcObject = null;
  el.captureVideo.hidden = true;
  el.emptyState.hidden = false;
  state.paused = false;
  renderShareControls();
  hideConfirm();
  state.target = null;
  renderTarget();
  setStatus("共有待ち");
  setWatch("画面共有を開始すると、変化を見守ります。", "");
}

function togglePause() {
  state.paused = !state.paused;
  renderShareControls();
  if (state.paused) {
    clearSchedule();
    setStatus("一時停止");
    setWatch("一時停止中", "");
  } else {
    state.prevGray = null;
    setStatus("見守り中");
    schedule(300);
  }
}

function schedule(delay = INTERVAL_MS) {
  clearSchedule();
  const host = timerHost();
  state.timer = { host, id: host.setTimeout(sample, delay) };
}
function clearSchedule() {
  if (state.timer) state.timer.host.clearTimeout(state.timer.id);
  state.timer = null;
}

// 共有中の画面の最新フレーム。ImageCapture はタブが裏に回っても（video が描画されなくても）取れる。
// 画面全体を共有しているときは、自分の案内（ミニ窓・このページ）を塗りつぶしてから返す
async function grabFrame() {
  const frame = await grabRawFrame();
  if (!frame || state.surface !== "monitor") return frame;
  const rects = ownWindowRects(frame);
  if (!rects.length) return frame;
  const c = document.createElement("canvas");
  c.width = frame.width;
  c.height = frame.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(frame.source, 0, 0);
  frame.close();
  ctx.fillStyle = "#ffffff";
  for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  return { source: c, width: c.width, height: c.height, close: () => {} };
}

async function grabRawFrame() {
  // Web アプリにつないでいるときは、最後に撮ったスクリーンショット（ミニ窓の拡大表示用）
  if (!state.stream && web.lastShot) {
    return { source: web.lastShot, width: web.lastShot.width, height: web.lastShot.height, close: () => {} };
  }
  if (state.imageCapture) {
    try {
      const bitmap = await state.imageCapture.grabFrame();
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* video にフォールバック */ }
  }
  const v = el.captureVideo;
  if (!v.videoWidth) return null;
  return { source: v, width: v.videoWidth, height: v.videoHeight, close: () => {} };
}

// 画面全体の共有で写り込む自分のウインドウ（ミニ窓と、見えているときはこのページ）の、フレーム上の範囲。
// 案内の文字（「挿入タブをクリック」など）を文字認識や AI が読んで、そこを光らせてしまうのを防ぐ。
// このページがある画面と共有中の画面の縦横比が違う（別のディスプレイを共有している）ときは塗らない
function ownWindowRects(frame) {
  const sw = screen.width, sh = screen.height;
  if (!sw || !sh || Math.abs(frame.width / frame.height - sw / sh) > 0.02) return [];
  const scale = frame.width / sw;
  // 画面の左上の位置（2台目のディスプレイでは 0 でない）。Mac のメニューバーの高さは除く
  const ox = screen.availLeft || 0;
  const oy = (screen.availTop || 0) < 60 ? 0 : screen.availTop;
  const wins = [];
  if (state.pip && !state.pip.closed) wins.push(state.pip);
  if (document.visibilityState === "visible") wins.push(window);
  const pad = 4;
  return wins.map((w) => ({
    x: (w.screenX - ox) * scale - pad, y: (w.screenY - oy) * scale - pad,
    w: w.outerWidth * scale + pad * 2, h: w.outerHeight * scale + pad * 2,
  }));
}

