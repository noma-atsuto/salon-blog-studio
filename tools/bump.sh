#!/bin/bash
# 公開前に版番号を更新する（ブラウザに古いファイルを使わせないため）
# 使い方: bash tools/bump.sh
set -e
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M)
sed -i '' -E "s#\?v=[0-9]+#?v=$V#g; s#(<meta name=\"sbs-version\" content=\")[0-9]*#\1$V#" index.html
printf '{ "version": "%s" }\n' "$V" > version.json
echo "版番号: $V"
