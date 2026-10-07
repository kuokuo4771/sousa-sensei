"""
スライド先生 (SlideSensei) — スタンドアロン版
──────────────────────────────────────────────────
pip / venv / 外部パッケージ **不要**。Python 3.9 標準搭載モジュールのみで動作。

- 画面キャプチャ:   macOS 標準の `screencapture` コマンド
- HTTP:             urllib (標準)
- UI:               tkinter (標準)
- AI:               Google Gemini REST API を直接呼び出し

起動:   python3 main.py
"""
from __future__ import annotations

import base64
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import time
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk
from typing import Optional
from urllib import error as urlerror
from urllib import request as urlrequest

APP_NAME = "スライド先生"
CONFIG_DIR = pathlib.Path.home() / ".sousanavi"
CONFIG_FILE = CONFIG_DIR / "config.json"
MODEL_NAME = "gemini-2.0-flash"
API_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{MODEL_NAME}:generateContent"
)

POWERPOINT_PROCESS_NAMES = ["Microsoft PowerPoint", "PowerPoint"]

# ─── レッスン定義 ─────────────────────────────────────────
LESSONS = {
    "first-slide": {
        "name": "はじめてのスライド",
        "goal": "PowerPointを開き、タイトル付きのスライドを1枚仕上げ、2枚目を追加する。",
        "steps": [
            "PowerPointで新規プレゼンテーションを開く（既に開いていればOK）",
            "スライド上部の「タイトルを入力」枠をクリック",
            "タイトルを入力する（例:「新しい企画のご提案」）",
            "「サブタイトルを入力」枠をクリックし、1〜2文入力する",
            "リボンの「ホーム」タブから「新しいスライド」を追加する",
        ],
    },
    "insert-shape": {
        "name": "図形を使いこなす",
        "goal": "挿入タブから四角形などの図形を追加し、色を変えて見た目を整える。",
        "steps": [
            "リボンの「挿入」タブに切り替える",
            "「図形」ボタンから四角形を選んでスライドに追加する",
            "追加した図形を選択した状態で「図形の書式」から色を変える",
            "図形の位置を中央付近にドラッグして整える",
        ],
    },
    "design-theme": {
        "name": "見やすいデザインテーマ",
        "goal": "デザインタブでテーマを切り替え、スライド全体の印象を整える。",
        "steps": [
            "リボンの「デザイン」タブに切り替える",
            "テーマ一覧から候補を1つ選んで適用する",
            "別のテーマもプレビューして比較する",
            "最終的に使うテーマを1つに決める",
        ],
    },
}


# ─── 設定 ────────────────────────────────────────────────
def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── PowerPoint 検出 ─────────────────────────────────────
def frontmost_app_name() -> str:
    try:
        out = subprocess.check_output(
            ["osascript", "-e",
             'tell application "System Events" to get name of first application process whose frontmost is true'],
            stderr=subprocess.DEVNULL, timeout=1.5,
        )
        return out.decode("utf-8").strip()
    except Exception:
        return ""


def powerpoint_window_bounds() -> Optional[tuple[int, int, int, int]]:
    script = (
        'tell application "System Events"\n'
        '  set procs to every application process whose frontmost is true\n'
        '  if (count of procs) = 0 then return ""\n'
        '  set p to item 1 of procs\n'
        '  set nm to name of p\n'
        '  if nm does not contain "PowerPoint" then return ""\n'
        '  try\n'
        '    set w to window 1 of p\n'
        '    set pos to position of w\n'
        '    set sz to size of w\n'
        '    return (item 1 of pos as string) & "," & (item 2 of pos as string) & "," & '
        '           (item 1 of sz as string) & "," & (item 2 of sz as string)\n'
        '  on error\n'
        '    return ""\n'
        '  end try\n'
        'end tell'
    )
    try:
        out = subprocess.check_output(["osascript", "-e", script],
                                      stderr=subprocess.DEVNULL, timeout=2)
        s = out.decode("utf-8").strip()
        if not s:
            return None
        x, y, w, h = [int(v) for v in s.split(",")]
        if w <= 0 or h <= 0:
            return None
        return x, y, w, h
    except Exception:
        return None


