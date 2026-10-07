// スライド先生: 画面共有（はじめる・停止・一時停止）と、共有画面のフレームの取得

// ─── Screen capture ──────────────────────────────────
el.startCaptureBtn.addEventListener("click", quickStart);
el.stopCaptureBtn.addEventListener("click", stopCapture);
el.pauseBtn.addEventListener("click", togglePause);

// 「はじめる」1回で、画面共有・ミニ窓・PowerPoint を前面へ、までを済ませる。
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
      ? "共有がキャンセルされたか、macOS の画面収録が許可されていません。"
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
    el.stopCaptureBtn.hidden = false;
    el.pauseBtn.hidden = false;
    el.captureChip.textContent = "共有中";
    el.captureChip.classList.add("on");
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

function stopCapture() {
  clearSchedule();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  state.imageCapture = null;
  el.captureVideo.srcObject = null;
  el.captureVideo.hidden = true;
  el.emptyState.hidden = false;
  el.stopCaptureBtn.hidden = true;
  el.pauseBtn.hidden = true;
  el.captureChip.textContent = "未共有";
  el.captureChip.classList.remove("on");
  hideConfirm();
  state.target = null;
  renderTarget();
  setStatus("共有待ち");
  setWatch("画面共有を開始すると、変化を見守ります。", "");
}

function togglePause() {
  state.paused = !state.paused;
  el.pauseBtn.textContent = state.paused ? "▶ 再開" : "⏸ 一時停止";
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

