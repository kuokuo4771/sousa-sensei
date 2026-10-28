// そうさ先生: アイコンだけのボタン（文字のないボタン）を画像から見つける。
// Blender・Illustrator・Photoshop などのツールバーは文字がなく、文字認識では番号札を付けられない。
// そこで「まわりと色が違う、ボタンくらいの大きさの形が、同じ大きさで縦か横に並んでいる所」をアイコンとみなし、
// 番号札を付けて AI に選ばせる（位置は画像から求めた値を使うので、AI に座標を推定させるより外れにくい）

const ICON_EDGE = 28;          // となりの点との明るさの差がこれ以上なら「形のふち」とみなす (0-255)
const ICON_JOIN = 2;           // ふちをこのピクセル数だけ太らせて、1つのアイコンの線をつなげる
const ICON_MIN = 10;           // アイコンの大きさ（1920px 幅の画面でのピクセル。画面の大きさに合わせて伸び縮みする）
const ICON_MAX = 56;
const ICON_ASPECT = 2.2;       // 縦横比がこれより細長いものは、アイコンではなく線や文字の並びとみなす
const ICON_FILL_MIN = 0.08;    // 範囲のうち、ふちの点がこの割合未満なら（角や線だけ）除く
const ICON_RING = 0.5;         // まわりの帯（大きさのこの割合の幅）を見て、背景が平らかを確かめる（模様の中で切り離された形のすぐ外の、すき間より太く）
const ICON_RING_MAX = 0.12;    // まわりの帯のうち、ふちの点がこの割合以上なら（写真や模様の一部）除く
const ICON_ALIGN = 0.25;       // 並んでいるとみなす中心のずれ（大きさに対する割合）
const ICON_GAP = 3;            // 並びの中で、となりのアイコンとの間がこれ（大きさの何倍）以内
const ICON_GROUP = 3;          // この数以上そろって並んでいるものだけをアイコンとみなす
const ICON_LIMIT = 40;         // 1画面で番号札を付けるアイコンの数の上限
const ICON_TEXT_CONF = 60;     // 文字認識の自信度（0-100）がこれ以上の単語だけを本物の文字とみなす
const ICON_TEXT_SURE = 85;     // 自信度がこれ以上なら、アイコンの候補を2つ以上またいでも本物の文字（大きな字は1文字ずつが候補になる）

