#!/bin/bash
# Office アドインのマニフェストに、公開した場所の URL を書き込んだものを作る。
# 使い方: tools/set-office-url.sh https://ユーザー名.github.io/slide-sensei
#   → dist/manifest.xml ができる。これを Excel・Word・PowerPoint の wef フォルダに入れる（README 参照）
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -ne 1 || ! "$1" =~ ^https:// ]]; then
  echo "使い方: tools/set-office-url.sh https://ユーザー名.github.io/リポジトリ名" >&2
  exit 1
fi
base="${1%/}"
base="${base#https://}"
mkdir -p dist
sed "s|https://BASE_URL|https://${base}|g" office/manifest.xml > dist/manifest.xml
echo "dist/manifest.xml（${base}）"
