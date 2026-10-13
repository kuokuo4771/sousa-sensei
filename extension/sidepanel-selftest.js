// サイドパネル（sidepanel.html）の自動テスト。tools/bundle-sidepanel.sh でまとめた dist/sidepanel-test.html で動かす。
// Chrome の API（タブ・読み取り係・スクリーンショット）と AI は偽物に差し替える。
// このファイルは sidepanel.js より先に読み込む（sidepanel.js が起動時に chrome.* を使うため）
"use strict";

const SidepanelTest = (() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(cond, ms = 3000) {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) return false;
      await wait(20);
    }
    return true;
  }

  // ─── 偽の Colab のタブ ──────────────────────────────
  const ITEMS = [
    { id: 1, text: "ファイル", x0: 0.02, y0: 0.05, x1: 0.07, y1: 0.08 },
    { id: 2, text: "ランタイム", x0: 0.20, y0: 0.05, x1: 0.27, y1: 0.08 },
    { id: 3, text: "セルを実行", x0: 0.05, y0: 0.30, x1: 0.08, y1: 0.34 },
    { id: 4, text: "コード", x0: 0.02, y0: 0.12, x1: 0.06, y1: 0.15 },
  ];
  const page = { url: "https://colab.research.google.com/drive/abc", title: "練習.ipynb - Colab", items: ITEMS, agent: true };
  const sent = [];       // 読み取り係に送った頼みごと
  let injected = 0;
  const listeners = { message: [], activated: [], updated: [] };

  function shot() {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 500;
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, 800, 500);
    x.fillStyle = "#222"; x.font = "16px sans-serif";
    for (const it of page.items) x.fillText(it.text, it.x0 * 800, it.y1 * 500);
    return c.toDataURL("image/jpeg");
  }

  window.chrome = {
    tabs: {
      async query() { return [{ id: 7, windowId: 1, url: page.url, title: page.title, active: true }]; },
      async sendMessage(tabId, msg) {
        if (!page.agent) throw new Error("Could not establish connection. Receiving end does not exist.");
        sent.push(msg);
        if (msg.type === "items") return { items: page.items, title: page.title, url: page.url, focused: "" };
        return { ok: true };
      },
      async captureVisibleTab() { return shot(); },
      onActivated: { addListener: (f) => listeners.activated.push(f) },
      onUpdated: { addListener: (f) => listeners.updated.push(f) },
    },
    scripting: {
      async executeScript() {
        if (/^chrome:/.test(page.url)) throw new Error("Cannot access a chrome:// URL");
        injected++;
        page.agent = true;
      },
    },
    runtime: { onMessage: { addListener: (f) => listeners.message.push(f) } },
  };

  // ─── 偽の AI ─────────────────────────────────────
  // 呼ばれるたびに answers の先頭を返す。受け取った内容は calls に残す
  const answers = [];
  const calls = [];
  function fakeAi() {
    AI.enabled = () => true;
    AI.coach = async (c) => {
      calls.push(c);
      const a = answers.shift();
      if (!a) throw new Error("偽の AI の答えが足りません");
      return { currentDone: null, status: "next", say: "", targetId: null, targetText: "", box: null, reason: "", ...a };
    };
  }

  const $ = (id) => document.getElementById(id);
  const visible = (id) => !$(id).hidden;
  const highlights = () => sent.filter((m) => m.type === "highlight");
  function changed() {
    for (const f of listeners.message) f({ from: "web", event: "changed" }, { tab: { id: 7 } });
  }
  async function start(goal) {
    $("goalInput").value = goal;
    $("goalForm").requestSubmit();
  }
  function reset() {
    sent.length = answers.length = calls.length = 0;
    injected = 0;
    Object.assign(page, { url: "https://colab.research.google.com/drive/abc", title: "練習.ipynb - Colab", items: ITEMS, agent: true });
    Object.assign(run, { goal: "", done: [], current: null, before: null, finished: false, busy: false, again: false });
    $("confirmBox").hidden = $("aiBox").hidden = true;
  }

  const tests = [
    ["開始すると最初の一手が出て、ページの上で光る", async () => {
      answers.push({ say: "「セルを実行」ボタンを押してください", targetId: 3, targetText: "セルを実行" });
      await start("セルを実行したい");
      if (!(await until(() => run.current))) return "最初の一手が出ませんでした";
      if (!$("stepText").textContent.includes("セルを実行")) return `表示が違います: ${$("stepText").textContent}`;
      if (!(await until(() => highlights().length))) return "ハイライトを頼んでいません";
      if (highlights()[0].id !== 3) return `違う場所を光らせました: ${JSON.stringify(highlights()[0])}`;
      if (calls[0].before !== null) return "最初の一手なのに「前の画面」を送っています";
      if (!calls[0].app.includes("Colab")) return `ページ名を AI に伝えていません: ${calls[0].app}`;
      if (!(calls[0].image instanceof HTMLCanvasElement) || calls[0].items.length !== 4) return "画面か番号札を AI に渡していません";
    }],
    ["ページが変わると AI が前後を比べ、できていれば次の一手へ", async () => {
      answers.push({ say: "「セルを実行」ボタンを押してください", targetId: 3, targetText: "セルを実行" });
      await start("セルを実行したい");
      await until(() => run.current);
      page.items = [...ITEMS, { id: 5, text: "Hello", x0: 0.1, y0: 0.4, x1: 0.2, y1: 0.43 }];
      answers.push({ currentDone: true, status: "done", say: "完了です" });
      changed();
      if (!(await until(() => run.finished))) return "完了になりませんでした";
      if (!calls[1].before) return "前の画面を AI に渡していません";
      if (!calls[1].appeared.includes("Hello")) return `新しく現れた文字を渡していません: ${calls[1].appeared}`;
      if (!visible("doneCard") || visible("stepCard")) return "完了の表示になっていません";
      if (!sent.some((m) => m.type === "clear")) return "完了したのにハイライトを消していません";
    }],
    ["AI が「まだ」のときは「できた？」を出し、「できた ✓」で次へ進める", async () => {
      answers.push({ say: "「ランタイム」メニューを開いてください", targetId: 2, targetText: "ランタイム" });
      await start("ランタイムを変えたい");
      await until(() => run.current);
      answers.push({ currentDone: false, say: "上の「ランタイム」を押してください", targetId: 2, targetText: "ランタイム" });
      changed();
      if (!(await until(() => visible("confirmBox")))) return "「できた？」が出ませんでした";
      if (run.done.length) return "「まだ」なのに手順を終わりにしました";
      answers.push({ say: "「ランタイムのタイプを変更」を押してください", targetId: 0 });
      $("yesBtn").click();
      if (!(await until(() => run.done.length === 1 && run.current?.includes("タイプ")))) return "「できた ✓」で次へ進みませんでした";
      if (visible("confirmBox")) return "「できた？」が残っています";
      if ($("stepNum").textContent !== "STEP 2") return `手順の番号が違います: ${$("stepNum").textContent}`;
    }],
    ["番号を読み違えても、文字が合う札を光らせる", async () => {
      answers.push({ say: "「コード」を押してください", targetId: 1, targetText: "コード" });
      await start("コードのセルを足したい");
      if (!(await until(() => highlights().length))) return "ハイライトを頼んでいません";
      if (highlights()[0].id !== 4) return `番号のほうを信じてしまいました: ${JSON.stringify(highlights()[0])}`;
    }],
    ["番号札のない場所は、AI の推定した範囲を光らせる", async () => {
      answers.push({ say: "左のフォルダのアイコンを押してください", targetId: null, box: { x0: 0, y0: 0.3, x1: 0.03, y1: 0.35 } });
      await start("ファイルを見たい");
      if (!(await until(() => highlights().length))) return "ハイライトを頼んでいません";
      const h = highlights()[0];
      if (h.id != null || !h.box || h.box.y0 !== 0.3) return `範囲で光らせていません: ${JSON.stringify(h)}`;
    }],
    ["読み取り係がいなくなっていたら（再読み込み後など）入れ直す", async () => {
      answers.push({ say: "「セルを実行」ボタンを押してください", targetId: 3, targetText: "セルを実行" });
      await start("セルを実行したい");
      await until(() => run.current);
      const before = injected;
      page.agent = false;
      answers.push({ currentDone: true, say: "次は「コード」を押してください", targetId: 4, targetText: "コード" });
      changed();
      if (!(await until(() => run.done.length === 1))) return "入れ直したあと続けられませんでした";
      if (injected <= before) return "読み取り係を入れ直していません";
    }],
    ["案内できないページ（chrome:// など）では、そう伝えて AI を呼ばない", async () => {
      page.url = "chrome://extensions/";
      answers.push({ say: "呼ばれてはいけない" });
      await start("拡張機能を見たい");
      await wait(200);
      if (!visible("notice")) return "お知らせが出ていません";
      if (calls.length) return "AI を呼んでしまいました";
    }],
    ["AI が OFF なら、設定を促す", async () => {
      const on = AI.enabled;
      AI.enabled = () => false;
      try {
        await start("セルを実行したい");
        await wait(100);
        if (!visible("aiBox") || !$("aiText").textContent.includes("OFF")) return "設定を促していません";
        if (calls.length) return "AI を呼んでしまいました";
      } finally {
        AI.enabled = on;
      }
    }],
  ];

  async function runAll() {
    fakeAi();
    $("voiceOn").checked = false;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:auto 8px 8px 8px;max-height:60vh;overflow:auto;background:#fff;color:#222;border:2px solid #2e6ba0;border-radius:8px;padding:8px;font-size:12px;z-index:9";
    box.innerHTML = "<strong>🧪 サイドパネルのテスト</strong><ol style='margin:6px 0 0;padding-left:18px'></ol><p style='margin:6px 0 0'></p>";
    document.body.append(box);
    const results = [];
    for (const [name, fn] of tests) {
      const li = document.createElement("li");
      box.querySelector("ol").append(li);
      let error;
      try {
        reset();
        error = await fn();
      } catch (e) {
        error = `エラー: ${e.message}`;
      }
      await until(() => !run.busy);
      li.textContent = `${error ? "❌" : "✅"} ${name}${error ? ` — ${error}` : ""}`;
      results.push({ name, ok: !error, error });
    }
    const failed = results.filter((r) => !r.ok).length;
    box.querySelector("p").textContent = failed ? `${failed} 件失敗 / ${results.length} 件` : `すべて成功（${results.length} 件）`;
    window.selfTestResults = results;
    return results;
  }

  addEventListener("load", () => setTimeout(runAll, 300));
  return { runAll };
})();
