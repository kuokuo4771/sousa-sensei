#!/bin/bash
# index.html と js/*.js を1つの HTML ファイルにまとめる。
#   - 1ファイルで配りたいとき（メールで送る、USB で渡すなど）
#   - 別ファイルの読み込みができない環境で動作確認したいとき
# 使い方: tools/bundle.sh [--test] [出力先]
#   出力先の既定は dist/sousa-sensei.html。--test を付けると自動テスト（js/selftest.js）も入れる
set -euo pipefail
cd "$(dirname "$0")/.."

out="dist/sousa-sensei.html"
with_test=0
for arg in "$@"; do
  case "$arg" in
    --test) with_test=1 ;;
    *) out="$arg" ;;
  esac
done
mkdir -p "$(dirname "$out")"

script_tag='^<script src="(js/[a-z]+\.js)"></script>$'
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $script_tag ]]; then
      printf '<script>\n'
      cat "${BASH_REMATCH[1]}"
      printf '\n</script>\n'
    elif [[ "$line" == "</body>" && $with_test == 1 ]]; then
      printf '<script>\n'
      cat js/selftest.js
      printf '\n</script>\n%s\n' "$line"
    else
      printf '%s\n' "$line"
    fi
  done < index.html
} > "$out"
echo "$out"
