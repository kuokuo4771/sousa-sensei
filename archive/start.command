#!/bin/bash

# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

echo "=== 🔮 AI Screen Guide Setup & Launcher ==="
echo "Python環境をチェックしています..."

# Python3がインストールされているか確認
if ! command -v python3 &> /dev/null
then
    echo "エラー: python3 が見つかりません。Pythonをインストールしてください。"
    exit 1
fi

VENV_DIR="venv"

# 仮想環境が存在しない場合は作成
if [ ! -d "$VENV_DIR" ]; then
    echo "仮想環境 ($VENV_DIR) を作成しています..."
    python3 -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo "警告: 仮想環境の作成に失敗しました。システムの python3 で起動します。"
        VENV_DIR=""
    fi
fi

# 仮想環境をアクティベート
if [ -n "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
else
    echo "警告: 仮想環境が使えません。システムの python3 で起動します。"
    VENV_DIR=""
fi

# pipの有無を確認
if python3 -m pip --version > /dev/null 2>&1; then
    # pipのアップグレード
    echo "pipを更新しています..."
    python3 -m pip install --upgrade pip > /dev/null 2>&1

    # 依存パッケージのインストール
    echo "必要なパッケージをインストールしています..."
    python3 -m pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "警告: パッケージのインストールに失敗しました。診断画面を起動します。"
    fi
else
    echo "警告: pip が利用できません。診断画面を起動します。"
fi

echo "==========================================="
echo "✅ アプリを起動します..."
echo "==========================================="

# アプリケーションの起動
python3 main.py

# アプリ終了後、仮想環境を抜ける
if [ -n "$VENV_DIR" ]; then
    deactivate
fi
