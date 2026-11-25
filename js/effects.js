// そうさ先生: 完了したときの演出（紙ふぶき）と、かかった時間の書き方。本体と Office 版で共通
"use strict";

const CONFETTI_MS = 2600;
const CONFETTI_COLORS = ["#c0442b", "#2e6ba0", "#4e7b4a", "#d4a24c", "#e36a50", "#6aa6d9"];

// doc（ミニ窓なら、ミニ窓の document）の上に紙ふぶきを降らせる。動きを減らす設定の人には出さない
function celebrate(doc = document) {
  const win = doc.defaultView;
  if (!win || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  const canvas = doc.createElement("canvas");
  canvas.className = "confetti";
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  const dpr = win.devicePixelRatio || 1;
  canvas.width = Math.round(win.innerWidth * dpr);
  canvas.height = Math.round(win.innerHeight * dpr);
  doc.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 3 * dpr,
    vy: (2 + Math.random() * 4) * dpr,
    size: (5 + Math.random() * 6) * dpr,
    spin: Math.random() * Math.PI,
    turn: (Math.random() - 0.5) * 0.3,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  }));
  const started = win.performance.now();
  const frame = (now) => {
    const t = now - started;
    if (t > CONFETTI_MS || !canvas.isConnected) { canvas.remove(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = t > CONFETTI_MS - 600 ? (CONFETTI_MS - t) / 600 : 1;
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05 * dpr;
      p.spin += p.turn;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    win.requestAnimationFrame(frame);
  };
  win.requestAnimationFrame(frame);
  return canvas;
}

// 1分32秒 のように書く
function formatDuration(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

// 完了したときの成績（かかった時間・手数・AI を使った回数）
function summaryText({ ms, steps, aiCalls }) {
  return `⏱ ${formatDuration(ms)}　👣 ${steps} 手　🤖 AI ${aiCalls} 回${aiCalls === 0 ? "（AI なしで完了！）" : ""}`;
}
