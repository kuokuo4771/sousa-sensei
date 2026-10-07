// スライド先生 Web 連携: 取り次ぎ役（Service Worker）
// - 本体のタブ（hub）から頼まれたことを、つないだ Web アプリのタブ（target）へ取り次ぐ
// - target で起きた変化を hub へ知らせる
// Service Worker はしばらく使わないと止まるので、どのタブとつないでいるかは storage.session に覚えておく

const ids = {
  async get() {
    return chrome.storage.session.get({ hubTabId: null, targetTabId: null });
  },
  async set(v) {
    await chrome.storage.session.set(v);
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.from === "hub") {
    handleHub(msg, sender.tab.id).then(sendResponse, (e) => sendResponse({ error: e.message }));
    return true;   // 非同期で返事をする
  }
  if (msg.from === "web") {
    forwardEvent(sender.tab?.id, msg.event);
  }
  return false;
});

async function forwardEvent(tabId, event) {
  const { hubTabId, targetTabId } = await ids.get();
  if (tabId !== targetTabId || hubTabId == null) return;
  chrome.tabs.sendMessage(hubTabId, { type: "event", event }).catch(() => {});
}

async function handleHub(msg, hubTabId) {
  await ids.set({ hubTabId });
  const { targetTabId } = await ids.get();
  switch (msg.type) {
    case "tabs": {
      // つなげる候補: 本体以外の Web ページ（練習用のローカルのページも含む）のタブ
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs
          .filter((t) => t.id !== hubTabId && /^(https?|file):/.test(t.url ?? ""))
          .map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
      };
    }
    case "connect": {
      await ids.set({ targetTabId: msg.tabId });
      await inject(msg.tabId);
      const tab = await chrome.tabs.get(msg.tabId);
      return { ok: true, title: tab.title, url: tab.url };
    }
    case "disconnect": {
      if (targetTabId != null) chrome.tabs.sendMessage(targetTabId, { type: "clear" }).catch(() => {});
      await ids.set({ targetTabId: null });
      return { ok: true };
    }
    case "items":
    case "highlight":
    case "clear":
      if (targetTabId == null) throw new Error("Web アプリのタブにつながっていません");
      return chrome.tabs.sendMessage(targetTabId, msg);
    case "shot": {
      // 見えている部分のスクリーンショット。つないだタブがそのウインドウで前に出ているときだけ撮れる
      if (targetTabId == null) throw new Error("Web アプリのタブにつながっていません");
      const tab = await chrome.tabs.get(targetTabId);
      if (!tab.active) return { error: "つないだタブが前に出ていません" };
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
      return { dataUrl };
    }
    case "focus": {
      // つないだタブを前に出す
      if (targetTabId == null) return { ok: false };
      const tab = await chrome.tabs.update(targetTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true };
    }
    default:
      throw new Error(`知らない頼みごと: ${msg.type}`);
  }
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["web-agent.js"] });
}

// つないだタブが再読み込み・ページ移動したら、読み取り係を入れ直して hub に知らせる
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const { targetTabId } = await ids.get();
  if (tabId !== targetTabId) return;
  await inject(tabId).catch(() => {});
  forwardEvent(tabId, "changed");
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { hubTabId, targetTabId } = await ids.get();
  if (tabId === targetTabId) {
    await ids.set({ targetTabId: null });
    if (hubTabId != null) chrome.tabs.sendMessage(hubTabId, { type: "event", event: "closed" }).catch(() => {});
  }
});
