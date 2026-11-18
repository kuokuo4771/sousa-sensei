// そうさ先生: 番号札（Set-of-Mark）の共通部品。本体（index.html）と Chrome 拡張機能のサイドパネルで共用する。
// 拡張機能へは tools/sync-extension.sh でコピーする（extension/shared/som.js）。ここを直したら必ずコピーし直すこと
// 必要なもの: AI.IMAGE_MAX_SIDE（js/ai.js）
"use strict";

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

// AI が選んだ番号札を決める。番号の読み違いに備え、AI が答えた文字（targetText）と照らし合わせる:
// 番号の札の文字と合っていればそのまま、違えば同じ文字の札（複数あれば番号の札にいちばん近いもの）を使う
function resolveTarget(r, items) {
  const byId = items.find((i) => i.id === r.targetId) ?? null;
  const want = r.targetText ? norm(r.targetText) : "";
  // アイコンの札（文字なし）は、AI が答えた名前（「長方形ツール」など）では確かめられないので、番号を信じる
  if (!want || byId?.icon || (byId && norm(byId.text) === want)) return byId;
  const exact = items.filter((i) => norm(i.text) === want);
  // ゆるく合わせるときも、AI の答えの半分以上の長さが重なる札だけにする
  // （「の」「表」のような1文字の札が、長い答えの一部として選ばれると、まったく別の場所が光る）
  const overlapOk = (t) => t.length >= Math.max(2, Math.ceil(want.length / 2));
  const loose = exact.length ? exact : items.filter((i) => {
    const t = norm(i.text);
    return t.includes(want) || (want.includes(t) && overlapOk(t));
  });
  if (!loose.length) return byId;
  if (!byId) return loose[0];
  const dist = (i) => Math.hypot(i.x0 - byId.x0, i.y0 - byId.y0);
  return loose.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
}

// ─── 前後の画面を比べる ─────────────────────────────
// 変化検知（detect.js）の粗いマス目では、細い近似直線や小さな数式を見逃すので、細かいマス目で見る。
const CMP_W = 768, CMP_H = 432;
const CMP_DIFF = 18;      // 1マスを「変化あり」とみなす明るさの差 (0-255)
const CMP_GAP = 2;        // この距離（マス）以内の変化は同じ塊とみなす
const CMP_CURSOR = 16;    // 縦横ともこのマス数以下の塊はカーソルかもしれないとみなす（数式のような文字列は横に長いので区別できる）
const CMP_CURSOR_BLOBS = 3;
const CROP_MAX_AREA = 0.5;   // 変化がこれより広ければ（画面の割合）、拡大しても意味がない
const cmpCanvas = document.createElement("canvas");
cmpCanvas.width = CMP_W;
cmpCanvas.height = CMP_H;
const cmpCtx = cmpCanvas.getContext("2d", { willReadFrequently: true });

function grayGrid(source) {
  cmpCtx.drawImage(source, 0, 0, CMP_W, CMP_H);
  const px = cmpCtx.getImageData(0, 0, CMP_W, CMP_H).data;
  const gray = new Uint8Array(CMP_W * CMP_H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  }
  return gray;
}

