#!/bin/bash
# 本物のソフトのスクリーンショット1枚で、AI に見せる番号札（文字とアイコン）がどう付くかを確かめるページを作る。
# 本体（index.html と js/*.js）と画像を1つの HTML にまとめるので、ダブルクリックで開くだけで動く（文字認識の部品は初回だけネットから読む）。
# 開くと、番号札を描いた画面と、札の一覧（文字・アイコンの数）を出す。結果は window.shotResult にも入る
# 使い方: tools/bundle-shot.sh スクリーンショット.png [出力先]（既定は dist/shot-test.html。png・jpg・webp）
set -euo pipefail
cd "$(dirname "$0")/.."

shot="${1:?スクリーンショットの画像を指定してください}"
out="${2:-dist/shot-test.html}"
case "${shot##*.}" in
  png|PNG) mime="image/png" ;;
  jpg|jpeg|JPG|JPEG) mime="image/jpeg" ;;
  webp|WEBP) mime="image/webp" ;;
  *) echo "png・jpg・webp の画像を指定してください" >&2; exit 1 ;;
esac

tmp="$(mktemp)"
tools/bundle.sh "$tmp" >/dev/null
{
  sed '/^<\/body>$/,$d' "$tmp"
  printf '<script>\nconst SHOT = "data:%s;base64,' "$mime"
  base64 < "$shot" | tr -d '\n'
  cat <<'EOF'
";
(async () => {
  const img = new Image();
  img.src = SHOT;
  await img.decode();
  // 画面共有の代わりに、このスクリーンショットを読む
  window.grabRawFrame = async () => ({ source: img, width: img.naturalWidth, height: img.naturalHeight, close() {} });
  state.stream = {};
  const r = await readScreen({ keepShot: true });
  state.stream = null;
  const items = buildItems(r);
  const { tagged } = tagImage({ source: r.shot, width: r.shot.width, height: r.shot.height }, items);
  const icons = items.filter((it) => it.icon);
  const texts = items.filter((it) => !it.icon);
  const info = document.createElement("p");
  info.style.cssText = "margin:8px;font:14px sans-serif";
  info.textContent = `文字の札 ${texts.length} 個・アイコンの札 ${icons.length} 個 — ${texts.map((it) => `[${it.id}]${it.text}`).join(" ")}`;
  tagged.style.cssText = "display:block;width:100%";
  document.body.replaceChildren(info, tagged);
  window.shotResult = {
    w: r.w, h: r.h,
    texts: texts.map((it) => ({ id: it.id, text: it.text, box: [it.x0, it.y0, it.x1, it.y1] })),
    icons: icons.map((it) => ({ id: it.id, box: [it.x0, it.y0, it.x1, it.y1] })),
  };
})();
</script>
</body>
</html>
EOF
} > "$out"
rm -f "$tmp"
echo "$out"
