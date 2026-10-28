// そうさ先生: 操作する場所のハイライト（ミニ窓の拡大表示と、共有プレビュー上の赤枠）

// ─── 光らせる場所（ハイライト） ──────────────────────
// 候補を上から順に探し、見つかった中でいちばん上にあるもの（リボンのボタンなど）を光らせる
function updateTarget(read) {
  const step = currentStep();
  if (!step?.targets) return;
  for (const c of step.targets) {
    const boxes = findAll(read, c.re).sort((a, b) => a.y0 - b.y0);
    if (boxes.length) {
      state.target = { box: boxes[0], name: c.name, say: c.say };
      state.targetMissing = null;
      renderTarget();
      refreshGuide();
      return;
    }
  }
  state.target = null;
  state.targetMissing = step.targets[0].name;
  renderTarget();
}

// ハイライトの表示・非表示と、見つからないときのお知らせ
function renderTarget() {
  const t = state.target;
  const show = !!t && watching() && state.step < lesson().steps.length;
  el.guide.hidden = !show;
  el.targetBox.hidden = el.targetTag.hidden = !show;
  if (show) el.guideSay.textContent = t.say;
  const missing = !show && !!state.targetMissing && watching();
  el.guideMissing.hidden = !missing;
  if (missing) {
    el.guideMissing.textContent =
      `画面の中に「${state.targetMissing}」が見つかりませんでした。ウインドウを大きくするか、対象が見える状態にしてください。`;
  }
  syncWebHighlight();   // Web アプリにつないでいれば、ページの上のハイライトもそろえる
}

// 光らせる場所が変わったら、次のサンプルを待たずにすぐ描き直す
async function refreshGuide() {
  const frame = await grabFrame();
  if (!frame) return;
  drawGuide(frame);
  frame.close();
}

// 共有画面のハイライト周辺を拡大して案内パネル（ミニ窓）に描き、プレビュー上にも枠を出す
function drawGuide(frame) {
  const t = state.target;
  if (!t || el.guide.hidden) return;
  const fw = frame.width, fh = frame.height;
  const cw = el.guideCanvas.width, ch = el.guideCanvas.height;
  const bx0 = t.box.x0 * fw, by0 = t.box.y0 * fh, bx1 = t.box.x1 * fw, by1 = t.box.y1 * fh;
  // 切り出す範囲: 対象の約4倍の幅（最低でも画面幅の30%）。案内パネルの縦横比に合わせる
  let sw = Math.max((bx1 - bx0) * 4, fw * 0.3);
  let sh = Math.max(sw * ch / cw, (by1 - by0) * 3);
  sw = sh * cw / ch;
  if (sw > fw) { sw = fw; sh = sw * ch / cw; }
  if (sh > fh) { sh = fh; sw = sh * cw / ch; }
  const sx = Math.min(Math.max((bx0 + bx1) / 2 - sw / 2, 0), fw - sw);
  const sy = Math.min(Math.max((by0 + by1) / 2 - sh / 2, 0), fh - sh);
  el.guideCanvas.getContext("2d").drawImage(frame.source, sx, sy, sw, sh, 0, 0, cw, ch);

  const pad = Math.max(6, (by1 - by0) * 0.35);   // 文字の周りに少し余白をとる
  Object.assign(el.guideBox.style, {
    left: `${((bx0 - pad - sx) / sw) * 100}%`,
    top: `${((by0 - pad - sy) / sh) * 100}%`,
    width: `${((bx1 - bx0 + pad * 2) / sw) * 100}%`,
    height: `${((by1 - by0 + pad * 2) / sh) * 100}%`,
  });
  placePreviewBox();
}

// 共有プレビュー（video）の上に、ハイライト枠と名前を重ねる
function placePreviewBox() {
  const t = state.target;
  if (!t || el.targetBox.hidden || el.captureVideo.hidden) return;
  const v = el.captureVideo.getBoundingClientRect();
  const s = el.captureStage.getBoundingClientRect();
  if (!v.width) return;
  const pad = 4;
  const left = v.left - s.left + t.box.x0 * v.width - pad;
  const top = v.top - s.top + t.box.y0 * v.height - pad;
  Object.assign(el.targetBox.style, {
    left: `${left}px`, top: `${top}px`,
    width: `${(t.box.x1 - t.box.x0) * v.width + pad * 2}px`,
    height: `${(t.box.y1 - t.box.y0) * v.height + pad * 2}px`,
  });
  el.targetTag.textContent = t.name;
  Object.assign(el.targetTag.style, { left: `${left}px`, top: `${top}px` });
}
window.addEventListener("resize", placePreviewBox);

