// そうさ先生: やることテンプレ（手順書）。テンプレがあれば AI を呼ばずに案内できる。
// 本体（画面共有）と Office 版で同じ形を使う。Photoshop・Blender などもこの形で増やせる。
//
// テンプレの形:
//   { id, app, title, keywords: [やりたいことに含まれていたら選ぶ言葉], sample（見本で、実物で未確認なら true）,
//     steps: [{
//       do     : 手順の文（「〜してください」）
//       where  : その場所が画面のどのあたりか（なくてもよい）
//       path   : 押す順のボタン・メニュー名（例: ["ホーム", "罫線", "格子"]）。
//                画面共有では1つずつの手順に分けて光らせ、Office 版では道順のチップで見せる
//       appears: 手順が済むと画面に新しく現れる文字（画面共有で「できた」を確かめる）
//       input  : 入力する文字や数式
//       doc    : Office 版で選択して見せる文書の中の場所（Excel のセル範囲など）
//       state  : Office 版で、済むと文書の状態に新しく現れる言葉（どれか1つ現れたら「できた」）
//     }] }
// 利用者が保存したテンプレは、このブラウザ（Office の中ではそのアドイン）に保存し、書き出し・読み込みで受け渡す。
"use strict";

// 案内できるソフト。title はウインドウ名や画面の文字に出るソフト名、words はそのソフトの画面によく出る言葉（見分けるため）。
// hint は AI に渡す、そのソフトの画面の作り。help は公式ヘルプの入口（テンプレを作るとき開く）
const APPS = [
  { id: "Excel", help: "https://support.microsoft.com/ja-jp/excel", title: /Microsoft Excel|Excel/,
    words: ["数式", "データ", "ページレイアウト", "オートSUM", "並べ替え", "条件付き書式"],
    hint: "Mac の Microsoft Excel（日本語版）。上部のリボン（タブとボタン）で操作する" },
  { id: "Word", help: "https://support.microsoft.com/ja-jp/word", title: /Microsoft Word/,
    words: ["参考資料", "差し込み文書", "段落", "スタイル", "レイアウト"],
    hint: "Mac の Microsoft Word（日本語版）。上部のリボン（タブとボタン）で操作する" },
  { id: "PowerPoint", help: "https://support.microsoft.com/ja-jp/powerpoint", title: /PowerPoint/,
    words: ["スライドショー", "画面切り替え", "アニメーション", "新しいスライド", "デザイン"],
    hint: "Mac の Microsoft PowerPoint（日本語版）。上部のリボン（タブとボタン）で操作する" },
  { id: "Google スプレッドシート", help: "https://support.google.com/docs/?hl=ja", title: /スプレッドシート|Google Sheets/,
    words: ["表示形式", "拡張機能", "ツール", "データ", "共有"],
    hint: "ブラウザ（Chrome）の Google スプレッドシート。上部のメニュー（ファイル・編集・表示・挿入・表示形式・データ・ツール・拡張機能・ヘルプ）とその下のツールバーで操作する。リボンはない" },
  { id: "Illustrator", help: "https://helpx.adobe.com/jp/illustrator/desktop.html", title: /Illustrator/,
    words: ["オブジェクト", "効果", "アートボード", "書式", "選択"],
    hint: "Mac の Adobe Illustrator（日本語版）。上部のメニューバー（ファイル・編集・オブジェクト・書式・選択・効果・表示・ウィンドウ）、左のツールバー（アイコンだけのツール）、右のパネルで操作する。画面は暗い色" },
  { id: "Photoshop", help: "https://helpx.adobe.com/jp/photoshop/desktop.html", title: /Photoshop/,
    words: ["イメージ", "レイヤー", "選択範囲", "フィルター", "ブラシ"],
    hint: "Mac の Adobe Photoshop（日本語版）。上部のメニューバー（ファイル・編集・イメージ・レイヤー・書式・選択範囲・フィルター・表示・ウィンドウ）、左のツールバー（アイコンだけのツール）、右のパネルで操作する。画面は暗い色" },
  { id: "Blender", help: "https://docs.blender.org/manual/ja/latest/", title: /Blender/,
    words: ["オブジェクトモード", "モデリング", "スカルプト", "Layout", "Modeling", "Object Mode", "Scene Collection"],
    hint: "Blender。表示は英語のことも日本語のこともあるので、ボタン名は画面の表記に合わせる。上部のメニュー（ファイル・編集・レンダー・ウィンドウ）、3Dビューポートのヘッダー（ビュー・選択・追加・オブジェクト）で操作し、ショートカット（例: Shift+A で追加）もよく使う。画面は暗い色" },
];

