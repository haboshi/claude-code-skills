/**
 * xml-builder の使用例: 3 層の AWS 構成図を列と帯で組む。
 *
 *   node references/examples/aws-architecture.example.js > example.drawio
 *
 * 規約（references/layout-rules.md）:
 *  - 列（col）は 160px 間隔、帯（band）は 4 本。同じ列に縦の辺だけを通す
 *  - 帯と帯の間に 40px の回廊を空け、横に走る辺と辺ラベルはそこに置く
 *  - 上下の接続はアンカー（ノード id）、左右の接続はアイコン（`${id}_i`）に繋ぐ
 */
import { DrawioBuilder, LINE } from '../../scripts/xml-builder.js'

export function buildExample() {
  const b = new DrawioBuilder({ name: 'AWS 構成図の例', width: 1050, height: 900 })
  const [, c1, c2, c3, c4, c5] = [25, 235, 395, 555, 715, 875] // 列（アンカー左端。先頭は WAF 専用で未使用）
  const [A, B, C, D, E] = [48, 195, 355, 535, 690] // 帯（アイコン上端）

  // 上段: 利用者と DNS、リージョン外のサービス
  b.box('g_office', '社内ネットワーク', { x: 25, y: 15, w: 210, h: 122, stroke: '#6B7785', dashed: true })
  b.node('users', { col: 55, y: A, resIcon: 'users', category: 'security', label: '利用者\n操作・連携・報告' })
  b.node('dns', { col: c1, y: A, resIcon: 'route_53', category: 'network', label: 'Route 53\nexample.jp', labelPos: 'right', labelWidth: 150 })
  b.box('g_ext', 'us-east-1（クロスリージョン推論）', { x: 690, y: 12, w: 345, h: 112, stroke: LINE.magenta, dashed: true })
  b.node('llm', { col: c5, y: A, resIcon: 'bedrock', category: 'ml', label: 'Amazon Bedrock\n推論プロファイル', labelPos: 'left', labelWidth: 200, size: 15 })

  // VPC
  b.box('g_vpc', '共有 VPC  10.0.0.0/16', { x: 25, y: 150, w: 1010, h: 670, stroke: '#8C4FFF', align: 'center' })
  b.anchor('waf', { x: 25, y: B, w: 132, h: 100 })
  b.icon('waf_i', { x: 70, y: B, resIcon: 'waf', category: 'security' })
  b.text('waf_l', 'AWS WAF\nIP 許可で評価終端', { x: 25, y: B + 48, w: 132, h: 40 })
  b.node('alb', { col: c1, y: B, resIcon: 'application_load_balancer', category: 'network', label: 'ALB（公開）\n443 / 80 は 443 へ転送', labelPos: 'right', labelWidth: 230 })
  b.node('sched', { col: c3, y: B, resIcon: 'eventbridge', category: 'appint', label: 'EventBridge\n定期 3 本' })
  b.node('nat', { col: c5, y: B, resIcon: 'nat_gateway', category: 'network', label: 'NAT Gateway\n外向き通信の出口', labelPos: 'left', labelWidth: 200 })

  b.box('g_sub', 'プライベートサブネット 1a / 1c', { x: 45, y: 325, w: 508, h: 140, stroke: LINE.green, fill: '#F3F9F1' })
  b.node('web', { col: c1, y: C, resIcon: 'ecs', category: 'compute', label: 'ECS Fargate Web\nARM64・2 タスク' })
  b.node('batch', { col: c2, y: C, resIcon: 'ecs', category: 'compute', label: 'ECS RunTask\nバッチ' })
  b.node('api', { col: c3, y: C, resIcon: 'api_gateway', category: 'appint', label: 'API Gateway\nプライベート' })
  b.node('nlb', { col: c4, y: C, resIcon: 'network_load_balancer', category: 'network', label: 'NLB（内部）\nTCP 7700' })
  b.box('g_pub', '公開サブネット', { x: 855, y: 340, w: 178, h: 142, stroke: '#B45309', fill: '#FFF7EC', size: 14, align: 'center', valign: 'bottom' })
  b.node('etl', { col: c5, y: C, resIcon: 'ec2', category: 'compute', label: 'ETL サーバー\nEC2 1 台' })

  b.box('g_db', 'Aurora クラスタ・PostgreSQL 16', { x: 45, y: 505, w: 508, h: 150, stroke: '#3334B9', fill: '#F3F4FD', valign: 'bottom' })
  b.node('reader', { col: c1, y: D, resIcon: 'aurora', category: 'database', label: 'Reader r8g.large\n検索用' })
  b.node('writer', { col: c2, y: D, resIcon: 'aurora', category: 'database', label: 'Writer Serverless\n0.5〜16 ACU' })
  b.node('cache', { col: c3, y: D, resIcon: 'elasticache', category: 'database', label: 'Valkey\nt4g.medium 2 台' })
  b.node('kv', { col: c4, y: D, resIcon: 'dynamodb', category: 'database', label: 'DynamoDB\nジョブ進捗' })
  b.node('ssm', { col: c5, y: D, resIcon: 'systems_manager', category: 'mgmt', label: 'Parameter Store\n秘匿情報' })

  b.node('logs', { col: c2, y: E, resIcon: 'cloudwatch_2', category: 'mgmt', label: 'CloudWatch Logs\n保持 30 日' })
  b.node('fh', { col: c3, y: E, resIcon: 'kinesis_data_firehose', category: 'analytics', label: 'Data Firehose\nS3 へ配送' })
  b.node('s3', { col: c4, y: E, resIcon: 's3', category: 'storage', label: 'S3\n監査ログ・帳票' })
  b.node('athena', { col: c5, y: E, resIcon: 'athena', category: 'analytics', label: 'Athena\nログ照会' })

  // 凡例（行間 18px 以上）
  b.box('g_leg', '線の色', { x: c1, y: E, w: 150, h: 124, stroke: '#9AA3B2', fill: '#FFFFFF', size: 14 })
  const legend = [[LINE.blue, '会員検索'], [LINE.orange, '一括登録'], [LINE.green, '帳票生成'], [LINE.magenta, 'AI 判定'], [LINE.grey, '補助・ログ']]
  legend.forEach(([color, name], k) => {
    const y = E + 35 + k * 18
    b._cell(`leg_b${k}`, '', `rounded=0;strokeColor=none;fillColor=${color};`, c1 + 12, y + 5, 16, 3)
    b.text(`leg_t${k}`, name, { x: c1 + 34, y: y - 2, w: 110, h: 16, size: 14, color: '#4B5563', align: 'left', valign: 'middle' })
  })

  // 注記
  b.note('n1', 'ECS が使う保管先: セッションとキューは Valkey、ジョブ進捗は DynamoDB、CSV と帳票は S3（線は省略）', { x: 40, y: 836, w: 990 })
  b.note('n2', '秘匿情報は Parameter Store から起動時に注入。0.0.0.0/0 の経路は NAT Gateway', { x: 40, y: 860, w: 990 })

  // 主要フロー（横はアイコン、縦はアンカー）
  b.edge('e1', 'users_i', 'dns_i', { label: 'HTTPS', color: LINE.blue, width: 2.2, exit: [1, 0.5], entry: [0, 0.5], offset: [0, -13] })
  b.edge('e2', 'dns_i', 'alb_i', { color: LINE.blue, width: 2.2, exit: [0.5, 1], entry: [0.5, 0] })
  b.edge('e3', 'waf_i', 'alb_i', { label: '検査', dashed: true, exit: [1, 0.5], entry: [0, 0.5], offset: [0, -12] })
  b.edge('e4', 'alb_i', 'web', { color: LINE.blue, width: 2.2, exit: [0.5, 1], entry: [0.5, 0] })
  b.edge('e5', 'web_i', 'batch_i', { label: 'RunTask 起動', color: LINE.orange, width: 2.2, exit: [1, 0.5], entry: [0, 0.5], offset: [0, -13] })
  b.edge('e6', 'web', 'reader', { label: '会員検索', color: LINE.blue, width: 2.2, exit: [0.5, 1], entry: [0.5, 0], offset: [44, 0] })
  b.edge('e7', 'batch', 'writer', { label: '一括登録・View 切替', color: LINE.orange, width: 2.2, exit: [0.5, 1], entry: [0.5, 0], offset: [88, 0] })
  b.edge('e8', 'batch_i', 'api_i', { label: '帳票生成の依頼', color: LINE.green, width: 2.2, exit: [1, 0.5], entry: [0, 0.5], offset: [0, -13] })
  b.edge('e9', 'api_i', 'nlb_i', { label: 'VPC Link', color: LINE.green, width: 2.2, exit: [1, 0.5], entry: [0, 0.5], offset: [0, -13] })
  b.edge('e10', 'nlb_i', 'etl_i', { color: LINE.green, width: 2.2, exit: [1, 0.5], entry: [0, 0.5] })
  // 長い迂回は waypoints で確定させる（回廊 y=316 を通る）
  b.edge('e11', 'batch', 'nat', { label: 'AI 判定を米国へ', color: LINE.magenta, width: 2.2, exit: [0.58, 0], entry: [0.5, 1], points: [[482, 316], [950, 316]] })
  b.edge('e12', 'nat', 'llm', { color: LINE.magenta, width: 2.2, exit: [0.5, 0], entry: [0.5, 1] })
  // 補助
  b.edge('e13', 'sched', 'batch', { label: '定期起動', dashed: true, exit: [0.5, 1], entry: [0.42, 0], points: [[630, 296], [458, 296]], offset: [-40, 2] })
  b.edge('e14', 'writer', 'logs', { label: 'ログ出力', dashed: true, exit: [0.5, 1], entry: [0.5, 0], offset: [52, 12] })
  b.edge('e15', 'logs_i', 'fh_i', { dashed: true, exit: [1, 0.5], entry: [0, 0.5] })
  b.edge('e16', 'fh_i', 's3_i', { dashed: true, exit: [1, 0.5], entry: [0, 0.5] })
  b.edge('e17', 'athena_i', 's3_i', { label: '照会', dashed: true, exit: [0, 0.5], entry: [1, 0.5], offset: [0, -12] })

  return b.toXml()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(buildExample())
}
