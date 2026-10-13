// スライド先生: 番号札（Set-of-Mark）の共通部品。本体（index.html）と Chrome 拡張機能のサイドパネルで共用する。
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
  if (!want || (byId && norm(byId.text) === want)) return byId;
  const exact = items.filter((i) => norm(i.text) === want);
  const loose = exact.length ? exact : items.filter((i) => norm(i.text).includes(want) || want.includes(norm(i.text)));
  if (!loose.length) return byId;
  if (!byId) return loose[0];
  const dist = (i) => Math.hypot(i.x0 - byId.x0, i.y0 - byId.y0);
  return loose.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
}

