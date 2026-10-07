// スライド先生 Office 版: Excel・Word・PowerPoint の文書の状態を読む係と、文書の中の場所を見せる係。
// どのアプリも同じ形（OfficeHost）にそろえて、案内の流れ（office-coach.js）からはアプリの違いを気にしない
//   name       : "Excel" | "Word" | "PowerPoint"
//   targetKind : AI に答えてもらう「文書の中の場所」の書き方
//   readState(): いまの状態を AI に渡す文章にする
//   show(target): その場所を選択して見せる（見せられたら true）
"use strict";

const MAX_CELLS = 40;     // 選択範囲の値は、左上からこの数のセルまで読む
const MAX_SHAPES = 15;    // スライドの図形は、この数まで読む
const MAX_PARAS = 30;     // 段落は、この数まで読む

const clip = (s, n = 40) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ─── Excel ────────────────────────────────────────
const ExcelHost = {
  name: "Excel",
  targetKind: "セル範囲を A1:C5 の形で（シートが違えば Sheet2!A1:C5 の形で）",
  async readState() {
    return Excel.run(async (ctx) => {
      const wb = ctx.workbook;
      const sheet = wb.worksheets.getActiveWorksheet();
      const sel = wb.getSelectedRange();
      const used = sheet.getUsedRangeOrNullObject(true);
      sheet.load("name");
      sel.load("address, rowCount, columnCount");
      sel.format.load("horizontalAlignment");
      sel.format.font.load("bold, italic, size, color");
      sel.format.fill.load("color");
      sel.format.borders.load("items/sideIndex, items/style");
      used.load("address");
      sheet.tables.load("items/name");
      sheet.charts.load("items/name, items/chartType");
      wb.worksheets.load("items/name");
      await ctx.sync();
      // 値は左上の一部だけ読む（大きな範囲を選ぶと重くなるため）
      const rows = Math.min(sel.rowCount, 8);
      const cols = Math.max(1, Math.min(sel.columnCount, Math.floor(MAX_CELLS / rows)));
      const peek = sel.getCell(0, 0).getResizedRange(rows - 1, cols - 1);
      peek.load("values");
      await ctx.sync();
      const borders = sel.format.borders.items.filter((b) => b.style && b.style !== "None").map((b) => b.sideIndex);
      const f = sel.format.font;
      return [
        `シート: ${sheet.name}（ブックのシート: ${wb.worksheets.items.map((s) => s.name).join("、")}）`,
        `選択範囲: ${sel.address}（${sel.rowCount}行×${sel.columnCount}列）`,
        `選択範囲の値（左上から）: ${JSON.stringify(peek.values.map((r) => r.map((v) => clip(v, 15))))}`,
        `選択範囲の書式: 太字=${f.bold ?? "混在"} 斜体=${f.italic ?? "混在"} 文字サイズ=${f.size ?? "混在"} 文字色=${f.color ?? "混在"}`
          + ` 塗りつぶし=${sel.format.fill.color ?? "混在"} 配置=${sel.format.horizontalAlignment ?? "混在"}`
          + ` 罫線=${borders.length ? borders.join("・") : "なし"}`,
        `入力されている範囲: ${used.isNullObject ? "なし（空のシート）" : used.address}`,
        `表（テーブル）: ${sheet.tables.items.map((t) => t.name).join("、") || "なし"}`,
        `グラフ: ${sheet.charts.items.map((c) => `${c.name}（${c.chartType}）`).join("、") || "なし"}`,
      ].join("\n");
    });
  },
  async show(target) {
    const m = String(target).trim().match(/^(?:'?([^'!]+)'?!)?\$?([A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i);
    if (!m) return false;
    return Excel.run(async (ctx) => {
      const sheet = m[1] ? ctx.workbook.worksheets.getItem(m[1]) : ctx.workbook.worksheets.getActiveWorksheet();
      if (m[1]) sheet.activate();
      sheet.getRange(m[2].replace(/\$/g, "")).select();
      await ctx.sync();
      return true;
    });
  },
};

