// 読み取り係（web-agent.js）の自動テスト。tools/bundle-agent.sh で practice-colab.html とまとめた
// dist/agent-test.html で動かす。拡張機能とのやりとりは偽物に差し替える。
// このファイルは web-agent.js より先に読み込む（web-agent.js が起動時に chrome.runtime を使うため）
"use strict";

const AgentTest = (() => {
  const events = [];
  let listener = null;
  window.chrome = { runtime: {
    sendMessage: async (m) => { events.push(m); },
    onMessage: { addListener: (fn) => { listener = fn; } },
  } };
  const ask = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // テスト用の部品をページの右上に置く（練習ページの部品には触らない）
  function fixture(html) {
    const host = document.createElement("div");
    host.className = "agent-fixture";
    host.innerHTML = html;
    document.body.append(host);
    return host;
  }
  const overlayParts = () => {
    const box = [...document.querySelectorAll("div")].find((d) => d.classList.contains("sensei-box"));
    return { box, tag: box.nextElementSibling };
  };
  const find = (items, text) => items.find((it) => it.text === text);

  const tests = [
    ["練習ページの部品（ウェブ部品の中の「セルを実行」も）を集める", async () => {
      const { items } = await ask({ type: "items" });
      if (!items.some((i) => i.text.startsWith("セルを実行"))) return `「セルを実行」がありません: ${items.map((i) => i.text).join(" / ")}`;
      if (items.some((it) => it.x0 < 0 || it.x1 > 1.001 || it.y0 < 0 || it.y1 > 1.001)) return "画面の外にはみ出した位置があります";
    }],
    ["横にスクロールする枠の中の部品は、枠の見えている範囲で光らせる（右へ突き抜けない）", async () => {
      fixture(`<div style="position:fixed;left:20px;top:200px;width:300px;height:60px;overflow:auto">
        <button aria-label="横長のボタン" style="width:3000px;height:40px">横長</button></div>`);
      const { items } = await ask({ type: "items" });
      const it = find(items, "横長のボタン");
      if (!it) return "部品が見つかりません";
      if (it.x1 * innerWidth > 330) return `枠の外まで伸びています（右端 ${Math.round(it.x1 * innerWidth)}px）`;
      await ask({ type: "highlight", id: it.id, label: "横長のボタン" });
      await frame();
      const r = overlayParts().box.getBoundingClientRect();
      if (r.right > 340) return `ハイライトが枠の外まで伸びています（右端 ${Math.round(r.right)}px）`;
    }],
    ["コードの入力欄は、セルごとにエディター全体を光らせる（本物の Colab と同じ作り。2つ以上のセル）", async () => {
      // セル 8: クリック済み。Monaco が作られ、見えない入力部品（Editor content）の幅は 8 万 px を超える
      // セル 9: まだクリックしていない。コードを表示しているだけで、入力部品がない
      fixture(`<div style="position:fixed;left:40px;top:260px;width:520px;display:grid;gap:12px">
        <div class="cell code" aria-label="セル 8: コードセル: "><button aria-label="セルを実行">▶</button>
          <div class="editor flex lazy-editor" style="width:480px;height:48px;background:#f7f7f7"><div class="editor flex monaco"><div class="monaco-editor" style="width:480px;height:48px">
            <div class="overflow-guard" style="overflow:hidden;width:480px;height:48px">
              <textarea class="inputarea" role="textbox" aria-label="Editor content" style="position:absolute;left:6px;top:0;width:84297px;height:19px"></textarea>
              <div class="view-lines">print("こんにちは")</div>
            </div></div></div></div></div>
        <div class="cell code" aria-label="セル 9: コードセル: "><button aria-label="セルを実行">▶</button>
          <div class="editor flex lazy-editor" style="width:480px;height:48px;background:#f7f7f7"><pre tabindex="0">nums = [3, 1, 2]
print(sorted(nums))</pre></div></div>
      </div>`);
      const { items } = await ask({ type: "items" });
      const names = items.map((i) => i.text);
      if (names.some((t) => /editor content/i.test(t))) return "「Editor content」のまま残っています";
      const e1 = find(items, "コードの入力欄（セル 8: print(\"こんにちは\")）");
      const e2 = find(items, "コードの入力欄（セル 9: nums = [3, 1, 2]）");
      if (!e1 || !e2) return `セルごとの入力欄がありません: ${names.join(" / ")}`;
      if (items.filter((i) => i.text.startsWith("コードの入力欄（セル 8")).length !== 1) return "セル 8 の入力欄が重複しています";
      if (!find(items, "セルを実行（セル 8）") || !find(items, "セルを実行（セル 9）")) return `実行ボタンにセルの番号がありません: ${names.join(" / ")}`;
      for (const it of [e1, e2]) {
        const w = (it.x1 - it.x0) * innerWidth;
        if (Math.abs(w - 480) > 2) return `「${it.text}」がエディター全体の幅になっていません（${Math.round(w)}px）`;
      }
      await ask({ type: "highlight", id: e2.id, label: "コードの入力欄" });
      await frame();
      const r = overlayParts().box.getBoundingClientRect();
      const want = e2.y0 * innerHeight;
      if (r.right > innerWidth || r.width > 500 || Math.abs(r.top + 4 - want) > 3) return `ハイライトの範囲が違います（${Math.round(r.left)},${Math.round(r.top)} 幅 ${Math.round(r.width)}px）`;
    }],
    ["画面の大半を覆う名前付きの入れ物は、押す場所として数えない", async () => {
      fixture(`<div aria-label="ノートブック全体" style="position:fixed;inset:0;pointer-events:none"></div>`);
      const { items } = await ask({ type: "items" });
      if (find(items, "ノートブック全体")) return "画面全体の入れ物を部品に数えています";
    }],
    ["右端の部品に長い名札を付けても、名札が画面の外へはみ出さない", async () => {
      fixture(`<button aria-label="右端" style="position:fixed;right:4px;top:120px;width:30px;height:30px">⋮</button>`);
      const { items } = await ask({ type: "items" });
      const it = find(items, "右端");
      await ask({ type: "highlight", id: it.id, label: "とても長い名札の文字がここに入ります。右へはみ出さないこと" });
      await frame();
      const { box, tag } = overlayParts();
      const b = box.getBoundingClientRect(), t = tag.getBoundingClientRect();
      if (b.right > innerWidth || t.right > innerWidth) return `はみ出しています（枠 ${Math.round(b.right)}・名札 ${Math.round(t.right)} / ${innerWidth}px）`;
    }],
    ["AI が推定した範囲（番号札なし）でも、画面の中に収めて光らせる", async () => {
      await ask({ type: "highlight", box: { x0: 0.9, y0: 0.5, x1: 1.2, y1: 0.6 }, label: "ここ" });
      await frame();
      const r = overlayParts().box.getBoundingClientRect();
      if (r.right > innerWidth || r.width < 10) return `範囲がおかしい（${Math.round(r.left)}〜${Math.round(r.right)}px）`;
    }],
    ["操作のあと、ページが落ち着いてから「変わった」と知らせる", async () => {
      events.length = 0;
      document.body.click();
      await wait(1000);
      if (!events.some((e) => e.from === "web" && e.event === "changed")) return "知らせが来ません";
    }],
  ];

  async function runAll() {
    const panel = document.createElement("div");
    panel.style.cssText = "position:fixed;left:8px;bottom:8px;width:min(560px,90vw);max-height:50vh;overflow:auto;background:#fff;color:#222;border:2px solid #2e6ba0;border-radius:8px;padding:8px;font-size:12px;z-index:5";
    panel.innerHTML = "<strong>🧪 読み取り係のテスト</strong><ol style='margin:6px 0 0;padding-left:18px'></ol><p style='margin:6px 0 0'></p>";
    document.body.append(panel);
    const results = [];
    for (const [name, fn] of tests) {
      let error;
      try {
        error = await fn();
      } catch (e) {
        error = `エラー: ${e.message}`;
      }
      document.querySelectorAll(".agent-fixture").forEach((f) => f.remove());
      await ask({ type: "clear" });
      const li = document.createElement("li");
      li.textContent = `${error ? "❌" : "✅"} ${name}${error ? ` — ${error}` : ""}`;
      panel.querySelector("ol").append(li);
      results.push({ name, ok: !error, error });
    }
    const failed = results.filter((r) => !r.ok).length;
    panel.querySelector("p").textContent = failed ? `${failed} 件失敗 / ${results.length} 件` : `すべて成功（${results.length} 件）`;
    window.selfTestResults = results;
  }

  addEventListener("load", () => setTimeout(runAll, 300));
  return { runAll };
})();
