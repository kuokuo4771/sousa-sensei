// そうさ先生 Office 版の自動テスト。taskpane.html?test で開くと実行され、右下に結果を出す。
// Office（Excel・Word・PowerPoint）と AI は偽物に差し替える。テストのあとは AI の設定を元に戻す
"use strict";

(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const realAi = JSON.stringify(AI.settings);
  const realLM = window.LanguageModel;
  const aiCalls = [];
  let answer = () => ({});

  // 偽の AI（Chrome 内蔵AI の形）
  window.LanguageModel = {
    availability: async () => "available",
    create: async () => ({
      clone: async () => ({
        destroy() {},
        prompt: async (input) => {
          const text = input[0].content[0].value;
          aiCalls.push(text);
          return JSON.stringify(answer(text));
        },
      }),
    }),
  };
  const current = (text) => (text.match(/いま案内中の手順: (.*)/) || [])[1] ?? "";

  // Office の API の偽物を作るための小道具: load() と sync() は何もしない
  const obj = (props) => ({ load() {}, ...props });

  const tests = [
    ["Excel: 選択範囲・値・書式・罫線・表を読み、範囲を選択して見せる", async () => {
      const did = [];
      const sel = obj({
        address: "Sheet1!A1:C3", rowCount: 3, columnCount: 3,
        format: obj({
          horizontalAlignment: "General",
          font: obj({ bold: true, italic: false, size: 11, color: "#000000" }),
          fill: obj({ color: "#FFFFFF" }),
          borders: obj({ items: [{ sideIndex: "EdgeTop", style: "Continuous" }, { sideIndex: "EdgeLeft", style: "None" }] }),
        }),
        getCell: () => ({ getResizedRange: () => obj({ values: [["売上", "前年", "比"], [1, 2, 3], [4, 5, 6]] }) }),
      });
      const sheet = obj({
        name: "Sheet1",
        getUsedRangeOrNullObject: () => obj({ isNullObject: false, address: "Sheet1!A1:C3" }),
        tables: obj({ items: [{ name: "テーブル1" }] }),
        charts: obj({ items: [] }),
        getRange: (a) => ({ select: () => did.push(`select ${a}`) }),
        activate: () => did.push("activate"),
      });
      const ctx = {
        workbook: obj({
          worksheets: obj({ items: [{ name: "Sheet1" }, { name: "Sheet2" }], getActiveWorksheet: () => sheet, getItem: (n) => { did.push(`sheet ${n}`); return sheet; } }),
          getSelectedRange: () => sel,
        }),
        sync: async () => {},
      };
      window.Excel = { run: (cb) => cb(ctx) };
      const s = await ExcelHost.readState();
      for (const want of ["選択範囲: Sheet1!A1:C3（3行×3列）", "売上", "太字=true", "罫線=EdgeTop", "表（テーブル）: テーブル1", "グラフ: なし"]) {
        if (!s.includes(want)) return `状態の文章に「${want}」がない:\n${s}`;
      }
      if (!(await ExcelHost.show("Sheet2!$A$1:$B$2"))) return "範囲を見せられなかった";
      if (did.join(",") !== "sheet Sheet2,activate,select A1:B2") return `選択のしかたが違う: ${did.join(",")}`;
      if (await ExcelHost.show("売上の表")) return "範囲でない文字を範囲として扱った";
    }],
    ["Word: 選択中の文章・書式・段落を読み、文章を探して選択する", async () => {
      const did = [];
      const ctx = {
        document: {
          getSelection: () => obj({ text: "はじめに", styleBuiltIn: "Heading1", alignment: "Left",
            font: obj({ bold: true, italic: false, underline: "None", size: 16, color: "#000000", highlightColor: null }) }),
          body: {
            paragraphs: obj({ items: [{ text: "はじめに", styleBuiltIn: "Heading1" }, { text: "本文です", styleBuiltIn: "Normal" }] }),
            tables: obj({ items: [{ rowCount: 3 }] }),
            inlinePictures: obj({ items: [] }),
            search: (t) => obj({ items: t === "本文" ? [{ select: () => did.push(`select ${t}`) }] : [] }),
          },
        },
        sync: async () => {},
      };
      window.Word = { run: (cb) => cb(ctx) };
      const s = await WordHost.readState();
      for (const want of ["選択中の文章: 「はじめに」", "スタイル=Heading1", "2. [Normal] 本文です", "表: 1個（3行）"]) {
        if (!s.includes(want)) return `状態の文章に「${want}」がない:\n${s}`;
      }
      if (!(await WordHost.show("本文"))) return "文章を見せられなかった";
      if (await WordHost.show("ない文章")) return "ない文章を見せたことになった";
      if (did.join(",") !== "select 本文") return `選択のしかたが違う: ${did.join(",")}`;
    }],
    ["PowerPoint: スライドと図形（文字のない図形も）を読み、図形を選択する", async () => {
      const did = [];
      const shape = (id, name, type, text) => ({
        id, name, type,
        textFrame: { textRange: { text, load() { if (text === null) throw new Error("文字のない図形"); } } },
      });
      const slide = { id: "s2", layout: obj({ name: "タイトルとコンテンツ" }),
        shapes: obj({ items: [shape("1", "タイトル 1", "Placeholder", "売上報告"), shape("2", "図 3", "Image", null)] }) };
      let failNext = false;
      const ctx = {
        presentation: {
          slides: obj({ items: [{ id: "s1" }, slide] }),
          getSelectedSlides: () => obj({ items: [slide] }),
          getSelectedShapes: () => obj({ items: [{ name: "タイトル 1" }] }),
          setSelectedShapes: (ids) => did.push(`select ${ids.join(",")}`),
        },
        sync: async () => { if (failNext) { failNext = false; throw new Error("x"); } },
      };
      // 文字のない図形の文字を読むと、本物では sync で失敗する
      slide.shapes.items[1].textFrame.textRange.load = () => { failNext = true; };
      window.PowerPoint = { run: (cb) => cb(ctx) };
      const s = await PowerPointHost.readState();
      for (const want of ["スライド: 2枚。いま 2枚目（レイアウト: タイトルとコンテンツ）", "選択中の図形: タイトル 1", "- タイトル 1（Placeholder）: 「売上報告」", "- 図 3（Image）"]) {
        if (!s.includes(want)) return `状態の文章に「${want}」がない:\n${s}`;
      }
      if (!(await PowerPointHost.show("タイトル 1"))) return "図形を見せられなかった";
      if (did.join(",") !== "select 1") return `選択のしかたが違う: ${did.join(",")}`;
    }],
    ["案内の流れ: 場所を選択して見せ、文書が変わったら AI が確かめて完了まで進む", async () => {
      const host = { name: "Excel", targetKind: "セル範囲", state: "選択範囲: A1", shown: [],
        async readState() { return this.state; },
        async show(t) { this.shown.push(t); this.state = `選択範囲: ${t}`; return true; } };
      answer = (text) => {
        const cur = current(text);
        if (cur.startsWith("（なし") && !text.includes("罫線=あり")) return { current_done: "none", status: "next", say: "A1 から C3 を選んでください", path: [], doc_target: "A1:C3", reason: "" };
        if (cur.startsWith("A1")) return { current_done: "yes", status: "next", say: "罫線の ▼ から格子を選んでください", path: ["ホーム", "罫線", "格子"], doc_target: "", reason: "" };
        return { current_done: "yes", status: "done", say: "できました", path: [], doc_target: "", reason: "" };
      };
      startWith(host);
      startGoal("A1〜C3 に罫線を引きたい");
      await wait(300);
      if (host.shown[0] !== "A1:C3") return "AI が答えた範囲を選択して見せていない";
      await wait(POLL_MS * 2 + SETTLE_MS + 300);
      if (aiCalls.length !== 1) return `自分で選択を変えただけで AI を呼んだ（${aiCalls.length}回）`;
      AI.resetForTest();
      host.state = "選択範囲: A1:C3（利用者が選び直した）";
      await wait(POLL_MS * 2 + SETTLE_MS + 500);
      if (aiCalls.length !== 2) return `文書が変わっても AI を呼ばない（${aiCalls.length}回）`;
      if (!aiCalls[1].includes("を出したときの文書の状態")) return "2回目の問い合わせに「指示を出したときの状態」が入っていない";
      if (ui.pathRow.textContent !== "ホーム›罫線›格子") return `リボンの道順の表示が違う: ${ui.pathRow.textContent}`;
      AI.resetForTest();
      host.state = "選択範囲: A1:C3 罫線=あり";
      await wait(POLL_MS * 2 + SETTLE_MS + 500);
      if (!run.finished) return "罫線を引いても完了にならない";
    }],
    ["案内の流れ: AI が「まだ」と言っても「できた ✓」で進める", async () => {
      const host = { name: "Word", targetKind: "文章", state: "選択中の文章: なし",
        async readState() { return this.state; }, async show() { return true; } };
      answer = (text) => current(text).startsWith("（なし")
        ? { current_done: "none", status: "next", say: aiCalls.length > 2 ? "次の一手" : "見出しを選んでください", path: [], doc_target: "", reason: "" }
        : { current_done: "no", status: "next", say: "見出しを選んでください", path: [], doc_target: "", reason: "厳しめ" };
      startWith(host);
      startGoal("見出しを太字にしたい");
      await wait(300);
      AI.resetForTest();
      host.state = "選択中の文章: 「見出し」";
      await wait(POLL_MS * 2 + SETTLE_MS + 500);
      if (ui.confirmBox.hidden) return "AI が「まだ」のときに「できた ✓」が出ていない";
      AI.resetForTest();
      ui.yesBtn.click();
      await wait(300);
      if (run.done.length !== 1 || run.current !== "次の一手") return `「できた ✓」で進まなかった（完了 ${run.done.length}・いまの手順 ${run.current}）`;
    }],
  ];

  // ─── 実行と結果の表示 ──────────────────────────────
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:8px;bottom:8px;left:8px;z-index:9999;max-height:60vh;overflow:auto;background:var(--panel);" +
    "border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,.2)";
  box.innerHTML = "<strong>🧪 自動テスト（Office 版）</strong><ol style='margin:6px 0 0;padding-left:20px;display:grid;gap:4px'></ol><p style='margin:6px 0 0'></p>";
  document.body.append(box);
  const results = [];
  AI.save({ provider: "builtin" });
  for (const [name, fn] of tests) {
    const li = document.createElement("li");
    li.textContent = `⏳ ${name}`;
    box.querySelector("ol").append(li);
    aiCalls.length = 0;
    AI.resetForTest();
    clearTimeout(run.pollTimer);
    Object.assign(run, { goal: "", done: [], current: null, path: [], target: "", before: null, finished: false, busy: false, again: false, lastState: "" });
    let error;
    try {
      error = await fn();
    } catch (e) {
      error = `エラー: ${e.message}`;
    }
    li.textContent = `${error ? "❌" : "✅"} ${name}${error ? ` — ${error}` : ""}`;
    results.push({ name, ok: !error, error });
  }
  clearTimeout(run.pollTimer);
  window.LanguageModel = realLM;
  AI.save(JSON.parse(realAi));
  AI.resetForTest();
  const failed = results.filter((r) => !r.ok).length;
  box.querySelector("p").textContent = failed ? `${failed} 件失敗 / ${results.length} 件` : `すべて成功（${results.length} 件）`;
  window.officeTestResults = results;
})();
