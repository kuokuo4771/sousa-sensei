#!/bin/bash
# Office アドインの作業ウィンドウ（office/taskpane.html）を、自動テストつきの1ファイルにまとめる。
# Office の外（普通のタブ）でも、偽の Excel・Word・PowerPoint でテストが走る
# 使い方: tools/bundle-office.sh [出力先]（既定は dist/office-test.html）
set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-dist/office-test.html}"
mkdir -p "$(dirname "$out")"

script_tag='^ *<script src="([a-z./-]+\.js)"></script>$'
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $script_tag ]]; then
      src="${BASH_REMATCH[1]}"
      if [[ "$src" == ../* ]]; then src="${src#../}"; else src="office/$src"; fi
      printf '<script>\n'; cat "$src"; printf '\n</script>\n'
    elif [[ "$line" == "</body>" ]]; then
      printf '<script>\n'; cat office/office-selftest.js; printf '\n</script>\n%s\n' "$line"
    else
      printf '%s\n' "$line"
    fi
  done < office/taskpane.html
} > "$out"
echo "$out"
