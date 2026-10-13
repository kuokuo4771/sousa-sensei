#!/bin/bash
# 読み取り係（extension/web-agent.js）の自動テストを、練習ページ（practice-colab.html）と1ファイルにまとめる。
# 拡張機能とのやりとりは偽物（extension/agent-selftest.js）に差し替わるので、普通のタブで動く
# 使い方: tools/bundle-agent.sh [出力先]（既定は dist/agent-test.html）
set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-dist/agent-test.html}"
mkdir -p "$(dirname "$out")"
{
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "</body>" ]]; then
      printf '<script>\n'; cat extension/agent-selftest.js; printf '\n</script>\n'
      printf '<script>\n'; cat extension/web-agent.js; printf '\n</script>\n'
    fi
    printf '%s\n' "$line"
  done < practice-colab.html
} > "$out"
echo "$out"
