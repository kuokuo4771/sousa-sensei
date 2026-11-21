// そうさ先生: 画面まわり（AI 設定画面・やりたいこと入力欄・⚙ 設定メニュー・ミニ窓・テーマ）

// ─── AI の設定画面 ────────────────────────────────
el.aiBtn.addEventListener("click", openAiDialog);
el.aiClose.addEventListener("click", () => el.aiDialog.close());

async function openAiDialog() {
  const s = AI.settings;
  for (const r of el.aiDialog.querySelectorAll("input[name=provider]")) r.checked = r.value === s.provider;
  el.geminiKey.value = s.geminiKey;
  AI.fillModelSelect(el.geminiModel, s.geminiModel);
  el.aiTestResult.textContent = "";
  el.aiDialog.showModal();
  await renderBuiltinState();
}

async function renderBuiltinState() {
  const status = await AI.builtinStatus();
  el.builtinState.textContent = {
    available: "この端末で使えます。画面の画像は端末の外に出ません。",
    downloadable: "使えます。初回だけ「準備する」でモデル（約3〜4GB）を取り込みます。画像は端末の外に出ません。",
    downloading: "モデルを取り込み中です…",
    unavailable: "この端末・ブラウザでは使えません（Chrome 148 以降、空き容量 20GB 以上、メモリなどの条件があります）。",
  }[status] ?? status;
  el.builtinRadio.disabled = status === "unavailable";
  el.builtinPrepare.hidden = status !== "downloadable" && status !== "downloading";
}

// モデルの取り込みはボタンを押した直後にしか始められない（ブラウザの制限）
el.builtinPrepare.addEventListener("click", async () => {
  el.builtinPrepare.disabled = true;
  try {
    await AI.prepareBuiltin((p) => { el.builtinState.textContent = `モデルを取り込み中… ${Math.round(p * 100)}%`; });
    el.builtinState.textContent = "準備できました。この端末で使えます。";
    el.builtinPrepare.hidden = true;
  } catch (e) {
    el.builtinState.textContent = `準備できませんでした: ${e.message}`;
  } finally {
    el.builtinPrepare.disabled = false;
  }
});

function readAiForm() {
  const provider = el.aiDialog.querySelector("input[name=provider]:checked")?.value ?? "off";
  return {
    provider,
    geminiKey: el.geminiKey.value.trim(),
    geminiModel: AI.normalizeModel(el.geminiModel.value),
  };
}

el.aiSave.addEventListener("click", () => {
  const next = readAiForm();
  if (next.provider === "gemini" && !next.geminiKey) {
    el.aiTestResult.textContent = "Gemini を使うには APIキーを入力してください。";
    return;
  }
  AI.save(next);
  renderAiButton();
  render();
  addLog(`AI: ${AI.label()}`);
  el.aiDialog.close();
});

// 接続テスト（画面の画像は送らない）
el.aiTest.addEventListener("click", async () => {
  const before = { ...AI.settings };
  const form = readAiForm();
  AI.save(form);
  el.aiTestResult.textContent = "テスト中…";
  const prevNotice = AI.setNotice((msg) => { el.aiTestResult.textContent = msg; });
  try {
    await AI.ping();
    el.aiTestResult.textContent = "✓ つながりました";
  } catch (e) {
    el.aiTestResult.textContent = `✗ ${e.message}`;
  }
  // 選んだモデルが使えなくても、キーが正しければ使えるモデルをメニューに足す
  if (form.provider === "gemini" && form.geminiKey) {
    try {
      await AI.listGeminiModels();
      AI.fillModelSelect(el.geminiModel, form.geminiModel);
    } catch (e) {
      console.warn(e.message);
    }
  }
  AI.setNotice(prevNotice);
  AI.save(before);   // 保存は「保存」を押したときだけ
});

// ─── 🧭 AIにおまかせ の入力欄（案内パネルの中にあるので、ミニ窓からも始められる） ─────
el.makeBtn.addEventListener("click", () => {
  if (!AI.enabled()) { openAiDialog(); return; }
  el.goalInline.focus();
});

