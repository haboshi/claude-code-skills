"""Evaluator ハーネス最小スケルトン（系統B / 中期ロードマップ）。

06章「系統B: 独自ハーネス」の Python 型断面（Decision / Verdict / Evaluator）と、
03章(3)「Agent SDK ループ + no-progress cap」を統合した、単体で実行可能な骨組み。

含むもの:
  - 統一 Verdict 契約（frozen dataclass）と Evaluator Protocol（06章と同一）。
  - カスケード評価 evaluate(): deterministic_check -> llm_critic -> independent_done。
    安い順に評価し、決定論で落ちたら LLM を呼ばない（早期決着）。
  - 三重 cap の run_loop(): turn cap / budget cap / no-progress cap。
    no-progress は progress_signature（変更ファイル集合 + テスト結果のハッシュ）で検知する。
  - verdict.next_direction を次ターンの worker 指令へ注入。
  - OTel span は任意依存（未導入なら no-op tracer にフォールバック）。stdlib のみで動く。

差し替え点:
  llm_critic / independent_done は実 API を呼ばない**スタブ**。実運用では別モデルの
  critic / blind judge に置き換える（各関数の docstring 参照）。deterministic_check は
  実運用では test/lint/型/git を実際に走らせる。

実行: `python3 evaluator_harness.py` でデモ（fail -> 修正 -> pass のカスケード遷移）が動く。
Python 3.10+。
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal, Protocol

# --- 統一 Verdict 契約（06章と同一） ---------------------------------------

Decision = Literal[
    "promote", "hold", "reject", "merge", "supersede",  # write / manage
    "retrieve", "drop",                                 # read
    "forget",                                           # manage
    "continue", "stop",                                 # loop / outcome
]

# Decision の全許容値（想定外 decision を実行時に弾くためのガード集合）
DECISIONS: frozenset[str] = frozenset(
    {"promote", "hold", "reject", "merge", "supersede",
     "retrieve", "drop", "forget", "continue", "stop"}
)

# ループを止める終端 decision（それ以外は継続）
TERMINAL_DECISION: str = "stop"

# 決定論・critic 段が「この段では棄却理由なし・次段へ委譲」を表す中間 decision。
# カスケードの早期決着条件（reject/continue）に含まれないため素通りする。
NO_OBJECTION: Decision = "hold"


@dataclass(frozen=True)
class Verdict:
    """評価点が返す不変の遷移決定。frozen なので生成後は書き換えない。"""

    decision: Decision
    score: float                               # 0..1
    reason: str
    next_direction: str | None = None          # 未達なら次に何を直すか
    scores: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # 契約違反（想定外 decision / 範囲外 score）は生成時点で例外にする。
        if self.decision not in DECISIONS:
            raise ValueError(f"unknown decision: {self.decision!r}")
        if not 0.0 <= self.score <= 1.0:
            raise ValueError(f"score out of range [0,1]: {self.score}")


class Evaluator(Protocol):
    """全評価点の単一契約。path で write/manage/read/outcome を区別する。"""

    policy_id: str
    path: Literal["write", "manage", "read", "outcome"]

    def evaluate(self, subject: object, ctx: object) -> Verdict: ...


# --- OTel span（任意依存。未導入なら no-op にフォールバック） -----------------


class _NoOpSpan:
    """opentelemetry 未導入時のダミー span。属性設定を黙って捨てる。"""

    def set_attribute(self, *_args: object, **_kwargs: object) -> None:
        return None


class _NoOpTracer:
    """opentelemetry 未導入時のダミー tracer。実 tracer と同じ I/F を持つ。"""

    @contextmanager
    def start_as_current_span(self, _name: str) -> Iterator[_NoOpSpan]:
        yield _NoOpSpan()


try:  # OTel があれば使い、無ければ no-op。外部依存ゼロで動くことを保証する。
    from opentelemetry import trace as _otel_trace

    _tracer: object = _otel_trace.get_tracer("harness.evaluator")
except ImportError:
    _tracer = _NoOpTracer()


# --- 証拠モデル（worker が1ターンで残す成果） -------------------------------


@dataclass(frozen=True)
class WorkerReport:
    """worker の内側ループ1ターンぶんの成果と、そこから読める証拠。

    実運用では test exit code / lint / 型 / git status / diff を集約したもの。
    ここでは critic_clean / done_proven を「LLM 評価器がその成果に対して返すはずの
    信号」として保持し、スタブ評価器が実 API 無しで判定を再現できるようにしている。
    """

    changed_files: frozenset[str]
    test_passed: bool
    critic_clean: bool          # 別モデル critic が「重大欠陥なし」と見なすか（スタブ信号）
    done_proven: bool           # blind judge が「終状態を証拠上で実証済み」と見なすか（スタブ信号）
    cost_usd: float
    note: str


def progress_signature(report: WorkerReport) -> str:
    """変更ファイル集合 + テスト結果からハッシュを作る（no-progress 検知の指紋）。"""
    payload = repr((sorted(report.changed_files), report.test_passed))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --- カスケード評価の各段（安い順） -----------------------------------------

# reason に段名を前置して、どの段が判定したかを transcript / ログで追えるようにする。
_STAGE_DET = "[段1 決定論]"
_STAGE_CRITIC = "[段2 LLM critic]"
_STAGE_DONE = "[段3 独立Done判定]"


def deterministic_check(subject: WorkerReport) -> Verdict:
    """段1: 決定論チェック（test/lint/型/git）。最も安く再現可能。

    実運用ではここで実際に test/lint/型/`git status --porcelain` を走らせる。
    不合格なら continue（早期決着で LLM を呼ばない）。合格なら中間 NO_OBJECTION を
    返し、カスケードを次段へ委譲する。
    """
    if not subject.test_passed:
        return Verdict(
            decision="continue",
            score=0.0,
            reason=f"{_STAGE_DET} 決定論チェック不合格: テストが red",
            next_direction="失敗テストの原因を1つ特定して修正し、テストを再実行して結果を会話に残す",
            scores={"deterministic": 0.0},
        )
    return Verdict(
        decision=NO_OBJECTION,
        score=1.0,
        reason=f"{_STAGE_DET} 決定論チェック合格（次段へ委譲）",
        scores={"deterministic": 1.0},
    )


def llm_critic(subject: WorkerReport, ctx: object) -> Verdict:
    """段2: 別モデルの critic（何を直すかを返す）。

    差し替え点: 実運用では diff + 観測を別モデルへ渡し、重大欠陥の有無を批評させる。
    ここでは subject.critic_clean を「critic が返すはずの信号」として使うスタブ。
    欠陥ありなら continue（差し戻し）、概ね良好なら NO_OBJECTION で次段へ委譲する。
    """
    del ctx  # スタブでは未使用（実運用では diff / 観測を参照）
    if not subject.critic_clean:
        return Verdict(
            decision="continue",
            score=0.4,
            reason=f"{_STAGE_CRITIC} 重大欠陥あり: 設計/可読性の指摘に未対応",
            next_direction="critic 指摘のうち影響の大きい1点を修正し、変更を会話に残す",
            scores={"critic": 0.4},
        )
    return Verdict(
        decision=NO_OBJECTION,
        score=0.8,
        reason=f"{_STAGE_CRITIC} 重大欠陥なし（次段へ委譲）",
        scores={"critic": 0.8},
    )


def independent_done(subject: WorkerReport, ctx: object) -> Verdict:
    """段3: 独立 Done 判定（blind judge）。

    差し替え点: 実運用では**別 prompt・別 model**で、rubric（目的）と成果物だけを見せる。
    改善履歴・実装者の弁明・next_direction・過去 verdict は**渡さない**（self-approve 回避）。
    そのため本関数は ctx から goal しか読まず、履歴には触れない。
    ここでは subject.done_proven を「blind judge が返すはずの信号」として使うスタブ。
    """
    goal = ctx.get("goal", "") if isinstance(ctx, dict) else ""
    if subject.done_proven:
        return Verdict(
            decision="stop",
            score=1.0,
            reason=f"{_STAGE_DONE} 終状態を証拠上で実証済み（goal: {goal}）",
            scores={"done": 1.0},
        )
    return Verdict(
        decision="continue",
        score=0.6,
        reason=f"{_STAGE_DONE} 終状態が証拠上で未実証",
        next_direction="rubric の proof に対応する証拠（テスト出力・git status）を会話に残す",
        scores={"done": 0.6},
    )


def evaluate(subject: WorkerReport, ctx: object) -> Verdict:
    """合成カスケード。安い順に評価し、早期決着で高コスト段を省く（06章 系統B）。"""
    with _tracer.start_as_current_span("eval.deterministic") as sp:
        v = deterministic_check(subject)
        sp.set_attribute("verdict.decision", v.decision)
        if v.decision in ("reject", "continue"):
            return v                                  # 決定論で落ちれば LLM を呼ばない
    with _tracer.start_as_current_span("eval.llm_critic") as sp:
        c = llm_critic(subject, ctx)                  # 別モデルの critic（何を直すか）
        sp.set_attribute("verdict.decision", c.decision)
        if c.decision == "continue":
            return c
    with _tracer.start_as_current_span("eval.independent_done") as sp:
        d = independent_done(subject, ctx)            # 改善履歴を渡さない blind judge
        sp.set_attribute("verdict.decision", d.decision)
        return d


# --- ループ状態と三重 cap ----------------------------------------------------

# 保険条件のハード上限（マジックナンバーを一箇所に集約）。
CAP: dict[str, float] = {
    "max_turns": 30,
    "max_budget_usd": 5.0,
    "no_progress_limit": 2,
}

StopReason = Literal["pass", "no_progress_cap", "budget_cap", "turn_cap"]


def loop_action(verdict: Verdict) -> Literal["stop", "continue"]:
    """verdict をループの継続/停止アクションへ写像する。想定外 decision は例外。"""
    if verdict.decision not in DECISIONS:
        raise ValueError(f"unknown decision: {verdict.decision!r}")
    return "stop" if verdict.decision == TERMINAL_DECISION else "continue"


@dataclass
class LoopState:
    """ループの可変状態を1箇所に集約する（ミューテーションはここに局所化）。"""

    goal: str
    turn: int = 0
    budget_usd: float = 0.0
    no_progress_streak: int = 0
    next_direction: str | None = None
    stop_reason: StopReason | None = None
    history: list[Verdict] = field(default_factory=list)
    _prev_signature: str | None = None

    def record(self, verdict: Verdict, report: WorkerReport) -> None:
        """1ターンの結果を取り込み、no-progress 指紋と予算を更新する。"""
        self.history.append(verdict)
        signature = progress_signature(report)
        if signature == self._prev_signature:
            self.no_progress_streak += 1
        else:
            self.no_progress_streak = 0
        self._prev_signature = signature
        self.budget_usd += report.cost_usd
        self.turn += 1

    def context(self) -> dict[str, object]:
        """評価器に渡す文脈。blind judge には goal のみ読ませる想定。"""
        return {"goal": self.goal, "next_direction": self.next_direction, "turn": self.turn}


class Worker(Protocol):
    """内側ループ（Agent SDK 等）の1ターンを実行する worker の契約。"""

    def step(self, state: LoopState) -> WorkerReport: ...


TurnObserver = Callable[[LoopState, Verdict, WorkerReport], None]


def run_loop(
    goal: str,
    worker: Worker,
    cap: dict[str, float] = CAP,
    observer: TurnObserver | None = None,
) -> LoopState:
    """Maker–Checker 分離 + カスケード評価 + 三重 cap の外側ループ。

    worker（Maker）と evaluate（Checker）は別個体。verdict の next_direction を
    次ターンの worker 指令へ注入する。turn / budget / no-progress の3 cap で
    暴走とサイレント早期終了の両方を止める。
    """
    state = LoopState(goal=goal)
    max_turns = int(cap["max_turns"])
    no_progress_limit = int(cap["no_progress_limit"])
    max_budget = cap["max_budget_usd"]

    for _ in range(max_turns):
        with _tracer.start_as_current_span("loop.turn") as sp:
            report = worker.step(state)                 # 内側ループ1ターン（証拠を残す前提）
            verdict = evaluate(report, state.context())  # Checker（別 prompt/別 model 想定）
            state.record(verdict, report)
            sp.set_attribute("turn.decision", verdict.decision)
            sp.set_attribute("turn.budget_usd", state.budget_usd)
            if observer is not None:
                observer(state, verdict, report)

            if loop_action(verdict) == "stop":
                state.stop_reason = "pass"
                break
            if state.no_progress_streak >= no_progress_limit:  # サイレント空回りを止める
                state.stop_reason = "no_progress_cap"
                break
            if state.budget_usd >= max_budget:                 # 予算超過を止める
                state.stop_reason = "budget_cap"
                break
            state.next_direction = verdict.next_direction      # verdict を次ターンの指令に
    else:
        state.stop_reason = "turn_cap"                         # 収束しないときの第2停止条件

    return state


# --- デモ: fail -> fail(no-progress 一歩手前) -> 修正 -> pass -----------------

_PER_TURN_COST_USD = 0.5  # デモ worker の1ターンあたり擬似コスト


class _ScriptedWorker:
    """デモ用の台本 worker。turn ごとに用意した WorkerReport を順に返す。"""

    def __init__(self, script: list[WorkerReport]) -> None:
        self._script = script
        self._i = 0

    def step(self, state: LoopState) -> WorkerReport:
        del state  # 台本なので next_direction は参照しない（実 worker は使う）
        report = self._script[min(self._i, len(self._script) - 1)]
        self._i += 1
        return report


def _demo_script() -> list[WorkerReport]:
    """fail -> 同一署名 fail -> 修正 -> pass をたどる4ターンの台本。"""
    stuck = WorkerReport(
        changed_files=frozenset({"src/auth/login.py"}),
        test_passed=False, critic_clean=False, done_proven=False,
        cost_usd=_PER_TURN_COST_USD, note="初回実装: test_login が red",
    )
    return [
        stuck,                                   # T1: 決定論 fail（段1で早期決着）
        stuck,                                   # T2: 同一署名で停滞 -> no-progress 一歩手前
        WorkerReport(                            # T3: 修正 -> 決定論 pass だが critic 指摘
            changed_files=frozenset({"src/auth/login.py", "src/auth/expiry.py"}),
            test_passed=True, critic_clean=False, done_proven=False,
            cost_usd=_PER_TURN_COST_USD, note="expiry 計算を修正、test green / critic 指摘あり",
        ),
        WorkerReport(                            # T4: critic 対応 -> blind judge pass
            changed_files=frozenset(
                {"src/auth/login.py", "src/auth/expiry.py", "test/auth/test_login.py"}
            ),
            test_passed=True, critic_clean=True, done_proven=True,
            cost_usd=_PER_TURN_COST_USD, note="critic 指摘に対応、独立判定も通過",
        ),
    ]


def _print_turn(state: LoopState, verdict: Verdict, report: WorkerReport) -> None:
    """デモ出力。カスケードの到達段（reason 前置）と cap の状態を1行で追う。"""
    print(
        f"turn {state.turn} | decision={verdict.decision:<8} "
        f"| streak={state.no_progress_streak} | budget=${state.budget_usd:.2f} "
        f"| {report.note}"
    )
    print(f"         reason: {verdict.reason}")
    if verdict.next_direction is not None:
        print(f"         next  : {verdict.next_direction}")


def _demo() -> int:
    print("=== evaluator harness demo: fail -> fail(no-progress 一歩手前) -> 修正 -> pass ===")
    worker = _ScriptedWorker(_demo_script())
    state = run_loop(
        goal="src/auth 配下の failing test を全て green にする",
        worker=worker,
        observer=_print_turn,
    )
    print(
        f"\n--- 完了: stop_reason={state.stop_reason} / turns={state.turn} "
        f"/ budget=${state.budget_usd:.2f}（cap: turn={int(CAP['max_turns'])} "
        f"budget=${CAP['max_budget_usd']:.1f} no_progress={int(CAP['no_progress_limit'])}） ---"
    )
    # 期待: blind judge の stop で pass 停止。no-progress / budget / turn cap には掛からない。
    return 0 if state.stop_reason == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(_demo())