# ─── 画面キャプチャ (screencapture コマンド) ─────────────
def capture_region(bounds: Optional[tuple[int, int, int, int]]) -> Optional[bytes]:
    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    path = tmp.name
    try:
        cmd = ["screencapture", "-x", "-t", "jpg"]
        if bounds is not None:
            x, y, w, h = bounds
            cmd += ["-R", f"{x},{y},{w},{h}"]
        cmd += [path]
        r = subprocess.run(cmd, timeout=5, stderr=subprocess.DEVNULL)
        if r.returncode != 0:
            return None
        with open(path, "rb") as f:
            return f.read()
    except Exception:
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def bytes_similar(a: Optional[bytes], b: Optional[bytes], sample_step: int = 512) -> bool:
    """粗いサンプリングで JPEG バイト列を比較。全く同じなら True。"""
    if a is None or b is None:
        return False
    if len(a) != len(b):
        return False
    # 全長一致でもさらに一部サンプル
    if a == b:
        return True
    return False


# ─── Gemini REST 呼び出し ────────────────────────────────
GUIDE_SYSTEM_PROMPT = """あなたは PowerPoint の使い方を日本語で1手ずつ教えるチューターです。
ユーザーの実画面のスクリーンショットと、現在のレッスンの目標・全ステップ・
「現在案内中のステップ番号」を与えます。あなたの仕事:

1. 画面の状態を短く判定
2. 現在ステップが完了しているか判定
3. 完了していなければ次にすべき「たった一手」を短く指示
4. 迷いそうな部分に短い補足を添える
5. 押すべきボタン / クリックすべき領域が画像内で特定できる場合、その位置を
   画像内の正規化座標（左上 (0,0) 右下 (1,1)）で返す

以下の JSON のみ、余計な文字を付けず返してください:

{
  "screen_state": "<画面状態を1文>",
  "current_step_done": true|false,
  "guidance": "<次にすべき一手（1〜2文）>",
  "hint": "<補足があれば1文、無ければ空文字>",
  "confidence": <0.0〜1.0>,
  "lesson_complete": true|false,
  "target_bbox": {"x": <0.0-1.0>, "y": <0.0-1.0>,
                  "w": <0.0-1.0>, "h": <0.0-1.0>} or null,
  "target_label": "<何を指しているか短く。例: 新しいスライドボタン>"
}

target_bbox は自信がある時だけ返し、不明な時は null にしてください。
"""


class Guidance:
    def __init__(self, screen_state="", guidance="", hint="",
                 confidence=0.0, current_step_done=False,
                 lesson_complete=False, target_bbox=None,
                 target_label="", error=None):
        self.screen_state = screen_state
        self.guidance = guidance
        self.hint = hint
        self.confidence = confidence
        self.current_step_done = current_step_done
        self.lesson_complete = lesson_complete
        self.target_bbox = target_bbox  # (x, y, w, h) normalized 0-1 or None
        self.target_label = target_label
        self.error = error