el.goalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = el.goalInline.value.trim();
  if (!goal) { el.goalInline.focus(); return; }
  // 合うテンプレがあれば、AI を使わずに案内する（AI が OFF でも使える）
  const template = Templates.match(goal, currentApp());
  if (template) {
    el.goalInline.blur();
    startCoach(goal, template, { auto: true });
    return;
  }
  if (!AI.enabled()) {
    if (state.pip) showAi("AI が OFF です。ブラウザの「⚙ 設定」→「🤖 AI」から設定してください。", "error");
    else openAiDialog();
    return;
  }
  el.goalInline.blur();
  startCoach(goal);
});

// ─── 設定メニュー（⚙） ─────────────────────────────
el.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.settingsPop.hidden = !el.settingsPop.hidden;
  el.settingsBtn.setAttribute("aria-expanded", String(!el.settingsPop.hidden));
});
document.addEventListener("click", (e) => {
  if (!el.settingsPop.hidden && !el.settingsPop.contains(e.target)) {
    el.settingsPop.hidden = true;
    el.settingsBtn.setAttribute("aria-expanded", "false");
  }
});

// ─── Mini window (Document Picture-in-Picture) ───────
const canPip = "documentPictureInPicture" in window;
if (!canPip) {
  el.pipBtn.disabled = true;
  el.pipBtn.title = "このブラウザはミニ窓に対応していません（Chrome 116 以降で使えます）";
}
el.pipBtn.addEventListener("click", () => {
  el.pipBtn.classList.remove("attention");
  if (state.pip) state.pip.close();
  else openPip();
});

// 案内パネルを最前面の小窓へ移す。開いた小窓を返す
async function openPip() {
  const pip = await documentPictureInPicture.requestWindow({ width: 380, height: 600 });
  pip.document.title = "そうさ先生";
  document.querySelectorAll("style, link[rel=stylesheet]").forEach((n) => pip.document.head.append(n.cloneNode(true)));
  syncTheme(pip.document);
  pip.document.body.classList.add("pip");
  pip.document.body.append(el.tutor);
  el.tutorHomeNote.hidden = false;
  el.pipBtn.textContent = "📌 ミニ窓を閉じる";
  state.pip = pip;
  // タイマーをミニ窓側へ移す
  if (state.stream && !state.paused) schedule();
  if (state.countdown) startCountdown();

  pip.addEventListener("pagehide", () => {
    el.tutorHome.append(el.tutor);
    el.tutorHomeNote.hidden = true;
    el.pipBtn.textContent = "📌 ミニ窓で表示";
    state.pip = null;
    // ミニ窓と一緒に消えたタイマーを、元のページで動かし直す
    if (state.stream && !state.paused) schedule();
    if (state.countdown) startCountdown();
  });
  return pip;
}

// ミニ窓なしでこのタブが裏に回ると、タイマーが間引かれて見守りが遅れる
// （共有1回につき1度だけ知らせる）
let warnedHidden = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.stream && !state.pip && !warnedHidden) {
    warnedHidden = true;
    addLog("⚠ ブラウザが裏に回りました。ミニ窓で表示すると確実に見守れます");
  }
});

// ─── Theme ────────────────────────────────────────────
function syncTheme(doc) {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) doc.documentElement.setAttribute("data-theme", t);
}
el.themeToggle.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "dark"
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", next);
  if (state.pip) syncTheme(state.pip.document);
});

// ─── テンプレ ──────────────────────────────────────
// 自動で選んだテンプレが違うときは、AI に計画を立ててもらう
el.tplAiBtn.addEventListener("click", () => {
  if (!AI.enabled()) { openAiDialog(); return; }
  startCoach(coach.goal);
});

// AI の計画でうまくいった手順を、テンプレとして保存する（次からは AI を使わない）
el.saveTplBtn.addEventListener("click", () => {
  const t = Templates.save(Templates.fromScreenPlan(coach.goal, coach.planApp, coach.plan));
  if (!t) return;
  fillLessonSelect();
  el.saveTplBtn.hidden = true;
  addLog(`📘 テンプレに保存しました: ${t.title}`);
  showAi(`📘 テンプレ「${t.title}」に保存しました。次から同じことを書くと、AI を使わずに案内します。`);
});

