// スライド先生: 起動（すべてのファイルを読み込んだあとに最後に読む）

// ─── Boot ────────────────────────────────────────────
loadLesson(state.lessonId);

// URL の末尾に「?test」を付けて開くと、自動テスト（js/selftest.js）を読み込んで実行する
if (new URLSearchParams(location.search).has("test")) {
  const s = document.createElement("script");
  s.src = "js/selftest.js";
  document.body.append(s);
}
