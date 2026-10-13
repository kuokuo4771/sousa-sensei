#!/bin/bash
# 拡張機能のサイドパネル（extension/sidepanel.html）を、自動テストつきの1ファイルにまとめる。
# Chrome の API は偽物（extension/sidepanel-selftest.js）に差し替わるので、拡張機能として入れなくても普通のタブで動く
# 使い方: tools/bundle-sidepanel.sh [出力先]（既定は dist/sidepanel-test.html）
set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-dist/sidepanel-test.html}"
mkdir -p "$(dirname "$out")"

script_tag='^ *<script src="([a-z/-]+\.js)"></script>$'
first=1
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $script_tag ]]; then
      if [[ $first == 1 ]]; then
        printf '<script>\n'; cat extension/sidepanel-selftest.js; printf '\n</script>\n'
        first=0
      fi
      printf '<script>\n'; cat "extension/${BASH_REMATCH[1]}"; printf '\n</script>\n'
    else
      printf '%s\n' "$line"
    fi
  done < extension/sidepanel.html
} > "$out"
echo "$out"