const TEMPLATE_LIBRARY = [
  {
    id: "excel-trendline", app: "Excel", title: "散布図に近似直線を引いて数式を表示する", sample: true,
    keywords: ["近似直線", "近似曲線", "回帰直線", "トレンドライン", "近似式"],
    steps: [
      { do: "グラフにするデータの範囲（見出しを含む2列）をドラッグして選んでください", where: "シートのセル" },
      { do: "「挿入」タブの散布図のボタン（点が散らばった絵）から「散布図」を選んでください", where: "画面上部のリボン",
        path: ["挿入", "散布図"], state: ["XYScatter"] },
      { do: "グラフをクリックして選び、「グラフのデザイン」タブの「グラフ要素を追加」から「近似曲線」→「線形」を選んでください",
        where: "グラフを選ぶと出るリボンのタブ", path: ["グラフのデザイン", "グラフ要素を追加", "近似曲線", "線形"], state: ["Linear"] },
      { do: "近似直線を右クリックして「近似曲線の書式設定」を開き、「グラフに数式を表示する」にチェックを入れてください",
        where: "右側に開く書式設定のウインドウ", path: ["近似曲線の書式設定", "グラフに数式を表示する"],
        appears: "近似曲線の書式設定", state: ["数式あり"] },
    ],
  },
  {
    id: "excel-borders", app: "Excel", title: "表に格子の罫線を引く", sample: true,
    keywords: ["罫線", "格子", "枠線"],
    steps: [
      { do: "罫線を引きたい範囲をドラッグして選んでください", where: "シートのセル" },
      { do: "「ホーム」タブの罫線のボタンの ▼ から「格子」を選んでください", where: "リボンのフォントのグループ",
        path: ["ホーム", "罫線", "格子"], state: ["InsideHorizontal"] },
    ],
  },
  {
    id: "powerpoint-table", app: "PowerPoint", title: "スライドに表を入れる", sample: true,
    keywords: ["表を入れ", "表を挿入", "表を作", "テーブル"],
    steps: [
      { do: "「挿入」タブの「表」をクリックしてください", where: "画面上部のリボン", path: ["挿入", "表"] },
      { do: "出てきたマス目で、作りたい行と列の数のところまでマウスを動かしてクリックしてください",
        where: "「表」の下に開くマス目", state: ["Table"] },
    ],
  },
];

