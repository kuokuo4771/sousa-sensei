// そうさ先生: 文字認識（tesseract.js）と、文字によるステップ完了の判定

// ─── 文字認識（tesseract.js。画像はブラウザ内で処理） ───
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const OCR_LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1/4.0.0_best_int";
const OCR_MAX_WIDTH = 1920;       // これより大きいフレームは縮小して読む（速度のため）
const OCR_BINARY = 165;           // この明るさ未満を黒にして読む (0-255)
const OCR_TILE = 48;              // 明暗を判定する区画の大きさ（ピクセル）
const OCR_DARK_TILE = 150;        // 区画の平均の明るさがこれ未満なら「暗い背景」とみなす
const OCR_DARK_INK = 50;          // 暗い区画では、平均よりこれだけ明るい部分を文字とみなす
const OCR_DARK_WHITE_MAX = 0.2;   // 白っぽい点（200超）がこの割合以上ある区画は、平均が暗くても明るい背景とみなす
// リボンにあるボタン名。これより下を「スライド側」とみなす（タブ切替で増えた文字を入力と数えないため）
const RIBBON_WORDS = /ホーム|挿入|描画|デザイン|貼り付け|新しいスライド|レイアウト|図形|テキストボックス|配置|SmartArt|ワードアート|スライドのサイズ|背景の書式設定/;

const ocr = { on: true, worker: null, loading: null, queue: Promise.resolve() };

function setOcrState(text) { el.ocrBtn.textContent = `🔤 文字認識 ${text}`; }

function ensureOcr() {
  if (ocr.worker) return Promise.resolve(ocr.worker);
  ocr.loading ??= (async () => {
    setOcrState("準備中…");
    addLog("文字認識を準備中（初回は約2MBを読み込みます）");
    if (!window.Tesseract) {
      await new Promise((ok, ng) => {
        const s = document.createElement("script");
        s.src = TESSERACT_URL;
        s.onload = ok;
        s.onerror = () => ng(new Error("tesseract.js を読み込めませんでした"));
        document.head.append(s);
      });
    }
    const worker = await Tesseract.createWorker("jpn", 1, { langPath: OCR_LANG_PATH });
    // 画面のあちこちに散らばった文字を拾うモード（リボンやプレースホルダー向き）
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    ocr.worker = worker;
    setOcrState(ocr.on ? "ON" : "OFF");
    addLog("文字認識の準備ができました");
    return worker;
  })().catch((e) => {
    ocr.loading = null;
    ocr.on = false;
    setOcrState("OFF");
    render();
    addLog(`⚠ 文字認識を使えません: ${e.message}`);
    return null;
  });
  return ocr.loading;
}

