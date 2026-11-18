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
    return { id: text(t.id, 60) || `user-${Date.now()}`, app: text(t.app, 30), title, keywords: list(t.keywords), sample: !!t.sample, steps };
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
  // 押す順のボタン（path）は、1つずつの手順に分けて光らせる。最初のボタンが2つ以上あるときの先頭はタブとみなす
  function toScreenSteps(t) {
    const out = [];
    for (const s of t.steps) {
      if (s.path.length <= 1) {
        out.push({ do: s.do, where: s.where, result: "", target: s.path[0] ?? "", appears: s.appears, input: s.input });
        continue;
      }
      s.path.forEach((name, i) => {
        const last = i === s.path.length - 1;
        out.push({
          do: i === 0 ? `「${name}」タブをクリックしてください` : `「${name}」をクリックしてください`,
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

  return { all, get, match, save, remove, exportJson, importJson, toScreenSteps, fromScreenPlan, fromOfficePlan, clean, KEY };
})();