def call_gemini(api_key: str, image_bytes: bytes, lesson: dict, step_index: int) -> Guidance:
    steps_txt = "\n".join(f"{i+1}. {s}" for i, s in enumerate(lesson["steps"]))
    user_text = (
        f"{GUIDE_SYSTEM_PROMPT}\n\n"
        f"レッスン名: {lesson['name']}\n"
        f"目標: {lesson['goal']}\n"
        f"全ステップ:\n{steps_txt}\n\n"
        f"現在案内中のステップ番号: {step_index + 1}\n"
        f"JSONのみを返答してください。"
    )
    body = {
        "contents": [{
            "parts": [
                {"text": user_text},
                {"inline_data": {
                    "mime_type": "image/jpeg",
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }
    url = f"{API_ENDPOINT}?key={api_key}"
    req = urlrequest.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(text)
        bbox = data.get("target_bbox")
        parsed_bbox = None
        if isinstance(bbox, dict):
            try:
                x = float(bbox.get("x", -1))
                y = float(bbox.get("y", -1))
                w = float(bbox.get("w", -1))
                h = float(bbox.get("h", -1))
                if 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0:
                    parsed_bbox = (x, y, w, h)
            except (TypeError, ValueError):
                parsed_bbox = None
        return Guidance(
            screen_state=str(data.get("screen_state", "")),
            guidance=str(data.get("guidance", "")),
            hint=str(data.get("hint", "")),
            confidence=float(data.get("confidence", 0.5)),
            current_step_done=bool(data.get("current_step_done", False)),
            lesson_complete=bool(data.get("lesson_complete", False)),
            target_bbox=parsed_bbox,
            target_label=str(data.get("target_label", "")),
        )
    except urlerror.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="ignore")[:200]
        return Guidance(error=f"HTTP {e.code}: {body_txt}")
    except Exception as e:
        return Guidance(error=f"AI応答エラー: {e}")


# ─── バックグラウンド ワーカ ─────────────────────────────
class WorkerState:
    def __init__(self):
        self.running = True
        self.paused = False
        self.interval = 4.0
        self.lesson_id = "first-slide"
        self.step_index = 0
        self.force_analyze = False
        self.api_key: Optional[str] = None


class AnalysisWorker(threading.Thread):
    def __init__(self, state: WorkerState, out_queue: queue.Queue):
        super().__init__(daemon=True)
        self.state = state
        self.out = out_queue
        self._last_bytes: Optional[bytes] = None

    def _emit(self, kind: str, **payload):
        self.out.put({"kind": kind, **payload})

    def run(self):
        while self.state.running:
            try:
                if self.state.paused:
                    time.sleep(0.3); continue
                bounds = powerpoint_window_bounds()
                if bounds is None:
                    self._emit("status", text="PowerPointをフォアグラウンドにしてください", ok=False)
                    time.sleep(1.5); continue

                img = capture_region(bounds)
                if img is None:
                    self._emit("status",
                               text="画面キャプチャ失敗（画面収録の許可を確認）", ok=False)
                    time.sleep(2.0); continue

                force = self.state.force_analyze
                self.state.force_analyze = False
                if bytes_similar(self._last_bytes, img) and not force:
                    self._emit("status", text="監視中（画面変化なし）", ok=True)
                    time.sleep(self.state.interval); continue

                self._last_bytes = img
                self._emit("status", text="AIが画面を解析中…", ok=True)

                if not self.state.api_key:
                    self._emit("guidance", guidance=Guidance(
                        error="APIキーが未設定です。⚙ボタンから設定してください。"),
                        ppt_bounds=bounds)
                    time.sleep(2.0); continue

                lesson = LESSONS[self.state.lesson_id]
                g = call_gemini(self.state.api_key, img, lesson, self.state.step_index)
                self._emit("guidance", guidance=g, ppt_bounds=bounds)
                self._emit("status", text="監視中", ok=True)
                time.sleep(self.state.interval)
            except Exception as e:
                self._emit("status", text=f"エラー: {e}", ok=False)
                time.sleep(2.0)


# ─── 対象箇所を指し示すオーバーレイ (矢印+枠) ────────────
class TargetOverlay:
    """
    PowerPoint 画面上のターゲット位置を赤い矢印と枠で強調する。
    - 枠: 4本の細いボーダレス Toplevel を target の四辺に配置
          （中央は空なので、実際のボタンクリックを妨げない）
    - 矢印: 追加の小さな Toplevel（60x60）を枠の外側に置き、
            Canvas で赤い矢印を描画。ラベルもここに載せる。
    位置はスクリーン座標 (points)。screen_w/h が None なら
    右にはみ出しの判定はスキップ。
    """
    BORDER_THICK = 3
    ARROW_SIZE = 64

    def __init__(self, root: tk.Tk):
        self.root = root
        self.borders = []  # 4本
        self.arrow = None
        self.canvas = None
        self.label = None
        self.visible = False
        self._create_windows()

    def _mk_toplevel(self, w: int, h: int) -> tk.Toplevel:
        top = tk.Toplevel(self.root)
        top.withdraw()
        top.overrideredirect(True)  # ボーダー / タイトルバーなし
        top.attributes("-topmost", True)
        try:
            top.attributes("-alpha", 0.9)
        except tk.TclError:
            pass
        top.configure(bg=ACCENT)
        top.geometry(f"{w}x{h}+0+0")
        return top

    def _create_windows(self):
        # 4本のボーダー窓
        for _ in range(4):
            self.borders.append(self._mk_toplevel(10, 10))

        # 矢印窓
        self.arrow = self._mk_toplevel(180, self.ARROW_SIZE)
        self.arrow.configure(bg="#FFFFFF")
        try:
            self.arrow.attributes("-alpha", 0.95)
        except tk.TclError:
            pass
        self.canvas = tk.Canvas(self.arrow, width=self.ARROW_SIZE,
                                height=self.ARROW_SIZE,
                                bg="#FFFFFF", highlightthickness=0, bd=0)
        self.canvas.pack(side="left")
        self.label = tk.Label(self.arrow, text="", bg="#FFFFFF",
                              fg=ACCENT, font=("Hiragino Sans", 11, "bold"),
                              padx=8)
        self.label.pack(side="left", fill="y")

    def hide(self):
        if not self.visible:
            return
        for b in self.borders:
            b.withdraw()
        self.arrow.withdraw()
        self.visible = False

    def show(self, screen_bounds: tuple[int, int, int, int],
             ppt_bounds: tuple[int, int, int, int],
             target_label: str = ""):
        """
        screen_bounds: (x, y, w, h) — ターゲット領域の実スクリーン座標
        ppt_bounds:    PowerPoint ウインドウ全体の (x, y, w, h)
        target_label:  「新しいスライド」等のラベル
        """
        x, y, w, h = screen_bounds
        t = self.BORDER_THICK

        # ────── 4本のボーダー窓を配置 ──────
        # 上
        self.borders[0].geometry(f"{w + 2*t}x{t}+{x - t}+{y - t}")
        # 下
        self.borders[1].geometry(f"{w + 2*t}x{t}+{x - t}+{y + h}")
        # 左
        self.borders[2].geometry(f"{t}x{h + 2*t}+{x - t}+{y - t}")
        # 右
        self.borders[3].geometry(f"{t}x{h + 2*t}+{x + w}+{y - t}")

        for b in self.borders:
            b.deiconify()

        # ────── 矢印窓の配置と描画 ──────
        # 画面幅を推定（PowerPointウインドウの右端＋余白 or root画面幅）
        try:
            sw = self.root.winfo_screenwidth()
        except tk.TclError:
            sw = 1920

        # ターゲットが画面右半分に近ければ左向き矢印を左側に置く
        # 左半分ならターゲットの右側に右向き矢印を置くと目立たないので、
        # 常に「ターゲットの中心に向かって矢印を伸ばす」向きで、
        # ターゲットの真下 or 真上に置く戦略にする。
        arrow_h = self.ARROW_SIZE
        # ラベル幅を反映（推定）
        est_label_w = max(0, min(len(target_label) * 14, 200))
        total_w = self.ARROW_SIZE + est_label_w + 12
        cx = x + w // 2

        # 縦位置: ターゲットの下（画面下端に余裕がなければ上）
        arrow_y = y + h + 8
        pointing = "up"  # 矢印が指す方向
        # 画面高さ取得
        try:
            sh = self.root.winfo_screenheight()
        except tk.TclError:
            sh = 1200
        if arrow_y + arrow_h > sh - 20:
            arrow_y = y - arrow_h - 8
            pointing = "down"

        arrow_x = max(8, min(cx - total_w // 2, sw - total_w - 8))

        self.arrow.geometry(f"{total_w}x{arrow_h}+{arrow_x}+{arrow_y}")
        self.label.configure(text=target_label or "ここをクリック")

        # 矢印描画
        c = self.canvas
        c.delete("all")
        s = self.ARROW_SIZE
        # 白背景に赤い太矢印
        pad = 10
        if pointing == "up":
            # 上向き矢印
            c.create_polygon(
                s // 2, pad,                       # 頂点
                s - pad, s // 2,                   # 右
                s // 2 + 6, s // 2,                # 右軸接続
                s // 2 + 6, s - pad,               # 右下
                s // 2 - 6, s - pad,               # 左下
                s // 2 - 6, s // 2,                # 左軸接続
                pad, s // 2,                       # 左
                fill=ACCENT, outline="white", width=2,
            )
        else:
            # 下向き矢印
            c.create_polygon(
                s // 2, s - pad,                   # 頂点
                s - pad, s // 2,                   # 右
                s // 2 + 6, s // 2,                # 右軸接続
                s // 2 + 6, pad,                   # 右上
                s // 2 - 6, pad,                   # 左上
                s // 2 - 6, s // 2,                # 左軸接続
                pad, s // 2,                       # 左
                fill=ACCENT, outline="white", width=2,
            )
        self.arrow.deiconify()
        self.visible = True


def bbox_to_screen(bbox: tuple[float, float, float, float],
                   ppt: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """正規化 bbox を実スクリーン座標に変換。"""
    x, y, w, h = bbox
    px, py, pw, ph = ppt
    sx = int(px + x * pw)
    sy = int(py + y * ph)
    sw = max(20, int(w * pw))
    sh = max(20, int(h * ph))
    return sx, sy, sw, sh


# ─── UI (tkinter 標準) ──────────────────────────────────
BG        = "#F8F5EE"
PANEL     = "#FFFFFF"
INK       = "#1B1D22"
MUTED     = "#616874"
BORDER    = "#E6E1D5"
ACCENT    = "#C0442B"
AI        = "#2E6BA0"
SUCCESS   = "#4E7B4A"
WARN      = "#B7791F"


class SetupDialog(tk.Toplevel):
    def __init__(self, parent, on_saved):
        super().__init__(parent)
        self.title(f"{APP_NAME} — 初回設定")
        self.geometry("460x280")
        self.configure(bg=PANEL)
        self.attributes("-topmost", True)
        self.on_saved = on_saved

        f_title = tkfont.Font(family="Hiragino Sans", size=16, weight="bold")
        f_body  = tkfont.Font(family="Hiragino Sans", size=12)
        f_small = tkfont.Font(family="Hiragino Sans", size=11)

        tk.Label(self, text=f"{APP_NAME} へようこそ", bg=PANEL, fg=INK, font=f_title,
                 pady=6).pack(pady=(14, 0))
        tk.Label(self,
                 text="AI解析には Google Gemini の無料APIキーが必要です。\n"
                      "https://aistudio.google.com/apikey で取得できます。",
                 bg=PANEL, fg=MUTED, font=f_small, justify="left").pack(pady=(4, 10), padx=20)

        self.entry = tk.Entry(self, width=48, font=f_body,
                              highlightthickness=1, highlightbackground=BORDER,
                              highlightcolor=ACCENT, relief="flat")
        self.entry.pack(pady=6, padx=20, ipady=6)
        self.entry.focus()

        self.msg = tk.Label(self, text="", bg=PANEL, fg=WARN, font=f_small)
        self.msg.pack()

        btns = tk.Frame(self, bg=PANEL)
        btns.pack(pady=14)
        b1 = tk.Button(btns, text="保存して続行", command=self._save,
                       bg=ACCENT, fg="white", font=f_body, relief="flat",
                       activebackground="#9E351F", activeforeground="white",
                       padx=16, pady=6, borderwidth=0, highlightthickness=0)
        b1.pack(side="left", padx=6)
        b2 = tk.Button(btns, text="あとで", command=self.destroy,
                       bg=PANEL, fg=INK, font=f_body, relief="flat",
                       padx=16, pady=6, borderwidth=1, highlightbackground=BORDER)
        b2.pack(side="left", padx=6)

    def _save(self):
        key = self.entry.get().strip()
        if len(key) < 20:
            self.msg.configure(text="APIキーが短すぎるようです。もう一度確認してください。")
            return
        cfg = load_config()
        cfg["gemini_api_key"] = key
        save_config(cfg)
        self.on_saved(key)
        self.destroy()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_NAME)
        self.geometry("380x580+40+80")
        self.minsize(340, 500)
        self.configure(bg=BG)
        self.attributes("-topmost", True)

        self.f_title = tkfont.Font(family="Hiragino Sans", size=15, weight="bold")
        self.f_step  = tkfont.Font(family="Hiragino Sans", size=13, weight="bold")
        self.f_body  = tkfont.Font(family="Hiragino Sans", size=12)
        self.f_small = tkfont.Font(family="Hiragino Sans", size=11)
        self.f_mini  = tkfont.Font(family="Hiragino Sans", size=10)

        self.cfg = load_config()
        self.state = WorkerState()
        self.state.api_key = self.cfg.get("gemini_api_key")
        self.msg_queue: queue.Queue = queue.Queue()

        self._build_ui()
        self.overlay = TargetOverlay(self)
        self.overlay_enabled = bool(self.cfg.get("overlay_enabled", True))
        self.worker = AnalysisWorker(self.state, self.msg_queue)
        self.worker.start()
        self.after(120, self._pump_queue)
        self.protocol("WM_DELETE_WINDOW", self._quit)

        self._refresh_progress()
        if not self.state.api_key:
            self.after(300, self._open_setup)

    # ── UI 構築 ─────────────────────────
    def _build_ui(self):
        # ヘッダ
        head = tk.Frame(self, bg=PANEL, highlightthickness=1, highlightbackground=BORDER)
        head.pack(fill="x", padx=8, pady=(8, 6))
        top = tk.Frame(head, bg=PANEL)
        top.pack(fill="x", padx=12, pady=(10, 4))
        tk.Label(top, text="✨ " + APP_NAME, bg=PANEL, fg=INK,
                 font=self.f_title).pack(side="left")
        tk.Button(top, text="⚙", command=self._open_setup, bg=PANEL, fg=MUTED,
                  relief="flat", font=self.f_body, borderwidth=0,
                  activebackground=PANEL, cursor="pointinghand",
                  ).pack(side="right")

        lrow = tk.Frame(head, bg=PANEL)
        lrow.pack(fill="x", padx=12, pady=(2, 10))
        tk.Label(lrow, text="レッスン:", bg=PANEL, fg=MUTED,
                 font=self.f_small).pack(side="left", padx=(0, 6))
        self.lesson_var = tk.StringVar(value=LESSONS[self.state.lesson_id]["name"])
        menu = ttk.Combobox(lrow, textvariable=self.lesson_var, state="readonly",
                            values=[LESSONS[k]["name"] for k in LESSONS])
        menu.pack(side="left", fill="x", expand=True)
        menu.bind("<<ComboboxSelected>>", self._on_lesson_change)

        # ステータス
        sf = tk.Frame(self, bg=PANEL, highlightthickness=1, highlightbackground=BORDER)
        sf.pack(fill="x", padx=8, pady=(0, 6))
        self.status_dot = tk.Label(sf, text="●", fg=SUCCESS, bg=PANEL,
                                   font=self.f_body)
        self.status_dot.pack(side="left", padx=(10, 6), pady=8)
        self.status_text = tk.Label(sf, text="準備中…", bg=PANEL, fg=INK,
                                    font=self.f_small, anchor="w")
        self.status_text.pack(side="left", fill="x", expand=True, pady=8)

        # 進捗
        pf = tk.Frame(self, bg=BG)
        pf.pack(fill="x", padx=14, pady=(2, 0))
        self.progress_label = tk.Label(pf, text="ステップ 1 / -", bg=BG, fg=INK,
                                       font=self.f_step, anchor="w")
        self.progress_label.pack(fill="x")
        self.progress_bar_bg = tk.Frame(self, bg=BORDER, height=6)
        self.progress_bar_bg.pack(fill="x", padx=14, pady=(6, 12))
        self.progress_bar_fill = tk.Frame(self.progress_bar_bg, bg=ACCENT, height=6)
        self.progress_bar_fill.place(x=0, y=0, relwidth=0.0, relheight=1.0)

        # 案内本文
        gb = tk.Frame(self, bg=PANEL, highlightthickness=1, highlightbackground=BORDER)
        gb.pack(fill="both", expand=True, padx=8, pady=(0, 6))
        self.step_title = tk.Label(gb, text="", bg=PANEL, fg=INK, font=self.f_step,
                                   wraplength=340, justify="left", anchor="w")
        self.step_title.pack(fill="x", padx=12, pady=(12, 4))
        self.guidance_text = tk.Label(gb, text="AIの案内がここに表示されます。",
                                      bg=PANEL, fg=INK, font=self.f_body,
                                      wraplength=340, justify="left", anchor="w")
        self.guidance_text.pack(fill="x", padx=12, pady=(0, 8))
        self.hint_text = tk.Label(gb, text="", bg=PANEL, fg=WARN, font=self.f_small,
                                  wraplength=340, justify="left", anchor="w")
        self.hint_text.pack(fill="x", padx=12, pady=(0, 8))
        self.screen_state_text = tk.Label(gb, text="", bg=PANEL, fg=MUTED,
                                          font=self.f_mini, wraplength=340,
                                          justify="left", anchor="w")
        self.screen_state_text.pack(fill="x", padx=12, pady=(0, 10))

        # 操作ボタン
        bf = tk.Frame(self, bg=BG)
        bf.pack(fill="x", padx=8, pady=(0, 10))
        self.pause_btn = tk.Button(bf, text="⏸ 停止", command=self._toggle_pause,
                                   bg=PANEL, fg=INK, font=self.f_body, relief="flat",
                                   padx=10, pady=6, borderwidth=1,
                                   highlightbackground=BORDER)
        self.pause_btn.pack(side="left", padx=(6, 4))
        tk.Button(bf, text="↻ 再解析", command=self._force,
                  bg=PANEL, fg=INK, font=self.f_body, relief="flat",
                  padx=10, pady=6, borderwidth=1,
                  highlightbackground=BORDER).pack(side="left", padx=4)
        self.overlay_btn = tk.Button(bf, text="🎯 矢印ON",
                                     command=self._toggle_overlay,
                                     bg=PANEL, fg=INK, font=self.f_body,
                                     relief="flat", padx=10, pady=6,
                                     borderwidth=1, highlightbackground=BORDER)
        self.overlay_btn.pack(side="left", padx=4)
        tk.Button(bf, text="次へ →", command=self._manual_next,
                  bg=ACCENT, fg="white", font=self.f_body, relief="flat",
                  padx=14, pady=6, borderwidth=0, highlightthickness=0,
                  activebackground="#9E351F",
                  activeforeground="white").pack(side="right", padx=(4, 6))

    # ── ワーカ制御 ───────────────────────
    def _pump_queue(self):
        try:
            while True:
                self._handle(self.msg_queue.get_nowait())
        except queue.Empty:
            pass
        self.after(120, self._pump_queue)

    def _handle(self, msg: dict):
        kind = msg.get("kind")
        if kind == "status":
            self.status_text.configure(text=msg["text"])
            self.status_dot.configure(fg=SUCCESS if msg["ok"] else ACCENT)
            if not msg["ok"]:
                self.overlay.hide()
        elif kind == "guidance":
            g: Guidance = msg["guidance"]
            if g.error:
                self.status_text.configure(text=g.error)
                self.status_dot.configure(fg=ACCENT)
                self.overlay.hide()
                return
            self.screen_state_text.configure(text=f"画面: {g.screen_state}")
            self.guidance_text.configure(text=g.guidance or "案内を判定できませんでした。")
            self.hint_text.configure(text=(f"💡 {g.hint}" if g.hint else ""))

            ppt_bounds = msg.get("ppt_bounds")
            if (self.overlay_enabled and g.target_bbox and ppt_bounds
                    and not g.lesson_complete):
                screen = bbox_to_screen(g.target_bbox, ppt_bounds)
                self.overlay.show(screen, ppt_bounds, g.target_label)
            else:
                self.overlay.hide()

            if g.current_step_done and not g.lesson_complete:
                self._advance_step(from_ai=True)
            elif g.lesson_complete:
                self._mark_complete()

    # ── レッスン制御 ─────────────────────
    def _current_lesson(self) -> dict:
        return LESSONS[self.state.lesson_id]

    def _refresh_progress(self):
        lesson = self._current_lesson()
        total = len(lesson["steps"])
        idx = self.state.step_index
        self.progress_label.configure(
            text=f"ステップ {min(idx + 1, total)} / {total} · {lesson['name']}")
        pct = min(idx / total, 1.0)
        self.progress_bar_fill.place_configure(relwidth=pct)
        if idx < total:
            self.step_title.configure(text=lesson["steps"][idx])
        else:
            self.step_title.configure(text="🎉 レッスン完了！")

    def _on_lesson_change(self, _evt=None):
        name = self.lesson_var.get()
        for key, val in LESSONS.items():
            if val["name"] == name:
                self.state.lesson_id = key
                self.state.step_index = 0
                break
        self.guidance_text.configure(text="AIの案内を待っています…")
        self.hint_text.configure(text="")
        self.screen_state_text.configure(text="")
        self.state.force_analyze = True
        self._refresh_progress()

    def _advance_step(self, from_ai: bool = False):
        lesson = self._current_lesson()
        if self.state.step_index < len(lesson["steps"]) - 1:
            self.state.step_index += 1
            self._refresh_progress()
            if from_ai:
                self.status_text.configure(text="ステップ完了を検知しました")
        else:
            self._mark_complete()

    def _mark_complete(self):
        self.state.step_index = len(self._current_lesson()["steps"])
        self._refresh_progress()
        self.guidance_text.configure(text="全ステップを完了しました。お疲れさまでした！")
        self.hint_text.configure(text="")
        self.overlay.hide()

    # ── 操作 ─────────────────────────────
    def _toggle_pause(self):
        self.state.paused = not self.state.paused
        self.pause_btn.configure(text="▶ 再開" if self.state.paused else "⏸ 停止")
        if self.state.paused:
            self.overlay.hide()

    def _force(self):
        self.state.force_analyze = True

    def _manual_next(self):
        self._advance_step(from_ai=False)
        self.state.force_analyze = True

    def _toggle_overlay(self):
        self.overlay_enabled = not self.overlay_enabled
        self.overlay_btn.configure(
            text="🎯 矢印ON" if self.overlay_enabled else "🎯 矢印OFF")
        if not self.overlay_enabled:
            self.overlay.hide()
        self.cfg["overlay_enabled"] = self.overlay_enabled
        save_config(self.cfg)

    def _open_setup(self):
        SetupDialog(self, on_saved=self._on_api_key_saved)

    def _on_api_key_saved(self, key: str):
        self.state.api_key = key
        self.status_text.configure(text="APIキーを設定しました。監視を開始します。")
        self.status_dot.configure(fg=SUCCESS)
        self.state.force_analyze = True

    def _quit(self):
        self.state.running = False
        try:
            self.overlay.hide()
        except Exception:
            pass
        self.destroy()


def main():
    if sys.platform != "darwin":
        print("このアプリは macOS 専用です。", file=sys.stderr)
        sys.exit(1)
    App().mainloop()


if __name__ == "__main__":
    main()