const Templates = (() => {
  const KEY = "sousaTemplates";
  const norm = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

  function userTemplates() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  function saveUser(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できない環境 */ }
  }

  // 形の崩れたテンプレ（読み込んだものなど）を、使える形にそろえる。使えなければ null
  function clean(t) {
    if (!t || typeof t !== "object" || !Array.isArray(t.steps)) return null;
    const text = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const list = (v) => (Array.isArray(v) ? v.map((x) => text(x, 60)).filter(Boolean).slice(0, 8) : []);
    const steps = t.steps.map((s) => ({
      do: text(s?.do), where: text(s?.where, 80), path: list(s?.path), appears: text(s?.appears, 40),
      input: typeof s?.input === "string" ? s.input.slice(0, 4000) : "", doc: text(s?.doc, 60), state: list(s?.state),
    })).filter((s) => s.do).slice(0, 20);
    const title = text(t.title, 80);
    if (!steps.length || !title) return null;
    const source = /^https?:\/\//.test(text(t.source, 300)) ? text(t.source, 300) : "";
    return { id: text(t.id, 60) || `user-${Date.now()}`, app: text(t.app, 30), title, keywords: list(t.keywords), sample: !!t.sample, source, steps };
  }

  // app を指定すると、そのアプリのテンプレだけ（app が空のテンプレはどのアプリでも）
  function all(app = "") {
    const user = userTemplates();
    const ids = new Set(user.map((t) => t.id));
    // 見本も省いた項目（path など）を埋めた形にそろえてから使う
    return [...user, ...TEMPLATE_LIBRARY.map(clean).filter((t) => t && !ids.has(t.id))]
      .filter((t) => !app || !t.app || t.app === app);
  }
  function get(id) { return all().find((t) => t.id === id) ?? null; }

  // やりたいことに合うテンプレ。キーワードが入っていれば候補にし、題名と似ているほど上にする。なければ null
  function match(goal, app = "") {
    const g = norm(goal);
    if (!g) return null;
    let best = null, bestScore = 0;
    for (const t of all(app)) {
      const hits = t.keywords.filter((k) => g.includes(norm(k))).length;
      const title = norm(t.title);
      let same = 0;
      for (let i = 0; i < title.length - 1; i++) if (g.includes(title.slice(i, i + 2))) same++;
      // キーワードがなくても、題名の2文字の並びの7割以上がやりたいことにあれば候補にする
      if (!hits && same < Math.max(2, (title.length - 1) * 0.7)) continue;
      const score = hits * 10 + same;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

  function save(t) {
    const c = clean(t);
    if (!c) return null;
    saveUser([c, ...userTemplates().filter((u) => u.id !== c.id)]);
    return c;
  }
  function remove(id) { saveUser(userTemplates().filter((t) => t.id !== id)); }

  // 書き出し（自分で保存したテンプレ）と読み込み（貼り付けた JSON。1つでも配列でもよい）。読み込んだ数を返す
  function exportJson() { return JSON.stringify(userTemplates(), null, 2); }
  function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("JSON として読めませんでした"); }
    const list = (Array.isArray(data) ? data : [data]).map(clean).filter(Boolean);
    if (!list.length) throw new Error("テンプレが見つかりませんでした（title と steps が必要です）");
    for (const t of list) save(t);
    return list.length;
  }

  // ─── 画面共有（本体）の手順にする ─────────────
  // 押す順のボタン（path）は、1つずつの手順に分けて光らせる。
  // リボンのある Office（Excel・Word・PowerPoint）では先頭をタブ、それ以外（Photoshop・Blender など）ではメニューとして案内する
  const RIBBON_APPS = ["Excel", "Word", "PowerPoint"];
  function toScreenSteps(t) {
    const ribbon = !t.app || RIBBON_APPS.includes(t.app);
    const out = [];
    for (const s of t.steps) {
      if (s.path.length <= 1) {
        out.push({ do: s.do, where: s.where, result: "", target: s.path[0] ?? "", appears: s.appears, input: s.input });
        continue;
      }
      s.path.forEach((name, i) => {
        const last = i === s.path.length - 1;
        out.push({
          do: i > 0 ? `「${name}」をクリックしてください`
            : ribbon ? `「${name}」タブをクリックしてください` : `上の「${name}」メニューをクリックしてください`,
          where: i === 0 ? s.where : "", result: last ? s.do : "", target: name,
          appears: last ? s.appears : "", input: last ? s.input : "",
        });
      });
    }
    return out;
  }

  // 本体で AI が立てた計画（1クリックずつの手順）をテンプレにする
  function fromScreenPlan(goal, app, plan) {
    return clean({
      id: `user-${Date.now()}`, app, title: goal, keywords: [goal],
      steps: plan.map((p) => ({ do: p.do, where: p.where, path: p.target ? [p.target] : [], appears: p.appears, input: p.input })),
    });
  }
  // Office 版で AI が立てた計画（道順つきの手順）をテンプレにする
  function fromOfficePlan(goal, app, plan) {
    return clean({
      id: `user-${Date.now()}`, app, title: goal, keywords: [goal],
      steps: plan.map((p) => ({ do: p.do, where: p.where, path: p.path, doc: p.doc, state: p.state, input: p.input })),
    });
  }

  // 画面の文字（text）とウインドウ名（label）から、使っているソフトを見分ける。分からなければ ""
  function detectApp(text, label = "") {
    const t = String(text ?? "");
    let best = "", bestScore = 0;
    for (const app of APPS) {
      let score = 0;
      if (app.title.test(label)) score += 10;
      if (app.title.test(t)) score += 5;
      score += app.words.filter((w) => t.includes(w)).length;
      if (score > bestScore) { best = app.id; bestScore = score; }
    }
    return bestScore >= 3 ? best : "";
  }
  function appInfo(id) { return APPS.find((a) => a.id === id) ?? null; }

  // AI が公式ヘルプの文章から作ったもの（AI.templateFromDoc の答え）をテンプレにする
  function fromDoc(r, { url = "", app = "" } = {}) {
    return clean({ ...r, id: `user-doc-${Date.now()}`, app: app || r.app, source: url });
  }

  return { all, get, match, save, remove, exportJson, importJson, toScreenSteps, fromScreenPlan, fromOfficePlan, clean, KEY,
    detectApp, appInfo, apps: APPS, fromDoc };
})();