function renderTplList() {
  const mine = Templates.all().filter((t) => t.id.startsWith("user-"));
  el.tplList.replaceChildren(...mine.map((t) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = `📘 ${t.title}${t.app ? `（${t.app}）` : ""}`;
    const del = document.createElement("button");
    del.className = "btn";
    del.type = "button";
    del.textContent = "削除";
    del.addEventListener("click", () => { Templates.remove(t.id); renderTplList(); fillLessonSelect(); });
    li.append(name, del);
    return li;
  }));
  if (!mine.length) el.tplList.innerHTML = "<li>保存したテンプレはまだありません。</li>";
}
el.tplBtn.addEventListener("click", () => {
  el.tplResult.textContent = "";
  renderTplList();
  el.tplDialog.showModal();
});
el.tplClose.addEventListener("click", () => el.tplDialog.close());
el.tplExport.addEventListener("click", async () => {
  el.tplText.value = Templates.exportJson();
  try {
    await navigator.clipboard.writeText(el.tplText.value);
    el.tplResult.textContent = "✓ コピーしました。送りたい相手に貼り付けて渡してください。";
  } catch {
    el.tplText.select();
    el.tplResult.textContent = "欄の文字を選びました。⌘C / Ctrl+C でコピーしてください。";
  }
});
el.tplImport.addEventListener("click", () => {
  try {
    const n = Templates.importJson(el.tplText.value);
    el.tplResult.textContent = `✓ ${n} 個のテンプレを読み込みました。`;
    renderTplList();
    fillLessonSelect();
  } catch (e) {
    el.tplResult.textContent = `✗ ${e.message}`;
  }
});

// ─── 使うソフト ─────────────────────────────────────
renderAppSelect();
el.appSelect.addEventListener("change", () => {
  if (el.appSelect.value) addLog(`使うソフト: ${el.appSelect.value}`);
});

// ─── 公式ヘルプからテンプレを作る ─────────────────────
el.docApp.append(...Templates.apps.map((a) => new Option(a.id, a.id)));
function renderDocHelp() { el.docHelp.href = Templates.appInfo(el.docApp.value)?.help ?? "#"; }
el.docApp.addEventListener("change", renderDocHelp);
el.tplBtn.addEventListener("click", () => {
  if (currentApp()) el.docApp.value = currentApp();
  renderDocHelp();
});
el.docMake.addEventListener("click", async () => {
  const text = el.docText.value.trim();
  if (text.length < 40) { el.tplResult.textContent = "公式ヘルプのページの文章を貼り付けてください。"; return; }
  if (!AI.enabled()) { el.tplResult.textContent = "テンプレを作るには AI の設定が必要です（⚙ 設定 → 🤖 AI）。"; return; }
  const app = el.docApp.value;
  el.docMake.disabled = true;
  el.tplResult.textContent = "🤖 AI が公式ヘルプを読んで、テンプレを作っています…";
  try {
    const r = await AI.templateFromDoc({ text, url: el.docUrl.value.trim(), app, hint: Templates.appInfo(app)?.hint ?? "" });
    const t = r.steps.length ? Templates.save(Templates.fromDoc(r, { url: el.docUrl.value.trim(), app })) : null;
    if (!t) {
      el.tplResult.textContent = "✗ この文章からは手順を読み取れませんでした。操作の手順が書かれたページを貼ってください。";
      return;
    }
    el.docText.value = "";
    el.tplResult.textContent = `✓ テンプレ「${t.title}」（${t.steps.length} 手）を作りました。やりたいことに「${t.keywords[0] ?? t.title}」などと書くと使われます。`;
    renderTplList();
    fillLessonSelect();
  } catch (e) {
    el.tplResult.textContent = `✗ 作れませんでした: ${e.message}`;
  } finally {
    el.docMake.disabled = false;
  }
});
