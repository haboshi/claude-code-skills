# architecture — 2〜4層の構成図

用途: システムや組織を層（横帯）に分け、層内の要素と層間の連携（矢印）で全体像を示す。
様式: 帯 + 2行構成ノード（主/副ラベル）+ 矢印ラベル + 注釈行（README の様式イディオム準拠）。

| 要素 | 上限 |
|---|---|
| 層数 | 2〜4 |
| 層名 | 全角8文字 |
| 要素名（主ラベル） | 全角8文字（層あたり 2〜3 要素） |
| 副ラベル | 全角10文字 |
| 矢印ラベル | 全角6文字（省略可） |
| 注釈行 | 全角40文字 × 0〜2行 |

```svg
<svg viewBox="0 0 780 446" role="img">
  <title>システム構成（3層）</title>
  <defs>
    <marker id="ar-arch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/>
    </marker>
  </defs>
  <g font-size="14.5">
    <rect x="20" y="18" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
    <text x="36" y="42" fill="var(--ink-2)" font-weight="700">画面層</text>
    <rect x="160" y="54" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="270" y="75" text-anchor="middle" fill="var(--ink)" font-size="15">Web ブラウザ</text>
    <text x="270" y="95" text-anchor="middle" fill="var(--ink-2)">社内ポータル経由</text>
    <rect x="400" y="54" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="510" y="75" text-anchor="middle" fill="var(--ink)" font-size="15">モバイル</text>
    <text x="510" y="95" text-anchor="middle" fill="var(--ink-2)">現場端末</text>
    <path d="M390 122 v26" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar-arch)"/>
    <text x="404" y="140" fill="var(--ink-2)">HTTPS</text>
    <rect x="20" y="152" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
    <text x="36" y="176" fill="var(--ink-2)" font-weight="700">業務ロジック層</text>
    <rect x="70" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="170" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">API 連携</text>
    <text x="170" y="229" text-anchor="middle" fill="var(--ink-2)">外部 SaaS 接続</text>
    <rect x="290" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="390" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">認証処理</text>
    <text x="390" y="229" text-anchor="middle" fill="var(--ink-2)">SSO・権限判定</text>
    <rect x="510" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="610" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">業務ルール</text>
    <text x="610" y="229" text-anchor="middle" fill="var(--ink-2)">承認フロー</text>
    <path d="M390 256 v26" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar-arch)"/>
    <text x="404" y="274" fill="var(--ink-2)">SQL</text>
    <rect x="20" y="286" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
    <text x="36" y="310" fill="var(--ink-2)" font-weight="700">データ層</text>
    <rect x="160" y="322" width="220" height="52" rx="8" fill="var(--accent)" stroke="var(--accent)"/>
    <text x="270" y="343" text-anchor="middle" fill="#ffffff" font-size="15">基幹 DB</text>
    <text x="270" y="363" text-anchor="middle" fill="#ffffff">データの実体</text>
    <rect x="400" y="322" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
    <text x="510" y="343" text-anchor="middle" fill="var(--ink)" font-size="15">外部連携</text>
    <text x="510" y="363" text-anchor="middle" fill="var(--ink-2)">日次ファイル連携</text>
    <rect x="20" y="408" width="7" height="7" fill="var(--accent)"/>
    <text x="36" y="417" fill="var(--ink-2)">全経路が認証処理（SSO）を経由する — 直接 DB へ到達する経路はない</text>
    <rect x="20" y="432" width="7" height="7" fill="var(--accent)"/>
    <text x="36" y="441" fill="var(--ink-2)">バックアップは日次・別リージョン保管</text>
  </g>
</svg>
```

調整ポイント:
- 層の増減: 1層 = 帯高さ 104 + 層間 30（矢印 + ラベル）。viewBox 高さ = 層数 × 104 + (層数 − 1) × 30 + 注釈行 × 24 + 上下余白 42
- ノードは必ず主ラベル（15）+ 副ラベル（14.5）の2行構成にする（README 様式イディオム。1行の箱を並べない）
- 層内ノードは 2〜3 個（4個以上になるなら層の分割か副ラベルへの集約を検討）
- 強調（`fill="var(--accent)"` + 白文字）は図全体で最重要の1ノードのみ。白文字は主・副とも `#ffffff` を使う（この箇所だけは var(--bg) でなく白直書きで可 — accent 面上の文字色のため）
- 層間矢印にはプロトコル・手段のラベル（全角6文字以内）を添えられる。不要なら省略
- 注釈行（0〜2行）で構成の含意（セキュリティ・運用の約束）を言い切る
- `marker id` はパターンごとに固有（本パターンは `ar-arch`）
