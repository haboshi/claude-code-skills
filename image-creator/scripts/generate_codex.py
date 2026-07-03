#!/usr/bin/env python3
"""
Codex サブスク枠 画像生成スクリプト（無課金・既定経路）

Codex CLI 組み込みの built-in `image_gen` ツール（gpt-image-2）を、ChatGPT
ログイン認証（サブスクリプション枠）で呼び出す。`OPENAI_API_KEY` を明示的に
外して起動するため、API 従量課金が発生しない。

制約（built-in image_gen 由来）:
  - prompt 引数のみ。size/quality/厳密な比率は制御できない（比率は prose ヒントで誘導のみ）。
  - 透過背景は出力できない。→ 正確な比率・2K/4K・透過が必要なときは generate_openai.py を使う。
  - codex exec はサンドボックスでプロジェクトに書けないため、生成物は codex ランタイム
    配下に出る。本スクリプト（非サンドボックス）が検証のうえコピーする。

偽装対策: codex は稀に image_gen を呼ばず SVG/PIL 等で自作した画像や既存流用で
「生成した」と偽装する。プロンプトの偽装禁止文言＋開始マーカーより新しい mtime 検証の
2 層で弾く。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run python scripts/generate_codex.py "青空と一本桜のイラスト" -o out.png
    uv run python scripts/generate_codex.py --check   # 可用性判定のみ
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# 終了コード（呼び出し側のフォールバック判断に使う）
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NO_IMAGE = 2        # 生成なし／偽装検証に落ちた
EXIT_UNAVAILABLE = 3     # codex CLI 不在 or ChatGPT 未ログイン
EXIT_TOKEN_EXPIRED = 4   # サブスクトークン期限切れ（要 `codex login`）

# codex が生成画像を書き出す候補ディレクトリ（環境依存を吸収するため複数探索）。
# 個人パスをハードコードせず expanduser / 環境変数から導出する（path-privacy 順守）。
def candidate_image_dirs():
    dirs = []
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home:
        dirs.append(Path(codex_home) / "generated_images")
    dirs.append(Path.home() / ".codex" / "generated_images")
    # orca ランタイムラッパー配下（本スクリプトが動く一部環境の実体）
    dirs.append(
        Path.home() / "Library" / "Application Support" / "orca"
        / "codex-runtime-home" / "home" / "generated_images"
    )
    return dirs


def check_availability():
    """codex CLI が存在し、ChatGPT ログイン（サブスク枠）で使えるかを判定。

    Returns:
        (available: bool, message: str)
    """
    if shutil.which("codex") is None:
        return False, "codex CLI が見つかりません（PATH に codex がない）"
    try:
        result = subprocess.run(
            ["codex", "login", "status"],
            capture_output=True, text=True, timeout=20,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        return False, f"codex login status の実行に失敗: {type(e).__name__}"
    combined = f"{result.stdout}\n{result.stderr}"
    if "ChatGPT" in combined:
        return True, "Logged in using ChatGPT（サブスク枠が利用可能）"
    if "Not logged in" in combined or result.returncode != 0:
        return False, "codex が未ログインです（`codex login` で ChatGPT にログインしてください）"
    # API キーのみでログインしている場合はサブスク枠ではない
    return False, "ChatGPT ログインが確認できません（サブスク枠は利用不可）"


# 偽装禁止＋パス報告を強制する固定文言（削らない）
_ANTI_FAKE = (
    "画像は必ず image_gen ツールで生成すること。"
    "SVG/HTML/コード(python, PIL等)で自作して画像化することや、既存ファイルの流用・コピーは禁止。"
    "image_gen が使えない・失敗した場合は何も作らず IMAGEGEN-UNAVAILABLE とだけ報告して終了。"
    "生成後、保存された最終PNGの絶対パスだけを最後に1行で報告して（コピーは不要）。"
)

# 品質バー（augment 有効時に付与）。built-in image_gen は size/quality を制御できないため、
# 品質は「役割付与＋作り込みの明示＋レイアウト委譲」で引き上げる（codex-imagegen で実証済みの最大レバー）。
# ユーザーの明示テイストを最優先し、指示されていない要素は足さない（過剰装飾の防止）。
_QUALITY_BAR = (
    "Produce a professional, high-quality result: intentional composition, clear visual hierarchy, "
    "clean and polished execution, crisp and legible details. "
    "Honor the described subject, style, palette, and taste exactly — do NOT add characters, props, "
    "text, or embellishments that were not requested (if the user asked for a simple or flat look, keep it so). "
    "If the content is structured (an infographic, poster, diagram, or slide), act as an expert designer: "
    "decide the layout, grouping, sizing, and visual hierarchy yourself for a genuinely well-designed, "
    "information-rich one-pager — include brief supporting labels where they add clarity, and avoid a plain "
    "uniform list — while keeping it uncluttered. "
    "Render any specified text exactly and legibly with correct spelling and no extra text."
)


def _aspect_clause(aspect):
    """比率ヒントを向き付きの強い prose に変換（built-in は解像度非制御だが向きは誘導可能）。"""
    a = aspect.strip()
    orient = "balanced framing"
    try:
        w, h = (float(x) for x in a.replace("：", ":").split(":"))
        if w > h:
            orient = "wide landscape orientation, clearly wider than tall"
        elif h > w:
            orient = "tall portrait orientation, clearly taller than wide"
        else:
            orient = "square, equal width and height"
    except (ValueError, TypeError):
        pass
    return (
        f"Target aspect ratio {a} — {orient}. Compose specifically for this shape and fill the whole "
        f"frame edge to edge; avoid letterboxing, borders, or large empty margins."
    )


def build_prompt(prompt, aspect=None, n=1, augment=True):
    """codex exec に渡す最終プロンプトを組み立てる。

    末尾の literal `$imagegen` が土台スキルを起動する。argv で渡すためシェル展開はされない。
    augment=True で品質バー（役割付与・作り込み・レイアウト委譲）を付与する。
    """
    parts = [prompt.strip()]
    if augment:
        parts.append(_QUALITY_BAR)
    if aspect:
        parts.append(_aspect_clause(aspect))
    if n > 1:
        parts.append(
            f"共通のスタイル（配色・質感・余白・トーン）を1つ決め、それを全てに適用したまま "
            f"{n} 枚を順に生成・保存し、各PNGの絶対パスを1行ずつ全て報告して。"
        )
    parts.append(_ANTI_FAKE)
    parts.append("$imagegen")
    return " ".join(parts)


def extract_reported_paths(text):
    """codex の最終メッセージから generated_images 配下の PNG 絶対パスを抽出。

    orca パスは "Application Support" に空白を含むため、行単位で先頭の `/` から
    `/generated_images/.../*.png` を非貪欲に拾う。
    """
    paths = []
    pattern = re.compile(r"(/.*?/generated_images/[^\s'\"]+\.png)")
    for line in text.splitlines():
        for m in pattern.finditer(line):
            paths.append(m.group(1))
    return paths


def _iter_pngs(directory):
    try:
        yield from directory.rglob("*.png")
    except OSError:
        return


def _verify_fresh(path, marker_mtime):
    """偽装検証: generated_images 配下 かつ 実ファイル かつ marker より新しい mtime。"""
    try:
        if "generated_images" not in path.parts:
            return False
        if not path.is_file():
            return False
        return path.stat().st_mtime > marker_mtime
    except OSError:
        return False


def select_fresh_images(reported, marker_mtime, dirs, limit):
    """偽装検証を通過した生成画像を最大 limit 件返す。

    codex が報告した絶対パス（reported）を正典として、報告順に採用する。これは
    codex プロセス固有のセッション配下パスを指すため、複数セッション同時実行下でも
    他セッションの生成物と混同しない（共有 generated_images ディレクトリの走査は
    並行実行で汚染するため、報告が得られないときの最終手段に限定する）。

    採用条件: パスが generated_images 配下 かつ 実ファイルが存在 かつ mtime が
    marker より新しい（既存流用・古い画像の偽装を弾く）。
    """
    picked = []
    seen = set()
    # 正典: codex が報告したパス（報告順を維持）
    for p in reported:
        path = Path(p)
        key = str(path)
        if key in seen:
            continue
        if _verify_fresh(path, marker_mtime):
            picked.append(path)
            seen.add(key)
        if len(picked) >= limit:
            return picked
    if picked:
        return picked[:limit]

    # 最終手段（報告パスが無いときのみ）: 候補ディレクトリを mtime 降順で走査。
    # 並行実行下では他セッションの生成物を拾う恐れがあるため警告を出す。
    fallback = {}
    for d in dirs:
        if d.is_dir():
            for p in _iter_pngs(d):
                if _verify_fresh(p, marker_mtime):
                    try:
                        fallback[str(p.resolve())] = p.stat().st_mtime
                    except OSError:
                        continue
    if fallback:
        print("警告: codex が生成パスを報告しなかったため、共有ディレクトリの最新画像を推定採用します"
              "（複数セッション同時実行時は取り違えの恐れ）。")
    ordered = sorted(fallback.items(), key=lambda kv: kv[1], reverse=True)
    return [Path(p) for p, _ in ordered[:limit]]


def generate_image(
    prompt,
    output_path="generated_image.png",
    n=1,
    effort="low",
    aspect=None,
    timeout=300,
    workdir=None,
    augment=True,
):
    """codex サブスク枠で画像を生成し、output_path へコピーする。

    成功時は保存先の絶対パス（複数時は最初の1件）を返す。失敗時は SystemExit。
    """
    available, message = check_availability()
    if not available:
        print(f"エラー: codex サブスク枠を利用できません — {message}")
        sys.exit(EXIT_UNAVAILABLE)

    workdir = workdir or os.getcwd()
    full_prompt = build_prompt(prompt, aspect=aspect, n=n, augment=augment)

    # 偽装検証の基準となる開始マーカー
    marker_fd, marker_path = tempfile.mkstemp(prefix="codex-imagegen-", suffix=".marker")
    os.close(marker_fd)
    marker_mtime = os.path.getmtime(marker_path)
    # mtime 解像度による取りこぼしを避けるため僅かに巻き戻す
    marker_mtime -= 1.0

    out_fd, out_txt = tempfile.mkstemp(prefix="codex-imagegen-out-", suffix=".txt")
    os.close(out_fd)

    # OPENAI_API_KEY を外してサブスク OAuth 認証に落とす（従量課金回避の核）
    env = os.environ.copy()
    env.pop("OPENAI_API_KEY", None)

    cmd = [
        "codex", "exec", "--skip-git-repo-check",
        "-C", str(workdir),
        "-c", f"model_reasoning_effort={effort}",
        "-o", out_txt,
        full_prompt,
    ]

    print(f"codex サブスク枠で生成中（effort={effort}, n={n}）...")
    print(f"プロンプト: {prompt[:80]}...")
    try:
        subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"エラー: codex がタイムアウトしました（{timeout}秒）")
        os.unlink(marker_path)
        sys.exit(EXIT_ERROR)

    try:
        report = Path(out_txt).read_text(encoding="utf-8", errors="replace")
    except OSError:
        report = ""
    finally:
        Path(out_txt).unlink(missing_ok=True)
    Path(marker_path).unlink(missing_ok=True)

    lowered = report.lower()
    # トークン期限切れ検出。単独の "401" は本文中の数値と衝突するため使わず、
    # 明確な認証エラー文言、または 401 と認証語の共起のみを期限切れと判定する。
    token_expired = (
        "token_expired" in lowered
        or "refresh token was already used" in lowered
        or "unauthorized" in lowered
        or bool(re.search(r"\b401\b.{0,40}(unauthor|token|auth|expired|login)", lowered))
        or bool(re.search(r"(unauthor|token|auth|expired|login).{0,40}\b401\b", lowered))
    )
    if token_expired:
        print("エラー: サブスクトークンが期限切れです。`! codex login` で再ログインしてください。")
        sys.exit(EXIT_TOKEN_EXPIRED)
    if "IMAGEGEN-UNAVAILABLE" in report:
        print("エラー: image_gen ツールが使えませんでした（ログイン切れ・レート制限の可能性）。")
        sys.exit(EXIT_NO_IMAGE)

    reported = extract_reported_paths(report)
    fresh = select_fresh_images(reported, marker_mtime, candidate_image_dirs(), limit=n)
    if not fresh:
        print("エラー: image_gen 未実行の疑い（偽装/流用/失敗）。生成画像を確認できませんでした。")
        sys.exit(EXIT_NO_IMAGE)

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    saved = []
    for i, src in enumerate(fresh):
        if n > 1:
            dest = output_file.parent / f"{output_file.stem}_{i+1:02d}{output_file.suffix}"
        else:
            dest = output_file
        shutil.copy2(src, dest)
        print(f"保存完了: {dest.absolute()}")
        saved.append(str(dest.absolute()))

    return saved[0] if saved else ""


def main():
    parser = argparse.ArgumentParser(
        description="Codex サブスク枠 画像生成（無課金・既定経路）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run python generate_codex.py "青空と一本桜のシンプルなイラスト" -o sakura.png
  uv run python generate_codex.py "章扉の装飾" -n 3 --effort xhigh -o slide.png
  uv run python generate_codex.py --check      # 可用性判定のみ（利用可=0, 不可=3）

制約:
  built-in image_gen は size/quality/厳密比率を制御できず、透過背景も不可。
  正確な比率・2K/4K・透過が必要なときは generate_openai.py（従量課金）を使う。

終了コード:
  0 成功 / 1 一般エラー / 2 生成なし・偽装検証失敗 /
  3 codex 不在・未ログイン / 4 トークン期限切れ（要 codex login）
        """,
    )
    parser.add_argument("prompt", nargs="?", help="画像生成プロンプト")
    parser.add_argument("-o", "--output", default="generated_image.png", help="出力ファイルパス")
    parser.add_argument("-n", "--number", type=int, default=1,
                        choices=range(1, 11), help="生成枚数（1-10）")
    parser.add_argument("--effort", default="low",
                        choices=["low", "medium", "high", "xhigh"],
                        help="推論強度（作り込みは high/xhigh、単発は low）")
    parser.add_argument("--aspect", default=None,
                        help="比率のヒント（例: 16:9 / 3:4 / 1:1。向きは誘導可、解像度は built-in 非制御）")
    parser.add_argument("--no-augment", dest="augment", action="store_false", default=True,
                        help="品質バー（役割付与・作り込み・レイアウト委譲）の自動付与を無効化")
    parser.add_argument("--timeout", type=int, default=300, help="タイムアウト秒")
    parser.add_argument("--check", action="store_true",
                        help="可用性判定のみ実行（利用可=0, 不可=3）")

    args = parser.parse_args()

    if args.check:
        available, message = check_availability()
        print(message)
        sys.exit(EXIT_OK if available else EXIT_UNAVAILABLE)

    if not args.prompt:
        parser.error("prompt を指定してください（--check の場合は不要）")

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        n=args.number,
        effort=args.effort,
        aspect=args.aspect,
        timeout=args.timeout,
        augment=args.augment,
    )


if __name__ == "__main__":
    main()