// 今の画面の文字を読む（読めなければ null）。一度に1つずつ順番に処理する
//   text : 画面全体の文字（空白なし）
//   body : リボンより下の文字
//   words: [{ t, x0, y0, x1, y1 }]（位置は画面に対する割合 0〜1）
//   shot : 読んだ画面そのもの（色つき）。keepShot のときだけ。AI に見せる画像と番号札の位置を、同じ瞬間の画面にそろえるため
//   icons: アイコンだけのボタンの範囲 [{ x0, y0, x1, y1 }]（js/icons.js）。keepShot のときだけ（AI に番号札で選ばせるため）
function readScreen({ keepShot = false, icons = true } = {}) {
  const run = async () => {
    const worker = await ensureOcr();
    if (!worker || !state.stream) return null;
    const frame = await grabFrame();
    if (!frame) return null;
    const scale = Math.min(1, OCR_MAX_WIDTH / frame.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    let shot = null;
    if (keepShot) {
      shot = document.createElement("canvas");
      shot.width = canvas.width;
      shot.height = canvas.height;
      shot.getContext("2d").drawImage(frame.source, 0, 0, shot.width, shot.height);
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.filter = "grayscale(1)";
    ctx.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
    frame.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // アイコンは白黒にする前の明るさで探す（白黒にすると、暗い画面の灰色のアイコンが消える）
    const gray = keepShot && icons ? Uint8Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4]) : null;
    binarize(img);
    ctx.putImageData(img, 0, 0);
    const started = performance.now();
    const { data } = await worker.recognize(canvas);
    const words = data.words
      .map((w) => ({
        t: w.text.replace(/\s+/g, ""),
        x0: w.bbox.x0 / canvas.width, y0: w.bbox.y0 / canvas.height,
        x1: w.bbox.x1 / canvas.width, y1: w.bbox.y1 / canvas.height, c: w.confidence,
      }))
      .filter((w) => w.t);
    const read = { words, text: words.map((w) => w.t).join(""), w: canvas.width, h: canvas.height, shot, icons: [] };
    if (gray) {
      read.icons = findIcons(gray, canvas.width, canvas.height, words);
    }
    const ribbonBottom = Math.max(0, ...findAll(read, RIBBON_WORDS).filter((b) => b.y1 < 0.5).map((b) => b.y1));
    read.body = words.filter((w) => (w.y0 + w.y1) / 2 > ribbonBottom).map((w) => w.t).join("");
    el.ocrMeta.textContent = `（${((performance.now() - started) / 1000).toFixed(1)}秒・${read.text.length}文字）`;
    el.ocrText.textContent = read.text || "（文字が見つかりませんでした）";
    return read;
  };
  const result = ocr.queue.then(run, run).catch((e) => {
    addLog(`⚠ 文字認識エラー: ${e.message}`);
    return null;
  });
  ocr.queue = result;
  return result;
}

// 文字認識用に白黒にする（グレースケール済みの画像を書き換える）。
// - 決まった明るさ（OCR_BINARY）で分ける。薄い灰色のプレースホルダー（約136）は黒、点線枠（約170〜190）は白になる。
//   文字認識に任せると画面全体で境目を決めるため、黒い文字が増えると灰色の文字が白に飛んで読み落とす
// - 暗い背景に明るい文字（Photoshop・Premiere などのダーク画面、色付きのタイトルバーやボタン）も読めるよう、
//   OCR_TILE ピクセル四方の区画ごとに明るさの平均を見て、暗い区画では「平均より十分明るい部分」を文字（黒）にする。
//   単純に反転すると、中くらいの暗さの背景（赤いタイトルバーなど）が黒く塗りつぶされ、近くの行まで読み落とす
function binarize(img) {
  const { width: w, height: h, data: px } = img;
  for (let ty = 0; ty < h; ty += OCR_TILE) {
    for (let tx = 0; tx < w; tx += OCR_TILE) {
      const x1 = Math.min(tx + OCR_TILE, w), y1 = Math.min(ty + OCR_TILE, h);
      let sum = 0, white = 0;
      for (let y = ty; y < y1; y++) {
        for (let x = tx; x < x1; x++) {
          const v = px[(y * w + x) * 4];
          sum += v;
          if (v > 200) white++;
        }
      }
      const n = (x1 - tx) * (y1 - ty);
      const mean = sum / n;
      // 太い黒字が詰まった区画も平均は暗くなるが、白い背景が混ざるので「暗い背景」とは区別できる
      const dark = mean < OCR_DARK_TILE && white / n < OCR_DARK_WHITE_MAX;
      for (let y = ty; y < y1; y++) {
        for (let x = tx; x < x1; x++) {
          const i = (y * w + x) * 4;
          const ink = dark ? px[i] > mean + OCR_DARK_INK : px[i] < OCR_BINARY;
          px[i] = px[i + 1] = px[i + 2] = ink ? 0 : 255;
        }
      }
    }
  }
}