// gray: 明るさ（0-255）の配列（幅 w × 高さ h）。words: 文字認識の単語 [{ t, c（自信度）, x0, y0, x1, y1 }]（割合 0〜1）
// 返り値: アイコンの範囲 [{ x0, y0, x1, y1 }]（割合 0〜1。上から下、左から右の順）
function findIcons(gray, w, h, words = []) {
  const s = w / 1920;
  const minS = ICON_MIN * s, maxS = ICON_MAX * s;

  // 1. 形のふち（右・下のとなりとの明るさの差が大きい点）
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x, v = gray[i];
      if (Math.abs(v - gray[i + 1]) >= ICON_EDGE || Math.abs(v - gray[i + w]) >= ICON_EDGE) edge[i] = 1;
    }
  }

  // 2. ふちを少し太らせて、1つのアイコンの中の離れた線どうしをつなげる（横→縦の順）
  const r = Math.max(1, Math.round(ICON_JOIN * s));
  const wide = new Uint8Array(w * h), fat = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (edge[y * w + x]) last = x;
      else if (x - last <= r) wide[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (edge[y * w + x]) { last = x; wide[y * w + x] = 1; } else if (last - x <= r) wide[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (wide[y * w + x]) { last = y; fat[y * w + x] = 1; } else if (y - last <= r) fat[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) if (wide[y * w + x]) last = y; else if (last - y <= r) fat[y * w + x] = 1;
  }

  // 3. つながった形ごとに範囲を求める（太らせた分は範囲から差し引く）
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs = [];
  for (let start = 0; start < w * h; start++) {
    if (!fat[start] || seen[start]) continue;
    let top = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, ink = 0, big = false;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top], x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (edge[i]) ink++;
      if (x1 - x0 > maxS * 3 || y1 - y0 > maxS * 3) big = true;   // 大きすぎる形はもう数えない（範囲だけ広げて捨てる）
      if (x > 0 && fat[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && fat[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && fat[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && fat[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (big) continue;
    x0 += r; y0 += r; x1 -= r; y1 -= r;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minS || bh < minS || bw > maxS || bh > maxS) continue;
    if (Math.max(bw, bh) / Math.min(bw, bh) > ICON_ASPECT) continue;
    if (ink / (bw * bh) < ICON_FILL_MIN) continue;
    if (busyAround(edge, w, h, x0, y0, x1, y1)) continue;
    blobs.push({ x0, y0, x1, y1, size: Math.max(bw, bh), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
  }

  // 4. 本物の文字の上にあるもの（文字をアイコンと見誤ったもの）を除く。
  //    文字認識はアイコンの列も「OS」「エグ」のような文字と読むので、どの単語を本物の文字とみなすかは realText で決める
  const px = words.map((t) => ({ x0: t.x0 * w - 3, y0: t.y0 * h - 3, x1: (t.x1 * w) + 3, y1: (t.y1 * h) + 3 }));
  const real = words.map((t, k) => realText(t, blobs.filter((b) => coverage(b, px[k]) > 0.3).length));
  const onText = (b) => px.some((t, k) => real[k] && coverage(b, t) > 0.3);
  // ボタンの枠の中にアイコンの線があるときは、外側（ボタン全体）だけを残す
  const inside = (a, b) => a !== b && a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;
  let cand = blobs.filter((b) => !onText(b));
  cand = cand.filter((a) => !cand.some((b) => inside(a, b)));

  // 5. 同じくらいの大きさで、縦か横にそろって並んでいるもの（ツールバー）だけを残す
  const similar = (a, b) => Math.max(a.size, b.size) / Math.min(a.size, b.size) < 1.6;
  const keep = new Set();
  for (const axis of ["row", "col"]) {
    const visited = new Set();
    for (const a of cand) {
      if (visited.has(a)) continue;
      // a と同じ並び（行なら中心の高さ、列なら中心の横位置がそろう）を、間が空きすぎない範囲でたどる
      const group = [a];
      visited.add(a);
      for (let k = 0; k < group.length; k++) {
        const g = group[k];
        for (const b of cand) {
          if (visited.has(b) || !similar(g, b)) continue;
          const tol = ICON_ALIGN * Math.max(g.size, b.size);
          const aligned = axis === "row" ? Math.abs(g.cy - b.cy) <= tol : Math.abs(g.cx - b.cx) <= tol;
          const gap = axis === "row" ? Math.abs(g.cx - b.cx) : Math.abs(g.cy - b.cy);
          if (aligned && gap <= ICON_GAP * Math.max(g.size, b.size)) { visited.add(b); group.push(b); }
        }
      }
      if (group.length >= ICON_GROUP) group.forEach((b) => keep.add(b));
    }
  }

  return [...keep]
    .sort((a, b) => (Math.abs(a.cy - b.cy) < a.size / 2 ? a.cx - b.cx : a.cy - b.cy))
    .slice(0, ICON_LIMIT)
    .map((b) => ({ x0: b.x0 / w, y0: b.y0 / h, x1: (b.x1 + 1) / w, y1: (b.y1 + 1) / h }));
}

// 範囲のまわりの細い帯に、ふちの点がどれだけあるか。アイコンはツールバーの平らな地の上にあるが、
// 写真や模様の一部は、まわりも細かい模様だらけになる
function busyAround(edge, w, h, x0, y0, x1, y1) {
  const m = Math.max(4, Math.round(ICON_RING * Math.max(x1 - x0, y1 - y0)));
  const ax = Math.max(0, x0 - m), ay = Math.max(0, y0 - m), bx = Math.min(w - 1, x1 + m), by = Math.min(h - 1, y1 + m);
  let n = 0, ink = 0;
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      n++;
      ink += edge[y * w + x];
    }
  }
  return n > 0 && ink / n >= ICON_RING_MAX;
}

// 範囲 a のうち、範囲 b と重なる部分の割合（0〜1）
function coverage(a, b) {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const area = (a.x1 - a.x0) * (a.y1 - a.y0);
  return ox > 0 && oy > 0 && area > 0 ? (ox * oy) / area : 0;
}

// 文字認識の単語が、本物の文字か（アイコンの読み違いでないか）。
// 2文字以上で、自信度が高い。アイコンの候補を2つ以上またぐ（アイコンの列をまとめて1語と読んだらしい）ときは、
// 自信度がとても高いときだけ（「タイトルを入力」のような大きな字は、1文字ずつがアイコンくらいの大きさになる）
function realText(word, iconsUnder) {
  const letters = (word.t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const conf = word.c ?? 100;
  return letters >= 2 && conf >= ICON_TEXT_CONF && (iconsUnder <= 1 || conf >= ICON_TEXT_SURE);
}

// アイコンの上にある、アイコンの読み違いの単語を除く（番号札に「らら」「OGA」のような意味のない文字を出さないため）
function dropMisreadIcons(words, icons) {
  if (!icons.length) return words;
  return words.filter((t) => {
    const under = icons.filter((b) => coverage(b, t) > 0.3 || coverage(t, b) > 0.3);
    const covered = icons.reduce((sum, b) => sum + coverage(t, b), 0);
    // 文字認識は読み違いの範囲を細長く返すことが多いので、少しでも（15%）アイコンに重なれば除く
    return covered <= 0.15 || realText(t, under.length);
  });
}