// 変化したマスの塊の一覧 [{ x0, y0, x1, y1 }]（位置はマス目の番号）
function changedBlobs(a, b) {
  const mask = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > CMP_DIFF) mask[i] = 1;
  const blobs = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    mask[i] = 0;
    const queue = [i];
    const blob = { x0: CMP_W, y0: CMP_H, x1: 0, y1: 0 };
    while (queue.length) {
      const k = queue.pop();
      const x = k % CMP_W, y = (k / CMP_W) | 0;
      blob.x0 = Math.min(blob.x0, x); blob.x1 = Math.max(blob.x1, x);
      blob.y0 = Math.min(blob.y0, y); blob.y1 = Math.max(blob.y1, y);
      for (let dy = -CMP_GAP; dy <= CMP_GAP; dy++) {
        for (let dx = -CMP_GAP; dx <= CMP_GAP; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= CMP_W || ny >= CMP_H) continue;
          const n = ny * CMP_W + nx;
          if (mask[n]) { mask[n] = 0; queue.push(n); }
        }
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

function biggerThanCursor(blob) {
  return blob.x1 - blob.x0 + 1 > CMP_CURSOR || blob.y1 - blob.y0 + 1 > CMP_CURSOR;
}

// カーソルより大きな変化の塊。カーソルが作る小さな塊は多くても3つ（動く前と後・点滅する文字カーソル）なので、
// それより多ければ、文字ごとに分かれた小さな文字列（数式など）の変化として数える
function realBlobs(blobs) {
  const big = blobs.filter(biggerThanCursor);
  return big.length ? big : blobs.length > CMP_CURSOR_BLOBS ? blobs : [];
}

function hasRealChange(a, b) {
  return realBlobs(changedBlobs(a, b)).length > 0;
}

function cropCanvas(source, x, y, w, h) {
  const zoom = Math.min(3, Math.max(1, 1024 / Math.max(w, h)));
  const c = document.createElement("canvas");
  c.width = Math.round(w * zoom);
  c.height = Math.round(h * zoom);
  c.getContext("2d").drawImage(source, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

// 2枚の画面（キャンバス）を比べる。返り値: { any: 何か変わった, real: カーソルより大きく変わった, crops: 変わった部分の拡大 }
function compareShots(before, now) {
  const blobs = changedBlobs(grayGrid(before), grayGrid(now));
  const real = realBlobs(blobs);
  const use = real.length ? real : blobs;
  const result = { any: blobs.length > 0, real: real.length > 0, crops: null };
  if (!use.length) return result;
  const pad = 24;
  const x0 = Math.max(0, Math.min(...use.map((b) => b.x0)) - pad), x1 = Math.min(CMP_W, Math.max(...use.map((b) => b.x1)) + pad);
  const y0 = Math.max(0, Math.min(...use.map((b) => b.y0)) - pad), y1 = Math.min(CMP_H, Math.max(...use.map((b) => b.y1)) + pad);
  if (((x1 - x0) * (y1 - y0)) / (CMP_W * CMP_H) > CROP_MAX_AREA) return result;
  const [sx, sy] = [now.width / CMP_W, now.height / CMP_H];
  const [bx, by] = [before.width / CMP_W, before.height / CMP_H];
  result.crops = {
    before: cropCanvas(before, x0 * bx, y0 * by, (x1 - x0) * bx, (y1 - y0) * by),
    after: cropCanvas(now, x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy),
  };
  return result;
}

// AI の「できた／まだ」を、画面の事実で確かめて直す。
//   proved: AI が「まだ」と言っても、完了の目印の文字が新しく現れていれば、できたとみなす
//   doubted: AI が「できた」と言っても、画面がまったく変わっていなければ、人に聞く
//   clicked: タブを押す手順で、押すタブの見た目が変わり、リボンの文字も入れ替わっていれば、できたとみなす
function checkDoneAnswer(r, { change, doneText, beforeTexts, nowTexts, clicked = false }) {
  if (clicked) {
    return { ...r, currentDone: true, proved: r.currentDone !== true, evidence: r.evidence || "押すタブの見た目が変わり、リボンの中身が入れ替わった" };
  }
  const want = norm(doneText ?? "");
  const has = (texts) => [...(texts ?? [])].join("").includes(want);
  if (want.length >= 3 && has(nowTexts) && !has(beforeTexts)) {
    return { ...r, currentDone: true, proved: r.currentDone !== true, evidence: r.evidence || `「${doneText}」が画面に現れた` };
  }
  if (r.currentDone === true && change && !change.any) return { ...r, currentDone: null, doubted: true };
  return r;
}

// タブを押す手順ができたか。AI に聞かなくても画面の事実で分かる:
// 押すタブ（box）の見た目が変わった（選ばれた印・色）うえに、リボンの文字が3つ以上新しく現れた。
// 別のタブを押したときは、押すはずのタブの見た目は変わらないので、できたことにならない
const TAB_STEP = /タブ/;
function tabClicked({ step, box, before, now, appeared }) {
  if (!TAB_STEP.test(step ?? "") || !box || !before || !now || appeared.length < 3) return false;
  return regionChanged(before, now, box);
}

// 2枚の画面の box のあたり（選ばれた印が出る下側を広めに含む）が変わったか
function regionChanged(before, now, box) {
  const h = box.y1 - box.y0, w = box.x1 - box.x0;
  const r = { x0: Math.max(0, box.x0 - w * 0.1), x1: Math.min(1, box.x1 + w * 0.1),
              y0: Math.max(0, box.y0 - h * 0.3), y1: Math.min(1, box.y1 + h * 1.0) };
  const size = 48;
  const crop = (src) => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(src, r.x0 * src.width, r.y0 * src.height, (r.x1 - r.x0) * src.width, (r.y1 - r.y0) * src.height, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size).data;
  };
  const a = crop(before), b = crop(now);
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 90) changed++;
  }
  return changed / (size * size) >= 0.03;
}

// 手順の「中身」を表す鍵。言い回しが変わっても、同じボタン名（「」の中）なら同じ手順とみなす（堂々めぐりに気づくため）
function stepKey(say) {
  const names = [...say.matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => m[1].trim()).sort();
  return names.length ? names.join("|") : say.replace(/[\s、。・「」『』（）()]/g, "");
}
