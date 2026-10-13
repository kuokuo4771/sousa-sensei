#!/bin/bash
# 本体と共用する部品（AI 連携・番号札）を、Chrome 拡張機能のフォルダへコピーする。
# 拡張機能はフォルダの外のファイルを読めないので、js/ai.js か js/som.js を直したら必ず実行すること。
# 使い方: tools/sync-extension.sh        （--check を付けると、コピーが古くなっていないかだけ確かめる）
set -euo pipefail
cd "$(dirname "$0")/.."

shared=(ai.js som.js)
if [[ "${1:-}" == "--check" ]]; then
  for f in "${shared[@]}"; do
    cmp -s "js/$f" "extension/shared/$f" || { echo "extension/shared/$f が古いです。tools/sync-extension.sh を実行してください" >&2; exit 1; }
  done
  echo "extension/shared は最新です"
  exit 0
fi
mkdir -p extension/shared
for f in "${shared[@]}"; do cp "js/$f" "extension/shared/$f"; done
echo "extension/shared に ${shared[*]} をコピーしました"