// 読んだ文字の中から正規表現に一致する場所をすべて探し、その範囲（割合）を返す。
// 文字認識は「新しい」「スラ」「イド」のように細切れで返すので、つなげて探してから位置をまとめる
function findAll(read, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const spans = [];
  let joined = "";
  for (const w of read.words) {
    spans.push({ start: joined.length, end: joined.length + w.t.length, w });
    joined += w.t;
  }
  const boxes = [];
  for (const m of joined.matchAll(g)) {
    if (!m[0]) continue;
    const hit = spans.filter((s) => s.end > m.index && s.start < m.index + m[0].length).map((s) => s.w);
    boxes.push({
      x0: Math.min(...hit.map((w) => w.x0)), y0: Math.min(...hit.map((w) => w.y0)),
      x1: Math.max(...hit.map((w) => w.x1)), y1: Math.max(...hit.map((w) => w.y1)),
    });
  }
  return boxes;
}

// ステップ開始時にあった文字（このステップ＋1つ前のステップ開始時。文字認識の読み落とし対策）
function stepBefore() { return [state.startRead, state.prevStartRead].filter(Boolean); }

// 文字の条件を満たしているか
function checkPassed(check, before, now) {
  if (check.appears && !check.appears.test(now.text)) return false;
  if (check.gone) {
    // 最初にあった文字が消えたことを確かめる（最初に読めていなければ判定しない）
    if (!before.some((r) => check.gone.test(r.text)) || check.gone.test(now.text)) return false;
  }
  if (check.grows) {
    if (!before.length) return false;
    if (newPairs(before.map((r) => r.body).join("|"), now.body) < check.grows) return false;
  }
  // 計画から作った手順: 次に押すボタンの名前などが新しく現れた、または押すタブに切り替わった
  if (check.newly || check.tab) {
    if (!before.length) return false;
    const appeared = check.newly?.some((re) => re.test(now.text) && !before.some((r) => re.test(r.text)));
    if (!appeared && !(check.tab && tabSwitched(before[0], now))) return false;
  }
  return true;
}

// 押すタブ（いま光らせている場所）の見た目が変わり、リボンの文字も入れ替わったか
function tabSwitched(before, now) {
  const box = state.target?.noBox ? null : state.target?.box;
  if (!box || !before.shot || !now.shot) return false;
  return newPairs(before.text, now.text) >= 6 && regionChanged(before.shot, now.shot, box);
}

// before になかった「2文字の並び」が now にいくつあるか。
// 文字数の差で比べると、文字認識がほかの場所を読み落としたときに増えた分が打ち消されるため
function newPairs(before, now) {
  const seen = new Set();
  for (let i = 0; i < before.length - 1; i++) seen.add(before.slice(i, i + 2));
  let count = 0;
  for (let i = 0; i < now.length - 1; i++) if (!seen.has(now.slice(i, i + 2))) count++;
  return count;
}

// ステップ開始時の画面の文字を読み、光らせる場所を探す（「消えた」「増えた」の比較にも使う）。
// 「現れた」だけの条件なら、この時点で満たしていればそのまま次へ進む
async function readStepStart(known = null) {
  const step = currentStep();
  if (!ocr.on || !state.stream || !step || !(step.check || step.targets)) return;
  const token = state.stepToken;
  const read = known ?? await readScreen(lesson().planned ? PLAN_READ : undefined);
  if (token !== state.stepToken || !read) return;
  state.startRead = read;
  if (step.skipIfVisible && plannedBox(read, step.skipIfVisible)) {
    addLog(`→ 「${step.skipIfVisible}」がもう見えているので、この手順は飛ばします`);
    completeStep("もう開いています", read);
    return;
  }
  updateTarget(read);
  if (step.check?.appears && !step.check.gone && !step.check.grows && checkPassed(step.check, [read], read)) {
    autoAdvance(read);
  }
}

el.ocrBtn.addEventListener("click", () => {
  ocr.on = !ocr.on;
  setOcrState(ocr.on ? "ON" : "OFF");
  if (!ocr.on) state.target = null;
  render();
  if (ocr.on && state.stream) readStepStart();
});

