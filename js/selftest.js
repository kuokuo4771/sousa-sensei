// スライド先生の自動テスト。index.html?test で開くと読み込まれ、すべて実行して右下に結果を出す。
// 画面共有・AI・読み上げ・タイマーは偽物に差し替え、PowerPoint 風の画面を描いて確かめる。
// 文字認識（tesseract.js）だけは本物を使うので、初回はネット接続が必要。
// テストのあとは AI の設定（APIキーを含む）を元に戻す
"use strict";

const SelfTest = (() => {
  const W = 1920, H = 1200;
  const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── PowerPoint 風の画面を描く ────────────────────
  // o: { ribbon: "home" | "insert", title: "placeholder" | "caret" | "typed", subtitle: "placeholder" | "typed",
  //      newSlide, table, cursor: [x, y], caret }
  function pptScreen(o = {}) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#f3f3f3"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#b7472a"; x.fillRect(0, 0, W, 40);
    x.fillStyle = "#fff"; x.fillRect(0, 40, W, 130);
    x.fillStyle = "#222"; x.font = `15px ${FONT}`;
    ["ホーム", "挿入", "描画", "デザイン", "画面切り替え"].forEach((t, i) => x.fillText(t, 20 + i * 120, 65));
    const ribbon = o.ribbon === "insert"
      ? ["新しいスライド", "表", "画像", "図形", "SmartArt"]
      : ["貼り付け", "新しいスライド", "レイアウト", "リセット", "図形"];
    ribbon.forEach((t, i) => x.fillText(t, 20 + i * 140, 150));
    x.fillStyle = "#ddd"; x.fillRect(20, 200, 260, 150);
    if (o.newSlide) x.fillRect(20, 370, 260, 150);
    x.fillStyle = "#fff"; x.fillRect(330, 250, 1260, 710);
    x.setLineDash([6, 6]); x.strokeStyle = "#aaa";
    if (o.newSlide) {
      x.strokeRect(400, 300, 1120, 140); x.strokeRect(400, 470, 1120, 440);
      x.fillStyle = "#888"; x.font = `52px ${FONT}`; x.fillText("タイトルを入力", 780, 390);
      x.font = `30px ${FONT}`; x.fillText("・テキストを入力", 440, 530);
    } else {
      x.strokeRect(400, 400, 1120, 200); x.strokeRect(400, 620, 1120, 120);
      x.setLineDash([]);
      const title = o.title ?? "placeholder";
      if (title === "placeholder") { x.fillStyle = "#888"; x.font = `58px ${FONT}`; x.fillText("タイトルを入力", 750, 520); }
      if (title === "caret") { x.fillStyle = "#000"; x.fillRect(960, 470, 3, 70); }
      if (title === "typed") { x.fillStyle = "#000"; x.font = `58px ${FONT}`; x.fillText("新しい企画のご提案", 700, 520); }
      if (o.subtitle === "typed") { x.fillStyle = "#333"; x.font = `28px ${FONT}`; x.fillText("来期の売上を伸ばす三つの施策", 760, 690); }
      else { x.fillStyle = "#888"; x.font = `28px ${FONT}`; x.fillText("サブタイトルを入力", 840, 690); }
    }
    if (o.table) {
      x.setLineDash([]); x.strokeStyle = "#333"; x.lineWidth = 3;
      for (let i = 0; i <= 3; i++) {
        x.beginPath(); x.moveTo(500, 400 + i * 80); x.lineTo(1400, 400 + i * 80); x.stroke();
        x.beginPath(); x.moveTo(500 + i * 300, 400); x.lineTo(500 + i * 300, 640); x.stroke();
      }
    }
    if (o.caret) { x.fillStyle = "#000"; x.fillRect(960, 470, 3, 60); }
    if (o.cursor) {
      const [cx, cy] = o.cursor;
      x.fillStyle = "#000"; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy + 32);
      x.lineTo(cx + 9, cy + 24); x.lineTo(cx + 21, cy + 24); x.closePath(); x.fill();
    }
    return c;
  }

  // Photoshop 風の暗い画面
  function darkScreen() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#2b2b2b"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#ddd"; x.font = `15px ${FONT}`;
    ["ファイル", "編集", "イメージ", "レイヤー", "書式", "選択範囲", "フィルター", "表示"].forEach((t, i) => x.fillText(t, 20 + i * 110, 30));
    x.fillStyle = "#383838"; x.fillRect(1500, 60, 420, 1140);
    x.fillStyle = "#ccc"; ["レイヤー", "チャンネル", "パス"].forEach((t, i) => x.fillText(t, 1520 + i * 110, 90));
    x.fillStyle = "#3a76d8"; x.fillRect(700, 600, 200, 44);
    x.fillStyle = "#fff"; x.font = `18px ${FONT}`; x.fillText("新規作成", 760, 628);
    return c;
  }

  // ボタンが密集したリボン（隣のボタン名がくっつきやすい）
  const DENSE_TABS = ["ファイル", "ホーム", "挿入", "描画", "デザイン", "画面切り替え", "アニメーション", "スライドショー", "校閲", "表示"];
  const DENSE_LABELS = ["貼り付け", "切り取り", "コピー", "新しいスライド", "レイアウト", "リセット", "セクション", "太字", "斜体", "下線", "図形", "配置", "テキストボックス"];
  function denseScreen() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#f3f3f3"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#fff"; x.fillRect(0, 40, W, 150);
    x.fillStyle = "#222"; x.font = `15px ${FONT}`;
    DENSE_TABS.forEach((t, i) => x.fillText(t, 20 + i * 105, 65));
    DENSE_LABELS.forEach((t, i) => x.fillText(t, 20 + i * 82, 120));
    return c;
  }
  function denseTruth(label) {
    const m = document.createElement("canvas").getContext("2d");
    m.font = `15px ${FONT}`;
    const i = DENSE_LABELS.indexOf(label);
    const x0 = i >= 0 ? 20 + i * 82 : 20 + DENSE_TABS.indexOf(label) * 105;
    return [x0 / W, (x0 + m.measureText(label).width) / W];
  }

  // ─── 偽物（画面共有・AI・読み上げ・タイマー） ─────────
  const fake = { screen: () => pptScreen(), ai: null, aiCalls: [], fetchCalls: [] };
  const real = {};

  function installFakes() {
    real.grabRawFrame = window.grabRawFrame;
    real.schedule = window.schedule;
    real.speak = speechSynthesis.speak;
    real.LanguageModel = window.LanguageModel;
    real.fetch = window.fetch;
    real.ai = JSON.stringify(AI.settings);
    real.ocrOn = ocr.on;
    window.grabRawFrame = async () => {
      const c = fake.screen();
      return { source: c, width: c.width, height: c.height, close() {} };
    };
    window.schedule = () => {};                       // タイマーではなくテストから sample() を呼ぶ
    speechSynthesis.speak = () => {};
    window.LanguageModel = {
      availability: async () => "available",
      create: async () => ({
        clone: async () => ({
          destroy() {},
          prompt: async (input) => {
            const parts = input[0].content;
            const text = parts[0].value;
            const call = { text, images: parts.filter((p) => p.type === "image").length };
            fake.aiCalls.push(call);
            return JSON.stringify(fake.ai(text, call));
          },
        }),
      }),
    };
  }

  function restoreFakes() {
    window.grabRawFrame = real.grabRawFrame;
    window.schedule = real.schedule;
    speechSynthesis.speak = real.speak;
    window.LanguageModel = real.LanguageModel;
    window.fetch = real.fetch;
    AI.save(JSON.parse(real.ai));
    AI.resetForTest();
    ocr.on = real.ocrOn;
  }

  // 偽の画面共有（中身は fake.screen に関係なく白い画面。判定は grabRawFrame の方を使う）
  function fakeStream() {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const x = c.getContext("2d");
    const id = setInterval(() => { x.fillStyle = "#fff"; x.fillRect(0, 0, 320, 200); }, 200);
    const stream = c.captureStream(5);
    stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(id));
    return stream;
  }

  // 1つ前のテストの影響を消す
  async function reset() {
    if (state.stream) stopCapture();
    if (web.tabId) await disconnectWeb();
    await ocr.queue;
    AI.save({ provider: "off" });
    AI.resetForTest();
    ocr.on = true;
    coach.busy = false; coach.again = false;
    if (coach.retry) { clearTimeout(coach.retry); coach.retry = null; }
    state.pip = null;
    state.surface = "window";
    fake.screen = () => pptScreen();
    fake.aiCalls = [];
    hideConfirm();
    el.aiBox.hidden = true;
    loadLesson("first-slide");
  }

  async function share() {
    await startCapture(fakeStream());
    await ensureOcr();
    await settle();
  }

  // 文字認識と AI の処理が落ち着くまで待つ
  async function settle() {
    for (let i = 0; i < 100 && (coach.busy || coach.retry); i++) await wait(100);
    for (let i = 0; i < 4; i++) { await wait(50); await ocr.queue; }
  }

  // 画面を変えて、変化検知が「落ち着いた」と判断するまで sample() を回す
  async function show(painter, ticks = 3) {
    fake.screen = painter;
    for (let i = 0; i < ticks; i++) {
      AI.resetForTest();   // テストでは AI の呼び出し間隔の制限を待たない
      await sample();
      await settle();
    }
  }

  function gray(canvas) {
    return toGray({ source: canvas });
  }

  const idOf = (text, label) => {
    const m = text.match(new RegExp(`\\[(\\d+)\\] [^\\n]*${label}[^\\n]* \\(`));
    return m ? Number(m[1]) : 0;
  };

  // ─── テスト ───────────────────────────────────────
  const tests = [
    ["変化検知: カーソル移動と文字カーソルの点滅は無視する", async () => {
      const base = gray(pptScreen({ cursor: [600, 700] }));
      for (const [cursor, caret] of [[[900, 500], true], [[1200, 300], false], [[400, 800], true]]) {
        const d = diffRatio(gray(pptScreen({ cursor, caret })), base);
        if (d >= THRESHOLD) return `カーソルだけで ${d.toFixed(2)}% の変化と判定された`;
      }
    }],
    ["変化検知: リボンのタブ切り替えを検知する", async () => {
      const d = diffRatio(gray(pptScreen({ ribbon: "insert" })), gray(pptScreen({ ribbon: "home" })));
      if (d < THRESHOLD) return `タブ切り替えが ${d.toFixed(2)}%（閾値 ${THRESHOLD}% 未満）`;
    }],
    ["変化検知: プレースホルダーのクリックと文字入力を検知する", async () => {
      const a = diffRatio(gray(pptScreen({ title: "caret" })), gray(pptScreen()));
      const b = diffRatio(gray(pptScreen({ title: "typed" })), gray(pptScreen({ title: "caret" })));
      if (a < THRESHOLD) return `クリックが ${a.toFixed(2)}%`;
      if (b < THRESHOLD) return `入力が ${b.toFixed(2)}%`;
    }],
    ["文字認識: 明るい画面（リボン・灰色の文字・太字）を読める", async () => {
      state.stream = {};
      fake.screen = () => pptScreen({ title: "typed" });
      const r = await readScreen();
      state.stream = null;
      // ボタン名とプレースホルダーは、完了条件やハイライトに使うので正確に読めること
      for (const want of ["ホーム", "挿入", "新しいスライド", "サブタイトルを入力"]) {
        if (!r?.text.includes(want)) return `「${want}」を読めなかった（読めた文字: ${r?.text.slice(0, 60)}…）`;
      }
      // 入力した文章は「新しく現れた文字の並び」の数で判定するので、1〜2文字の読み落としは許す
      const typed = [..."新しい企画のご提案"].filter((ch) => r.text.includes(ch)).length;
      if (typed < 7) return `入力した文章を ${typed}/9 文字しか読めなかった`;
    }],
    ["文字認識: 暗い画面（メニュー・青いボタン）を読める", async () => {
      state.stream = {};
      fake.screen = darkScreen;
      const r = await readScreen();
      state.stream = null;
      for (const want of ["ファイル", "フィルター", "チャンネル", "新規作成"]) {
        if (!r?.text.includes(want)) return `「${want}」を読めなかった（読めた文字: ${r?.text.slice(0, 60)}…）`;
      }
    }],
    ["ハイライト: くっついたボタン名から、AI が答えた文字の部分だけを光らせる", async () => {
      state.stream = {};
      fake.screen = denseScreen;
      const items = buildItems(await readScreen());
      state.stream = null;
      for (const want of ["新しいスライド", "リセット", "アニメーション", "セクション", "挿入", "テキストボックス"]) {
        const it = items.find((i) => norm(i.text).includes(norm(want)));
        if (!it) return `「${want}」の番号札がない`;
        const b = boxForText(it, want, items);
        const [t0, t1] = denseTruth(want);
        if (Math.abs(b.x0 - t0) > 0.012 || Math.abs(b.x1 - t1) > 0.012) {
          return `「${want}」が x=${b.x0.toFixed(3)}〜${b.x1.toFixed(3)}（本当は ${t0.toFixed(3)}〜${t1.toFixed(3)}）`;
        }
      }
    }],
    ["AI: 表示名で入力したモデル名をモデルコードに直す", async () => {
      const cases = { "Gemini 3.5 Flash Lite": "gemini-3.5-flash-lite", " models/gemini-3.8-flash ": "gemini-3.8-flash", "": AI.DEFAULT_GEMINI_MODEL };
      for (const [input, want] of Object.entries(cases)) {
        if (AI.normalizeModel(input) !== want) return `「${input}」→「${AI.normalizeModel(input)}」`;
      }
    }],
    ["AI: Gemini に正しい形で送り、```json で囲まれた答えも読める", async () => {
      let req = null;
      window.fetch = async (url, opts) => {
        req = { url, opts };
        const answer = '```json\n{"current_done":"yes","status":"next","say":"[1]の「挿入」タブを押してください","target_id":1,"target_text":"挿入","reason":"r"}\n```';
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
      };
      AI.save({ provider: "gemini", geminiKey: "TEST-KEY", geminiModel: "Gemini 3.8 Flash" });
      const img = document.createElement("canvas");
      const r = await AI.coach({ image: img, before: img, appeared: [], disappeared: [], app: "", goal: "g", done: [], current: "c",
        items: [{ id: 1, text: "挿入", x0: 0, y0: 0, x1: 0.1, y1: 0.1 }] });
      window.fetch = real.fetch;
      const body = JSON.parse(req.opts.body);
      if (!req.url.endsWith("/models/gemini-3.8-flash:generateContent")) return `送り先が ${req.url}`;
      if (req.opts.headers["x-goog-api-key"] !== "TEST-KEY" || req.url.includes("TEST-KEY")) return "APIキーをヘッダーで送っていない";
      if (body.contents[0].parts.filter((p) => p.inlineData).length !== 2) return "前後2枚の画像を送っていない";
      if (r.currentDone !== true || r.targetId !== 1 || r.targetText !== "挿入") return `答えの読み取りが違う: ${JSON.stringify(r)}`;
      if (r.say !== "「挿入」タブを押してください") return `案内に番号札の番号が残っています: ${r.say}`;
    }],
    ["レッスン「はじめてのスライド」: 文字で確かめて自動で進み、場所を光らせる", async () => {
      await share();
      const expect = [
        [{}, 1, "タイトルを入力"],                                            // 開いた時点で手順1は完了
        [{ title: "caret" }, 2, "タイトルを入力"],                            // 同じ枠を光らせ続ける
        [{ title: "typed" }, 3, "サブタイトルを入力"],
        [{ title: "typed", subtitle: "typed" }, 4, "新しいスライド"],
        [{ newSlide: true }, 5, null],
      ];
      await show(() => pptScreen());
      for (const [scene, done, target] of expect) {
        await show(() => pptScreen(scene));
        if (state.step !== done) return `場面${done}: ステップ ${state.step + 1} のまま（期待: ${done + 1}）`;
        if (target && state.target?.name !== target) return `場面${done}: 光っているのが「${state.target?.name ?? "なし"}」（期待:「${target}」）`;
      }
    }],
    ["おまかせ: 番号の読み違いを文字で直し、前後2枚で判断して完了まで進む", async () => {
      AI.save({ provider: "builtin" });
      fake.ai = (text) => {
        const cur = (text.match(/いま案内中の手順: (.*)/) || [])[1];
        const sc = fake.scene;
        // 番号は「隣（+1）」を答えるが、文字は正しく答える AI
        if (cur.startsWith("（なし")) return { current_done: "none", status: "next", say: "「挿入」タブをクリック", target_id: idOf(text, "挿入") + 1, target_text: "挿入", reason: "" };
        if (cur.includes("挿入")) return { current_done: sc === "home" ? "no" : "yes", status: "next", say: "「表」をクリック", target_id: idOf(text, "表") + 1, target_text: "表", reason: "" };
        return { current_done: sc === "table" ? "yes" : "no", status: sc === "table" ? "done" : "next", say: "完了", target_id: 0, target_text: "", reason: "" };
      };
      fake.scene = "home";
      await share();
      await show(() => pptScreen());
      startCoach("スライドに表を入れたい");
      await settle();
      if (state.target?.name !== "挿入") return `最初に光ったのが「${state.target?.name ?? "なし"}」`;
      fake.scene = "insert";
      await show(() => pptScreen({ ribbon: "insert" }));
      if (state.target?.name !== "表") return `挿入タブのあと光ったのが「${state.target?.name ?? "なし"}」`;
      const second = fake.aiCalls[1];
      if (!second || second.images !== 2) return "2回目の問い合わせで前後2枚の画像を渡していない";
      if (!/新しく現れた文字: .*表/.test(second.text)) return "「新しく現れた文字」に「表」が入っていない";
      fake.scene = "table";
      await show(() => pptScreen({ ribbon: "insert", table: true }));
      if (!lesson().finished) return "表を入れても完了にならない";
    }],
    ["おまかせ: AI が「まだ」と言っても「できた ✓」で進める", async () => {
      AI.save({ provider: "builtin" });
      fake.ai = (text) => {
        const cur = (text.match(/いま案内中の手順: (.*)/) || [])[1];
        if (cur.startsWith("（なし")) return { current_done: "none", status: "next", say: fake.aiCalls.length > 2 ? "「表」をクリック" : "「挿入」タブをクリック", target_id: 0, target_text: "", reason: "" };
        return { current_done: "no", status: "next", say: "「挿入」タブをクリック", target_id: 0, target_text: "", reason: "厳しめ" };
      };
      await share();
      await show(() => pptScreen());
      startCoach("スライドに表を入れたい");
      await settle();
      await show(() => pptScreen({ ribbon: "insert" }));
      if (el.confirmBox.hidden) return "AI が「まだ」のときに「できた ✓」が出ていない";
      AI.resetForTest();
      el.yesBtn.click();
      await settle();
      if (coach.done.length !== 1 || state.step !== 1) return `「できた ✓」で進まなかった（完了 ${coach.done.length}・ステップ ${state.step + 1}）`;
    }],
    ["画面全体の共有: ミニ窓の場所を白く塗りつぶしてから読む", async () => {
      const sw = screen.width, sh = screen.height;
      const src = document.createElement("canvas");
      src.width = sw * 2;
      src.height = sh * 2;
      const x = src.getContext("2d");
      x.fillStyle = "#123456"; x.fillRect(0, 0, src.width, src.height);
      fake.screen = () => src;
      state.surface = "monitor";
      state.pip = { closed: false, screenX: 100, screenY: 100, outerWidth: 300, outerHeight: 400 };
      const f = await grabFrame();
      state.pip = null;
      state.surface = "window";
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      c.getContext("2d").drawImage(f.source, 0, 0);
      const px = (a, b) => Array.from(c.getContext("2d").getImageData(a, b, 1, 1).data.slice(0, 3)).join(",");
      const ox = screen.availLeft || 0, oy = (screen.availTop || 0) < 60 ? 0 : screen.availTop;
      const inside = px((250 - ox) * 2, (300 - oy) * 2);
      if (inside !== "255,255,255") return `ミニ窓の場所が塗られていない（${inside}）`;
      if (px(src.width - 2, src.height - 2) !== "18,52,86") return "ミニ窓以外まで塗られている";
    }],
    ["Web アプリ連携: 部品を読み、AI が選んだ部品をページの上に光らせ、操作の知らせで次へ進む", async () => {
      // 拡張機能の偽物: ページからの頼みごとに、拡張機能と同じ形で返事をする
      const sent = [];
      const shot = document.createElement("canvas");
      shot.width = 800;
      shot.height = 500;
      const pageItems = [
        { id: 1, text: "ファイル", role: "button", x0: 0.01, y0: 0.05, x1: 0.05, y1: 0.08 },
        { id: 2, text: "ランタイムに接続", role: "button", x0: 0.9, y0: 0.1, x1: 0.93, y1: 0.14 },
        { id: 3, text: "セルを実行", role: "button", x0: 0.03, y0: 0.3, x1: 0.06, y1: 0.35 },
      ];
      const fakeExt = (e) => {
        if (e.source !== window || e.data?.source !== "sensei-hub") return;
        const { id, type } = e.data;
        sent.push(e.data);
        if (type === "ping") { window.postMessage({ source: "sensei-ext", type: "hello", version: "test" }, "*"); return; }
        const res = { connect: { ok: true, title: "練習ノートブック", url: "file:///practice-colab.html" },
          items: { items: pageItems, title: "練習ノートブック", url: "file:///practice-colab.html", focused: "" },
          shot: { dataUrl: shot.toDataURL("image/jpeg") } }[type] ?? { ok: true };
        window.postMessage({ source: "sensei-ext", type: "reply", id, res }, "*");
      };
      window.addEventListener("message", fakeExt);
      try {
        window.postMessage({ source: "sensei-hub", type: "ping" }, "*");
        await wait(50);
        if (!web.ext) return "拡張機能が見つかったことにならない";
        AI.save({ provider: "builtin" });
        fake.ai = (text) => {
          const cur = (text.match(/いま案内中の手順: (.*)/) || [])[1];
          if (cur.startsWith("（なし")) return { current_done: "none", status: "next", say: "▶ を押してセルを実行してください", target_id: idOf(text, "セルを実行"), target_text: "セルを実行", reason: "" };
          return { current_done: "yes", status: "done", say: "実行できました", target_id: 0, target_text: "", reason: "" };
        };
        await connectWeb(42);
        if (el.webState.hidden) return "つないだことが画面に出ていない";
        startCoach("セルを実行したい");
        await settle();
        await wait(50);
        const hl = sent.filter((m) => m.type === "highlight").pop();
        if (!hl || hl.id !== 3) return `ページの上に光らせる指示が違う: ${JSON.stringify(hl)}`;
        AI.resetForTest();
        window.postMessage({ source: "sensei-ext", type: "event", event: "changed" }, "*");
        await wait(50);
        await settle();
        if (!lesson().finished) return "操作の知らせで完了まで進まない";
        if (fake.aiCalls[1]?.images !== 2) return "2回目の問い合わせで前後2枚を渡していない";
        await wait(50);
        if (sent[sent.length - 1]?.type !== "clear") return "完了したのにページの上のハイライトを消していない";
      } finally {
        await disconnectWeb();
        window.removeEventListener("message", fakeExt);
        web.ext = false;
      }
    }],
    ["しばらく画面が変わらないと、助け舟と「できた？」を出す", async () => {
      await share();
      state.lastChangeAt = Date.now() - 25000;
      state.stuckToken = -1;
      maybeHintStuck();
      if (el.aiBox.hidden || !el.aiText.textContent.includes("しばらく画面に変化がありません")) return "助け舟が出ていない";
      if (el.confirmBox.hidden) return "「できた？」が出ていない";
    }],
  ];

  // ─── 実行と結果の表示 ──────────────────────────────
  function panel() {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;width:min(460px,calc(100vw - 24px));max-height:70vh;overflow:auto;" +
      "background:var(--panel);color:var(--ink);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lift);padding:12px 14px;font-size:12.5px;";
    box.innerHTML = "<strong>🧪 自動テスト</strong><ol style='margin:8px 0 0;padding-left:20px;display:grid;gap:4px'></ol><p style='margin:8px 0 0'></p>";
    document.body.append(box);
    return { list: box.querySelector("ol"), summary: box.querySelector("p") };
  }

  async function run() {
    const ui = panel();
    const results = [];
    installFakes();
    try {
      for (const [name, fn] of tests) {
        const li = document.createElement("li");
        li.textContent = `⏳ ${name}`;
        ui.list.append(li);
        const started = performance.now();
        let error;
        try {
          await reset();
          error = await fn();
        } catch (e) {
          error = `エラー: ${e.message}`;
        }
        const sec = ((performance.now() - started) / 1000).toFixed(1);
        li.textContent = `${error ? "❌" : "✅"} ${name}（${sec}秒）${error ? ` — ${error}` : ""}`;
        results.push({ name, ok: !error, error });
      }
    } finally {
      await reset().catch(() => {});
      restoreFakes();
    }
    const failed = results.filter((r) => !r.ok).length;
    ui.summary.textContent = failed ? `${failed} 件失敗 / ${results.length} 件` : `すべて成功（${results.length} 件）`;
    window.selfTestResults = results;
    return results;
  }

  return { run };
})();

SelfTest.run();
