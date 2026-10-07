// スライド先生 Web 連携: つないだ Web アプリのタブの中で動く読み取り係
// - 押せる部品（ボタン・メニュー・タブ・入力欄など）の名前と位置を集める（items）
// - ページの上に直接ハイライトを描く（highlight / clear）
// - 利用者が操作したあと、ページが落ち着いたら「変わった」と知らせる
// Colab などはウェブ部品（Shadow DOM）の中にボタンがあるので、その中まで探す
(() => {
  if (window.__senseiAgent) return;   // 何度入れられても1つだけ動く
  window.__senseiAgent = true;

  const MAX_ITEMS = 150;
  const SETTLE_MS = 700;        // 操作のあと、ページの変化がこれだけ止まったら「変わった」と知らせる
  const AFTER_INPUT_MS = 3000;  // 操作からこの時間内のページの変化だけを数える（勝手に動く表示を無視するため）
  const PICK = [
    "button", "a[href]", "input", "select", "textarea", "summary", "label",
    "[role=button]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
    "[role=link]", "[role=checkbox]", "[role=radio]", "[role=option]", "[role=treeitem]", "[role=switch]",
    "[role=combobox]", "[role=textbox]", "[contenteditable=true]",
    "[aria-label]", "[title]", "[data-tooltip]",
  ].join(",");

  // ─── 部品を集める ───────────────────────────────
  let byId = new Map();

  function deepCandidates(root, out) {
    for (const el of root.querySelectorAll("*")) {
      if (el.matches(PICK)) out.push(el);
      if (el.shadowRoot) deepCandidates(el.shadowRoot, out);
    }
    return out;
  }

  function labelOf(el) {
    const raw = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-tooltip")
      || (el.innerText || "").trim() || el.getAttribute("placeholder") || (el.type === "button" || el.type === "submit" ? el.value : "")
      || "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function visible(el, r) {
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  function collect() {
    const seen = new Set();
    const items = [];
    byId = new Map();
    for (const el of deepCandidates(document, [])) {
      if (overlay.contains(el)) continue;
      const label = labelOf(el);
      if (!label) continue;
      const r = el.getBoundingClientRect();
      if (!visible(el, r)) continue;
      // 同じ名前でほぼ同じ場所の部品（ボタンとその中のアイコンなど）は1つにまとめる
      const key = `${label}|${Math.round(r.left / 8)}|${Math.round(r.top / 8)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ el, label, r });
    }
    items.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    return items.slice(0, MAX_ITEMS).map((it, i) => {
      const id = i + 1;
      byId.set(id, it.el);
      return {
        id, text: it.label, role: it.el.getAttribute("role") || it.el.tagName.toLowerCase(),
        x0: it.r.left / innerWidth, y0: it.r.top / innerHeight, x1: it.r.right / innerWidth, y1: it.r.bottom / innerHeight,
      };
    });
  }

  // ─── ページの上のハイライト ─────────────────────────
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  overlay.innerHTML = `
    <style>
      @keyframes sensei-pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(224,103,78,.35); } 50% { box-shadow: 0 0 0 9px rgba(224,103,78,.15); } }
      .sensei-box { position: fixed; border: 3px solid #e0674e; border-radius: 6px; animation: sensei-pulse 1.3s ease-in-out infinite; }
      .sensei-tag { position: fixed; padding: 3px 10px; border-radius: 999px; background: #e0674e; color: #fff;
        font: 700 12px/1.4 "Hiragino Sans", sans-serif; white-space: nowrap; transform: translateY(calc(-100% - 6px)); }
    </style>
    <div class="sensei-box" hidden></div><div class="sensei-tag" hidden></div>`;
  const box = overlay.querySelector(".sensei-box");
  const tag = overlay.querySelector(".sensei-tag");
  (document.body || document.documentElement).append(overlay);

  let target = null;   // { el } または { box: {x0,y0,x1,y1} }
  let label = "";
  let raf = 0;

  function place() {
    if (!target) return;
    let r;
    if (target.el) {
      if (!target.el.isConnected) { clear(); return; }
      r = target.el.getBoundingClientRect();
    } else {
      const b = target.box;
      r = { left: b.x0 * innerWidth, top: b.y0 * innerHeight, width: (b.x1 - b.x0) * innerWidth, height: (b.y1 - b.y0) * innerHeight };
    }
    const pad = 4;
    Object.assign(box.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    Object.assign(tag.style, { left: `${r.left - pad}px`, top: `${Math.max(r.top - pad, 26)}px` });
    raf = requestAnimationFrame(place);   // スクロールや画面の動きについていく
  }

  function highlight(msg) {
    clear();
    const el = msg.id != null ? byId.get(msg.id) : null;
    if (el) {
      target = { el };
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (msg.box) {
      target = { box: msg.box };
    } else {
      return;
    }
    label = msg.label || "ここ";
    tag.textContent = label;
    box.hidden = tag.hidden = false;
    place();
  }

  function clear() {
    cancelAnimationFrame(raf);
    target = null;
    box.hidden = tag.hidden = true;
  }

  // ─── 変化を知らせる ───────────────────────────────
  let lastInput = 0;
  let timer = 0;
  function notifySoon() {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.runtime.sendMessage({ from: "web", event: "changed" }).catch(() => {}), SETTLE_MS);
  }
  for (const type of ["click", "keyup", "input", "change"]) {
    window.addEventListener(type, () => { lastInput = Date.now(); notifySoon(); }, true);
  }
  new MutationObserver((records) => {
    if (Date.now() - lastInput > AFTER_INPUT_MS) return;           // 操作と関係のない、勝手に動く表示は数えない
    if (records.every((m) => overlay.contains(m.target))) return;  // 自分のハイライトの変化は数えない
    notifySoon();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  // ─── 本体からの頼みごと ─────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "items") {
      const focused = document.activeElement && document.activeElement !== document.body ? labelOf(document.activeElement) : "";
      sendResponse({ items: collect(), title: document.title, url: location.href, focused });
    } else if (msg.type === "highlight") {
      highlight(msg);
      sendResponse({ ok: true });
    } else if (msg.type === "clear") {
      clear();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
