// スライド先生の AI 連携。無料で使える2つの方法に対応する。
//   builtin: Chrome 内蔵AI（Gemini Nano / Prompt API）。端末内で動き、画像は外に出ない。
//            Chrome 148 以降（日本語は 149 以降）。初回に約3〜4GBのモデルを取り込む。メモリ・空き容量の条件あり
//   gemini : Gemini API の無料枠。Google AI Studio の APIキーが必要。
//            無料枠では送った内容（画面の画像を含む）が Google の製品改善に使われる
// どちらも「答えは JSON で返させ、こちらで中身を確かめてから使う」。AI の答えをそのまま信じて操作を進めない。
"use strict";

const AI = (() => {
  const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";
  const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
  const IMAGE_MAX_SIDE = 1536;        // AI に渡す画像の長辺（番号札の小さな数字が読める大きさ）
  const MIN_INTERVAL_MS = 4000;       // 呼び出しの最短間隔（無料枠を使い切らないため）
  const MAX_PER_MINUTE = 8;           // 1分あたりの上限

  const BUILTIN_OPTIONS = {
    expectedInputs: [{ type: "text", languages: ["ja"] }, { type: "image" }],
    expectedOutputs: [{ type: "text", languages: ["ja"] }],
  };

  const SYSTEM = `あなたは「スライド先生」の AI 先生です。パソコンのソフト（PowerPoint に限らず、Excel・Word・
Photoshop・Premiere・ブラウザなど何でも）を初めて使う人に、画面を見ながら次の一手を1つずつ教えます。
- 答えは必ず指定された JSON だけで返す
- やさしい日本語で短く（長さは、それぞれの項目の指示に従う）
- 画面上の場所を指すときは、画像に付いた赤い番号札の番号で答える
- ボタンやメニューの名前は画面の表記のまま書き、画面にない名前を推測で作らない
- 分からないときは推測で断言しない`;

  // ─── 設定（このブラウザに保存） ───────────────────
  const settings = { provider: "off", geminiKey: "", geminiModel: DEFAULT_GEMINI_MODEL };
  try { Object.assign(settings, JSON.parse(localStorage.getItem("slideSenseiAI") || "{}")); } catch { /* 初期値のまま */ }
  settings.geminiModel = normalizeModel(settings.geminiModel);
  function save(next) {
    Object.assign(settings, next);
    settings.geminiModel = normalizeModel(settings.geminiModel);
    try { localStorage.setItem("slideSenseiAI", JSON.stringify(settings)); } catch { /* 保存できない環境 */ }
  }

  // 表示名（「Gemini 3.5 Flash Lite」など）で入力されても、API が受け付けるモデルコード
  // （「gemini-3.5-flash-lite」）に直す。API は小文字・数字・「.」「-」だけの名前しか受け付けない
  function normalizeModel(name) {
    const code = String(name ?? "").trim().replace(/^models\//i, "").toLowerCase()
      .replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return code || DEFAULT_GEMINI_MODEL;
  }
  function enabled() {
    return settings.provider === "builtin" || (settings.provider === "gemini" && !!settings.geminiKey);
  }
  function label() {
    return { builtin: "内蔵AI", gemini: "Gemini" }[settings.provider] ?? "OFF";
  }

  // ─── 呼び出し回数の制限 ────────────────────────
  // 4秒に1回までは、エラーにせず順番を待つ（「1行ずつ説明」を案内の直後に押しても失敗しないように）。
  // 1分間の上限に達したときだけエラーにする。同時に呼ばれても順番に並べる（gate）
  const calls = [];   // 直近1分の呼び出し時刻
  let gate = Promise.resolve();
  function reserve() {
    const turn = gate.then(async () => {
      const now = Date.now();
      while (calls.length && now - calls[0] > 60_000) calls.shift();
      if (calls.length >= MAX_PER_MINUTE) {
        throw new Error(`AI の呼び出しが1分間の上限（${MAX_PER_MINUTE}回）に達しました。少し待ってからどうぞ`);
      }
      const wait = calls.length ? MIN_INTERVAL_MS - (now - calls[calls.length - 1]) : 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      calls.push(Date.now());
    });
    gate = turn.catch(() => {});
    return turn;
  }
  function usage() {
    const now = Date.now();
    return calls.filter((t) => now - t <= 60_000).length;
  }
  // 自動テスト用: 呼び出し回数の記録と、内蔵AIの準備済みセッションを消す
  function resetForTest() {
    calls.length = 0;
    gate = Promise.resolve();
    builtinBase = null;
  }

  // ─── Chrome 内蔵AI ───────────────────────────
  let builtinBase = null;

  async function builtinStatus() {
    if (!("LanguageModel" in self)) return "unavailable";
    try { return await LanguageModel.availability(BUILTIN_OPTIONS); } catch { return "unavailable"; }
  }

  // モデルの取り込みが必要なときはボタンを押した直後に呼ぶこと（ブラウザの制限）
  // 同時に呼ばれても1つだけ作る（作っている途中の約束を覚えておく。失敗したら次に作り直す）
  async function prepareBuiltin(onProgress) {
    builtinBase ??= LanguageModel.create({
      ...BUILTIN_OPTIONS,
      initialPrompts: [{ role: "system", content: SYSTEM }],
      monitor(m) { m.addEventListener("downloadprogress", (e) => onProgress?.(e.loaded)); },
    }).catch((e) => { builtinBase = null; throw e; });
    return builtinBase;
  }

  async function askBuiltin(text, images, schema) {
    const base = await prepareBuiltin();
    const session = await base.clone();   // 毎回、前の会話を持ち込まない
    try {
      const content = [{ type: "text", value: text }, ...images.map((value) => ({ type: "image", value }))];
      return await session.prompt([{ role: "user", content }], { responseConstraint: schema });
    } finally {
      session.destroy();
    }
  }

  // ─── Gemini API ──────────────────────────────
  async function askGemini(text, images) {
    const parts = [{ text }, ...images.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: toJpegBase64(img) } }))];
    const res = await fetch(`${GEMINI_ENDPOINT}${encodeURIComponent(settings.geminiModel)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Gemini の無料枠の回数制限に達しました。しばらく待ってからお試しください");
      if (res.status === 400 && /API key/i.test(body)) throw new Error("APIキーが正しくないようです。AI 設定を確認してください");
      if (res.status === 404 || /model name format/i.test(body)) {
        throw new Error(`モデル「${settings.geminiModel}」が見つかりません。AI 設定のモデル欄で候補から選んでください（例: gemini-3.5-flash-lite）`);
      }
      throw new Error(`Gemini API エラー（${res.status}）: ${body.slice(0, 160)}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  function toJpegBase64(canvas) {
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  // ─── 共通 ───────────────────────────────────
  // images: 一緒に渡す画像（キャンバス）の配列。文中で「画像1」「画像2」と順番どおりに呼ぶ
  async function ask(text, images, schema) {
    if (!enabled()) throw new Error("AI が OFF です。「🤖 AI」から設定してください");
    await reserve();
    const raw = settings.provider === "builtin"
      ? await askBuiltin(text, images, schema)
      : await askGemini(`${text}\n\n次の JSON スキーマに合う JSON だけを返してください:\n${JSON.stringify(schema)}`, images);
    return parseJson(raw);
  }

  // JSON だけを返すよう頼んでも ```json で囲まれることがあるので取り出す。答えは必ずオブジェクト（{…}）
  function parseJson(raw) {
    const s = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
    for (const candidate of [s, s.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      for (const text of [candidate, repairJson(candidate)]) {
        try {
          const v = JSON.parse(text);
          if (isObject(v)) return v;
        } catch { /* 次の読み方を試す */ }
      }
    }
    throw new Error("AI の答えを読み取れませんでした。「🤖 AIに聞く」でもう一度試してください");
  }

  // AI がたまに書く、JSON として正しくない文字を直す（文字列の中だけを直す）
  // - 壊れた「\」（「\u30」のように4桁そろわない \u、Windows の「C:\Users」など）→ 「\」そのものとして読む
  //   （JSON.parse が「Bad Unicode escape」などで失敗する原因）
  // - 文字列の中の生の改行・タブ → \n・\t（コードの改行や字下げを壊さない）
  function repairJson(s) {
    let out = "";
    let inString = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inString) {
        if (ch === '"') inString = true;
        out += ch;
      } else if (ch === "\\") {
        const next = s[i + 1] ?? "";
        if ('"\\/bfnrt'.includes(next) && next) { out += ch + next; i++; }
        else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) { out += s.slice(i, i + 6); i += 5; }
        else out += "\\\\";
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch < " ") {
        out += { "\n": "\\n", "\r": "\\r", "\t": "\\t" }[ch] ?? " ";
      } else {
        out += ch;
      }
    }
    return out;
  }

  const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  // 入力する中身（コードなど）。字下げや改行はそのまま残す
  const block = (v, max = 4000) => (typeof v === "string" ? v.replace(/^\s*\n|\s+$/g, "").slice(0, max) : "");
  const INPUT_RULE = `- input_text: その一手で入力・貼り付けする中身（コード、数式、文章など）があるときは、そのまま使える完成形を書く。
  「〜を入力してください」とだけ言って、中身を利用者に考えさせない（教えるのはあなたの役目）。
  初心者向けに短く分かりやすく。コードなら日本語の短いコメントを付ける。このとき say は
  「下のコードをコードセルに貼り付けてください」のように、中身は input_text にあると伝える。入力のない一手なら空文字`;
  // 操作を「させる」だけでなく「教える」ための指示（なぜそうするのか・結果の読み方・ヒント）
  const TEACH_RULE = `- teach: その一手で学べること・なぜそうするのかを、初心者向けに1〜2文で
  （例:「セルはコードを書いて実行する箱です。▶ を押すと、すぐ下に結果が出ます」）。
  直前の手順でコードを実行して結果やエラーが出ていれば、その読み方・意味も説明する。done なら、全体で学んだことのまとめ
- hint: input_text があるとき、答えを見せずに自分で考えるためのヒントを1文
  （例:「並べ替えには sorted() という関数が使えます」）。input_text がなければ空文字`;
  const TEACHER = `あなたは初心者に教える、やさしい先生です。操作をさせるだけでなく、なぜそうするのかも伝えます。
コードを書く目標では、数行ずつ書いて実行し、結果を確かめながら進めます（長いコードを一度に出さない）。`;
  // 「[30]の「セルを実行」」のような番号札の番号は、利用者には意味がないので消す。
  // コードの「nums[0]」のような添字は消さない（直前が文の区切りや空白のときだけ番号札とみなす）
  const dropTagNumbers = (s) => s.replace(/(^|[\s、。「『（(])[\[［]\d+[\]］]\s*の?/g, "$1").trim();

  // ─── 画面を見て次の一手を答える ─────────────────
  // 場所は「番号札（文字認識で見つけた画面上の文字）から選ぶ」形で答えさせる。
  // AI に座標や名前を作らせると外れやすいが、候補から選ぶだけなら小さいモデルでも当たりやすく、
  // 位置は文字認識の正確な値をそのまま使える（Set-of-Mark）
  const COACH_SCHEMA = {
    type: "object",
    properties: {
      current_done: { type: "string", enum: ["yes", "no", "none"] },
      status: { type: "string", enum: ["next", "done", "unsure"] },
      say: { type: "string" },
      target_id: { type: "integer" },
      target_text: { type: "string" },
      box: { type: "array", items: { type: "number" } },
      input_text: { type: "string" },
      teach: { type: "string" },
      hint: { type: "string" },
      reason: { type: "string" },
    },
    required: ["current_done", "status", "say", "target_id", "target_text", "input_text", "teach", "hint", "reason"],
  };

  // AI が答えた [ymin, xmin, ymax, xmax]（0〜1000）を、画面に対する割合の枠にする。おかしな値なら null
  function toBox(b) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return null;
    const [y0, x0, y1, x1] = b.map((v) => v / 1000);
    return x1 > x0 && y1 > y0 && x1 - x0 < 0.6 && y1 - y0 < 0.6 ? { x0, y0, x1, y1 } : null;
  }

  // c: { image（いまの画面・番号札つき）, before（指示を出したときの画面。なければ null）,
  //      appeared / disappeared（その間に新しく現れた・消えた文字）, app（共有中のウインドウ名）, goal（やりたいこと）,
  //      done（終わった手順の配列）, current（いま案内中の手順。なければ null）, items（番号札 [{ id, text, x0..y1 }]） }
  // 返り値: { currentDone: true | false | null, status: "next" | "done" | "unsure",
  //          say, targetId（なければ null）, targetText, box, inputText（入力する中身。なければ空文字）,
  //          teach（その一手で学べること）, hint（答えを見る前のヒント）, reason }
  async function coach(c) {
    const list = c.items.map((it) =>
      `[${it.id}] ${it.text} (${Math.round(((it.x0 + it.x1) / 2) * 100)}%, ${Math.round(((it.y0 + it.y1) / 2) * 100)}%)`).join("\n");
    const images = c.before ? [c.before, c.image] : [c.image];
    const nowName = c.before ? "画像2" : "画像1";
    const change = c.before ? `
画像1は「いま案内中の手順」を出したときの画面、${nowName}はいまの画面です（${nowName}だけに番号札を付けています）。
その間に新しく現れた文字: ${c.appeared.join("、") || "（なし）"}
その間に消えた文字: ${c.disappeared.join("、") || "（なし）"}
` : `
${nowName}はいまの画面です。`;
    const text = `アプリ（共有中のウインドウ名）: ${c.app || "不明"}
やりたいこと: ${c.goal}
これまでに終わった手順:
${c.done.map((d, i) => `${i + 1}. ${d}`).join("\n") || "（なし）"}
いま案内中の手順: ${c.current ?? "（なし。最初の一手を考えてください）"}
${change}
${nowName}の画面上の文字に赤い番号札を付けました。
番号札の一覧（文字と、画面の左上を0%・右下を100%としたときの中心の位置）:
${list || "（文字が見つかりませんでした）"}

次を JSON で答えてください。
- current_done: 「いま案内中の手順」が済んでいれば "yes"、まだなら "no"、案内中の手順がなければ "none"。
  クリックや入力の瞬間は画像に写らないので、その「結果」で判断する（タブやメニューが開いた、文字が入った、
  新しいボタンやタブが現れた、など）。画面が手順の目的に沿って変わっていれば "yes"。
  はっきり失敗している（何も変わっていない、違う画面に行った）ときだけ "no"。迷ったら "yes"
- status: やりたいことが達成できていれば "done"、次の一手を示せるなら "next"、画面から判断できないなら "unsure"。
  達成できたかは「これまでに終わった手順」といまの画面で判断する。やりたいことに書かれていない作業を足さない
  （例:「セルを実行したい」なら、セルを1回実行できた時点で done。セルの中身が空でもよい）
- say: 次にやる一手を1文で（例:「上の『挿入』タブをクリックしてください」）。
  案内中の手順がまだなら、その手順のやり方を言い直す。done なら完了のひとこと
${INPUT_RULE}
${TEACH_RULE}
- target_id: その一手で操作する場所の番号札の番号（一覧から1つ）。
  番号札のない場所（アイコンだけのボタン、図形、スライドの中など）なら 0
- target_text: target_id の番号札に書かれている文字を一覧のとおりに（番号の読み違いを確かめるため）。0 なら空文字
- box: target_id が 0 のとき、その場所の範囲 [ymin, xmin, ymax, xmax]（${nowName}の左上を0、右下を1000）。分からなければ空の配列
- reason: そう判断した理由を短く
ルール: 一度に1つの操作だけ。メニュー名やボタン名を推測で作らない。
${TEACHER}
「これまでに終わった手順」と同じ手順をくり返させない（同じ手順に戻りそうなら、やりたいことがもう達成できているかを考え直す）。
say に番号札の番号（[12] など）は書かない。`;
    const r = await ask(text, images, COACH_SCHEMA);
    const id = Number(r.target_id);
    return {
      currentDone: { yes: true, no: false }[r.current_done] ?? null,
      status: ["next", "done", "unsure"].includes(r.status) ? r.status : "unsure",
      say: dropTagNumbers(str(r.say)),
      targetId: c.items.some((it) => it.id === id) ? id : null,
      targetText: str(r.target_text, 40),
      box: toBox(r.box),
      inputText: block(r.input_text),
      teach: str(r.teach, 300),
      hint: str(r.hint, 200),
      reason: str(r.reason),
    };
  }

  // ─── Office アドイン用: 文書の状態（文章）を見て次の一手を答える ─────
  // 画面の画像はなく、Office から読んだ正確な状態（選択範囲・値・書式・図形など）で判断する。
  // リボンのボタンは光らせられないので、押す場所は「タブ → ボタン → 項目」の道順で答えさせる
  const OFFICE_SCHEMA = {
    type: "object",
    properties: {
      current_done: { type: "string", enum: ["yes", "no", "none"] },
      status: { type: "string", enum: ["next", "done", "unsure"] },
      say: { type: "string" },
      path: { type: "array", items: { type: "string" } },
      doc_target: { type: "string" },
      input_text: { type: "string" },
      teach: { type: "string" },
      hint: { type: "string" },
      reason: { type: "string" },
    },
    required: ["current_done", "status", "say", "path", "doc_target", "input_text", "teach", "hint", "reason"],
  };

  // c: { host（"Excel" | "Word" | "PowerPoint"）, goal, done, current, before（指示を出したときの状態の文章。なければ null）,
  //      now（いまの状態の文章）, targetKind（doc_target に書くもの。例: "セル範囲（A1:C5 の形）"） }
  // 返り値: { currentDone, status, say, path（リボンの道順）, docTarget, inputText（入力する中身）, reason }
  async function coachOffice(c) {
    const text = `アプリ: Mac の ${c.host}（日本語版）。利用者は ${c.host} の初心者です。
やりたいこと: ${c.goal}
これまでに終わった手順:
${c.done.map((d, i) => `${i + 1}. ${d}`).join("\n") || "（なし）"}
いま案内中の手順: ${c.current ?? "（なし。最初の一手を考えてください）"}
${c.before ? `\n「いま案内中の手順」を出したときの文書の状態:\n${c.before}\n` : ""}
いまの文書の状態（${c.host} から直接読んだ正確な情報）:
${c.now}

次を JSON で答えてください。
- current_done: 「いま案内中の手順」が済んでいれば "yes"、まだなら "no"、案内中の手順がなければ "none"。
  文書の状態の変化で判断する（選択範囲が変わった、値や書式が変わった、図形が増えた、など）。
  リボンのタブを開くだけ・メニューを開くだけの手順は文書が変わらないので、次の手順の結果が出ていれば "yes" にする。迷ったら "yes"
- status: やりたいことが全部終わっていれば "done"、次の一手を示せるなら "next"、判断できないなら "unsure"
- say: 次にやる一手を1文で（例:「『ホーム』タブの『罫線』の ▼ から『格子』を選んでください」）。done なら完了のひとこと
- path: その一手で押すリボンの道順を、画面の表記のまま順番に（例: ["ホーム", "罫線", "格子"]）。リボンを使わない操作なら空の配列
- doc_target: その一手で操作する文書の中の場所。${c.targetKind}。なければ空文字
${INPUT_RULE}
${TEACH_RULE}
- reason: そう判断した理由を短く
ルール: 一度に1つの操作だけ。Mac の ${c.host} にないボタン名を作らない。
${TEACHER}`;
    const r = await ask(text, [], OFFICE_SCHEMA);
    return {
      currentDone: { yes: true, no: false }[r.current_done] ?? null,
      status: ["next", "done", "unsure"].includes(r.status) ? r.status : "unsure",
      say: str(r.say),
      path: Array.isArray(r.path) ? r.path.map((p) => str(p, 20)).filter(Boolean).slice(0, 5) : [],
      docTarget: str(r.doc_target, 60),
      inputText: block(r.input_text),
      teach: str(r.teach, 300),
      hint: str(r.hint, 200),
      reason: str(r.reason),
    };
  }

  // ─── 学ぶための補助 ─────────────────────────────
  // コードを1行ずつ説明する。返り値: [{ code, explain }]
  async function explainCode({ code, goal }) {
    const text = `${TEACHER}
次のコードを、プログラミングを始めたばかりの人に1行ずつ説明してください。
やりたいこと: ${goal}
コード:
${code}

JSON で答えてください。lines: 行ごとの { code（その行をそのまま。空行やコメントだけの行は省く）, explain（何をしているかを1文で） }`;
    const r = await ask(text, [], {
      type: "object",
      properties: {
        lines: { type: "array", items: { type: "object", properties: { code: { type: "string" }, explain: { type: "string" } }, required: ["code", "explain"] } },
      },
      required: ["lines"],
    });
    return (Array.isArray(r.lines) ? r.lines : [])
      .map((l) => ({ code: block(l?.code, 200), explain: str(l?.explain, 200) }))
      .filter((l) => l.code && l.explain)
      .slice(0, 40);
  }

  // 利用者の質問に、いまの画面と案内の流れをふまえて答える。返り値: 答えの文章
  // c: { question, goal, done, current, app, image（いまの画面。なければ null） }
  async function answerQuestion(c) {
    const text = `${TEACHER}
利用者から質問がありました。いまの画面（画像）と、案内の流れをふまえて、初心者にも分かるように答えてください。
アプリ: ${c.app || "不明"}
やりたいこと: ${c.goal || "（まだ決まっていない）"}
これまでに終わった手順: ${c.done?.join(" / ") || "（なし）"}
いま案内中の手順: ${c.current ?? "（なし）"}
質問: ${c.question}

JSON で答えてください。answer: 答え（3〜5文。必要なら短いコード例を入れてよい。専門用語には一言で説明を添える）`;
    const r = await ask(text, c.image ? [c.image] : [], {
      type: "object", properties: { answer: { type: "string" } }, required: ["answer"],
    });
    return block(r.answer, 1500);
  }

  // 接続テスト（画面の画像は送らない）
  async function ping() {
    const r = await ask('動作確認です。{"ok": true} を返してください。', [],
      { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] });
    if (r.ok !== true) throw new Error("AI の答えが想定と違いました");
  }

  return {
    settings, save, enabled, label, usage,
    builtinStatus, prepareBuiltin,
    coach, coachOffice, explainCode, answerQuestion, ping, parseJson, IMAGE_MAX_SIDE, resetForTest,
    DEFAULT_GEMINI_MODEL, normalizeModel,
  };
})();
