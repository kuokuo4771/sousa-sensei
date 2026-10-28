// そうさ先生 Web 連携: 本体のページ（index.html）の中で動く取り次ぎ役
// ページとは window.postMessage で、拡張機能とは chrome.runtime でやりとりする
//   ページ → 拡張機能: { source: "sensei-hub", id, type, ... }
//   拡張機能 → ページ: { source: "sensei-ext", type: "hello" | "reply" | "event", ... }
// 拡張機能はほかのタブの一覧やスクリーンショットを扱えるので、そうさ先生の本体のページ
// （<html data-slide-sensei-hub> の印があるページ）からの頼みごとだけを取り次ぐ。
// 同じ名前（index.html など）のほかのページでは何もしない

const VERSION = chrome.runtime.getManifest().version;
const isHub = () => !!document.documentElement?.hasAttribute("data-slide-sensei-hub");

function toPage(data) {
  window.postMessage({ source: "sensei-ext", ...data }, location.origin === "null" ? "*" : location.origin);
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "sensei-hub" || !isHub()) return;
  const { id, source, ...msg } = e.data;
  if (msg.type === "ping") {
    toPage({ type: "hello", version: VERSION });
    return;
  }
  chrome.runtime.sendMessage({ ...msg, from: "hub" })
    .then((res) => toPage({ type: "reply", id, res }))
    .catch((err) => toPage({ type: "reply", id, res: { error: err.message } }));
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "event" && isHub()) toPage({ type: "event", event: msg.event });
});

// ページの読み込みが終わったら、拡張機能が入っていることを知らせる
document.addEventListener("DOMContentLoaded", () => { if (isHub()) toPage({ type: "hello", version: VERSION }); });