// ─── Word ─────────────────────────────────────────
const WordHost = {
  name: "Word",
  targetKind: "操作する文章の一部を、文書の中の表記そのままで（20文字以内）",
  async readState() {
    return Word.run(async (ctx) => {
      const doc = ctx.document;
      const sel = doc.getSelection();
      sel.load("text, styleBuiltIn, alignment");
      sel.font.load("bold, italic, underline, size, color, highlightColor");
      const paras = doc.body.paragraphs;
      paras.load("items/text, items/styleBuiltIn");
      doc.body.tables.load("items/rowCount");
      doc.body.inlinePictures.load("items");
      await ctx.sync();
      const f = sel.font;
      const list = paras.items.slice(0, MAX_PARAS)
        .map((p, i) => `${i + 1}. [${p.styleBuiltIn}] ${clip(p.text)}`).join("\n");
      return [
        `選択中の文章: ${sel.text ? `「${clip(sel.text, 60)}」` : "（なし。カーソルだけ）"}`,
        `選択中の書式: スタイル=${sel.styleBuiltIn} 太字=${f.bold ?? "混在"} 斜体=${f.italic ?? "混在"} 下線=${f.underline ?? "混在"}`
          + ` 文字サイズ=${f.size ?? "混在"} 文字色=${f.color ?? "混在"} 蛍光ペン=${f.highlightColor ?? "なし"} 配置=${sel.alignment ?? "混在"}`,
        `段落（${paras.items.length}個${paras.items.length > MAX_PARAS ? `。最初の${MAX_PARAS}個` : ""}）:\n${list || "（空の文書）"}`,
        `表: ${doc.body.tables.items.length}個（${doc.body.tables.items.map((t) => `${t.rowCount}行`).join("、") || "なし"}）`,
        `画像: ${doc.body.inlinePictures.items.length}個`,
      ].join("\n");
    });
  },
  async show(target) {
    const text = String(target).trim().slice(0, 200);
    if (!text) return false;
    return Word.run(async (ctx) => {
      const found = ctx.document.body.search(text, { matchCase: false });
      found.load("items");
      await ctx.sync();
      if (!found.items.length) return false;
      found.items[0].select();
      await ctx.sync();
      return true;
    });
  },
};

// ─── PowerPoint ───────────────────────────────────
const PowerPointHost = {
  name: "PowerPoint",
  targetKind: "操作する図形の名前を、状態の一覧の表記そのままで（例: タイトル 1）",
  async readState() {
    return PowerPoint.run(async (ctx) => {
      const pres = ctx.presentation;
      pres.slides.load("items/id");
      const selSlides = pres.getSelectedSlides();
      selSlides.load("items/id");
      const selShapes = pres.getSelectedShapes();
      selShapes.load("items/name");
      await ctx.sync();
      const slide = selSlides.items[0] ?? pres.slides.items[0];
      if (!slide) return "スライド: なし";
      const index = pres.slides.items.findIndex((s) => s.id === slide.id) + 1;
      slide.shapes.load("items/id, items/name, items/type");
      slide.layout.load("name");
      await ctx.sync();
      const shapes = slide.shapes.items.slice(0, MAX_SHAPES);
      // 文字のない図形（画像など）の文字を読もうとすると失敗するので、1つずつ試す
      const texts = [];
      for (const sh of shapes) {
        try {
          sh.textFrame.textRange.load("text");
          await ctx.sync();
          texts.push(sh.textFrame.textRange.text);
        } catch {
          texts.push(null);
        }
      }
      const list = shapes.map((sh, i) =>
        `- ${sh.name}（${sh.type}）${texts[i] == null ? "" : texts[i] ? `: 「${clip(texts[i])}」` : ": （空）"}`).join("\n");
      return [
        `スライド: ${pres.slides.items.length}枚。いま ${index}枚目（レイアウト: ${slide.layout.name}）`,
        `選択中の図形: ${selShapes.items.map((s) => s.name).join("、") || "なし"}`,
        `${index}枚目の図形:\n${list || "（なし）"}`,
      ].join("\n");
    });
  },
  async show(target) {
    const name = String(target).trim();
    if (!name) return false;
    return PowerPoint.run(async (ctx) => {
      const sel = ctx.presentation.getSelectedSlides();
      sel.load("items/id");
      ctx.presentation.slides.load("items/id");
      await ctx.sync();
      const slide = sel.items[0] ?? ctx.presentation.slides.items[0];
      if (!slide) return false;
      slide.shapes.load("items/id, items/name");
      await ctx.sync();
      const shape = slide.shapes.items.find((s) => s.name === name) ?? slide.shapes.items.find((s) => s.name.includes(name));
      if (!shape) return false;
      ctx.presentation.setSelectedShapes([shape.id]);
      await ctx.sync();
      return true;
    });
  },
};

// Office.js の host 名から、読む係を選ぶ
function hostFor(officeHost) {
  return { [Office.HostType.Excel]: ExcelHost, [Office.HostType.Word]: WordHost, [Office.HostType.PowerPoint]: PowerPointHost }[officeHost] ?? null;
}
