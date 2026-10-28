// そうさ先生: Web アプリ連携（Chrome 拡張機能「そうさ先生 Web 連携」との取り次ぎ）
// 拡張機能が入っていれば、画面共有と文字認識の代わりに、Web アプリ（Google Colab など）のタブの
// 部品の名前と位置を直接読み、ページの上に直接ハイライトを描く。
// 拡張機能とのやりとりは、このページに入る取り次ぎ役（extension/hub-bridge.js）と window.postMessage で行う
const web = {
  ext: false,         // 拡張機能が入っているか
  version: "",
  tabId: null,        // つないでいるタブ
  title: "",
  url: "",
  lastShot: null,     // 最後に撮ったスクリーンショット（ミニ窓の拡大表示に使う）
  highlighted: "",    // ページの上に今出しているハイライト（同じものを何度も送らないため）
  seq: 0,
  pending: new Map(),
};

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "sensei-ext") return;
  const d = e.data;
  if (d.type === "hello") {
    web.ext = true;
    web.version = d.version;
    renderWebDialog();
  } else if (d.type === "reply") {
    const p = web.pending.get(d.id);
    if (!p) return;
    web.pending.delete(d.id);
    clearTimeout(p.timer);
    if (d.res?.error) p.reject(new Error(d.res.error));
    else p.resolve(d.res);
  } else if (d.type === "event") {
    onWebEvent(d.event);
  }
});
// 拡張機能が入っていれば、取り次ぎ役が hello を返す
window.postMessage({ source: "sensei-hub", type: "ping" }, "*");

function extCall(type, payload = {}, timeoutMs = 8000) {
  if (!web.ext) return Promise.reject(new Error("拡張機能「そうさ先生 Web 連携」が見つかりません"));
  const id = ++web.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      web.pending.delete(id);
      reject(new Error("拡張機能から返事がありません"));
    }, timeoutMs);
    web.pending.set(id, { resolve, reject, timer });
    window.postMessage({ source: "sensei-hub", id, type, ...payload }, "*");
  });
}

// ─── つなぐ・切る ───────────────────────────────────
async function connectWeb(tabId) {
  if (state.stream) stopCapture();   // 画面共有とは同時に使わない
  const r = await extCall("connect", { tabId });
  web.tabId = tabId;
  web.title = r.title;
  web.url = r.url;
  web.highlighted = "";
  state.changes = 0;
  state.lastChangeAt = Date.now();
  el.emptyState.hidden = true;
  el.webState.hidden = false;
  el.webStateTitle.textContent = r.title;
  el.captureChip.textContent = "🌐 つないでいます";
  el.captureChip.classList.add("on");
  setStatus("見守り中");
  addLog(`🌐 つないだ: ${r.title}`);
  extCall("focus").catch(() => {});   // スクリーンショットはタブが前に出ていないと撮れない
  if (lesson().coach) runCoach();
  else setWatch("🧭 欄にやりたいことを書いて「開始」を押すと、AI がこのページで案内します。");
  renderWebDialog();
}

async function disconnectWeb(reason = "") {
  if (!web.tabId) return;
  await extCall("disconnect").catch(() => {});
  web.tabId = null;
  web.lastShot = null;
  web.highlighted = "";
  el.webState.hidden = true;
  el.emptyState.hidden = !!state.stream;
  el.captureChip.textContent = "未共有";
  el.captureChip.classList.remove("on");
  state.target = null;
  renderTarget();
  hideConfirm();
  setStatus("共有待ち");
  setWatch("画面共有を開始すると、変化を見守ります。", "");
  addLog(`🌐 切断しました${reason ? `（${reason}）` : ""}`);
  renderWebDialog();
}

// つないだタブで利用者が操作し、ページが落ち着いたら知らせが来る
function onWebEvent(event) {
  if (!web.tabId) return;
  if (event === "closed") { disconnectWeb("タブが閉じられました"); return; }
  if (event !== "changed") return;
  state.lastChangeAt = Date.now();
  state.changes++;
  el.statChanges.textContent = `変化 ${state.changes} 回`;
  if (lesson().coach) runCoach();
}

// ─── 読む・撮る・光らせる ─────────────────────────────
// ページの部品（番号札）とスクリーンショット。部品の番号は拡張機能が付けたもの（webId）で、そのまま光らせるのに使う
async function webObserve() {
  const info = await extCall("items");
  let shot = null;
  try {
    const { dataUrl } = await extCall("shot");
    shot = await loadCanvas(dataUrl);
  } catch (e) {
    throw new Error(`${e.message}。Web アプリのタブを前に出してください`);
  }
  web.lastShot = shot;
  const items = info.items.map((it) => ({
    ...it, webId: it.id, webGen: info.gen, parts: [{ t: it.text, x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 }],
  }));
  const app = `Web ページ「${info.title}」（${info.url}）${info.focused ? `。入力中の場所: ${info.focused}` : ""}`;
  return { items, shot, app };
}

function loadCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("スクリーンショットを読めませんでした"));
    img.src = dataUrl;
  });
}

// state.target をページの上のハイライトに反映する（renderTarget から呼ぶ）
function syncWebHighlight() {
  if (!web.tabId) return;
  const t = watching() && state.step < lesson().steps.length ? state.target : null;
  const key = t ? JSON.stringify([t.webId ?? null, t.webGen ?? null, t.webId ? null : t.box, t.name]) : "";
  if (key === web.highlighted) return;
  web.highlighted = key;
  if (!t) extCall("clear").catch(() => {});
  else if (t.webId) extCall("highlight", { gen: t.webGen, id: t.webId, label: t.name }).catch(() => {});
  else extCall("highlight", { box: t.box, label: t.name }).catch(() => {});
}

// ─── つなぐ画面 ─────────────────────────────────────
async function openWebDialog() {
  el.webResult.textContent = "";
  el.webDialog.showModal();
  await refreshWebTabs();
}

function renderWebDialog() {
  el.webMissing.hidden = web.ext;
  el.webReady.hidden = !web.ext;
  el.webConnect.hidden = !web.ext;
  el.webDisconnect.hidden = !web.tabId;
}

async function refreshWebTabs() {
  renderWebDialog();
  if (!web.ext) return;
  try {
    const { tabs } = await extCall("tabs");
    el.webTabs.replaceChildren(...tabs.map((t) => new Option(`${t.title} — ${t.url}`, t.id)));
    const colab = tabs.find((t) => /colab\.research\.google\.com/.test(t.url));
    if (colab) el.webTabs.value = colab.id;
    el.webResult.textContent = tabs.length ? "" : "つなげるタブがありません。Colab などを別のタブで開いてから「更新」を押してください。";
  } catch (e) {
    el.webResult.textContent = e.message;
  }
}

el.webBtn.addEventListener("click", openWebDialog);
el.webRefresh.addEventListener("click", refreshWebTabs);
el.webClose.addEventListener("click", () => el.webDialog.close());
el.webDisconnect.addEventListener("click", () => disconnectWeb());
el.webStateDisconnect.addEventListener("click", () => disconnectWeb());
el.webConnect.addEventListener("click", async () => {
  const tabId = Number(el.webTabs.value);
  if (!tabId) return;
  // ミニ窓はボタンを押した直後にしか開けないので、つなぐ前に開く
  if (canPip && !state.pip) openPip().catch(() => el.pipBtn.classList.add("attention"));
  el.webResult.textContent = "つないでいます…";
  try {
    await connectWeb(tabId);
    el.webDialog.close();
  } catch (e) {
    el.webResult.textContent = `つなげませんでした: ${e.message}`;
  }
});
