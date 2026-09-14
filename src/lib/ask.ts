// 自然语言问答：本地组装档案摘要（不含图片）→ 交给模型回答
import { db } from '../db'
import { planEndDate } from './medParse'
import type { AiConfig } from './ai'
import { chatCompletion } from './ai'

const ASK_SYSTEM = `你是「家庭健康档案」应用的问答助手，面向普通家庭成员。请根据用户消息中提供的「档案摘要」回答问题。
规则：
1. 只依据档案摘要回答；摘要里没有的，明确说"档案里没有记录"，绝不编造。
2. 涉及金额给出数字；涉及化验指标给出数值、日期，并与参考区间对比；涉及趋势做简要判断。
3. 回答中引用单据时，在提到处标注它的编号记号（如 D12）；引用就诊记录标 V 编号。回答末尾单独一行"来源："列出用到的编号（如：来源：D12, D15）；没有引用写：来源：无
4. 语气亲和，条理清晰，适当分点；一般不超过 400 字。
5. 涉及健康/医疗的判断，结尾加一句：仅供参考，请以医生意见为准。
直接输出回答正文，不要 JSON。`

export interface AskContext {
  text: string
  docIds: Set<number>
  visitIds: Set<number>
  planIds: Set<number>
  reminderIds: Set<number>
  docMeta: Map<number, { title: string; date: string }>
  visitMeta: Map<number, { title: string; date: string }>
}

const trim = (s: string | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '')

/** 把本地档案整理成模型可读的摘要（控制在几千字内） */
export async function buildAskContext(memberId: number | 'all'): Promise<AskContext> {
  const inScope = (id: number) => memberId === 'all' || id === memberId
  const [members, visits, docs, plans, reminders] = await Promise.all([
    db.members.toArray(),
    db.visits.toArray(),
    db.docs.toArray(),
    db.medPlans.where('active').equals(1).toArray(),
    db.reminders.where('done').equals(0).toArray(),
  ])
  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? '未知'
  const docIds = new Set<number>()
  const visitIds = new Set<number>()
  const planIds = new Set<number>()
  const reminderIds = new Set<number>()
  const docMeta = new Map<number, { title: string; date: string }>()
  const visitMeta = new Map<number, { title: string; date: string }>()

  const lines: string[] = []
  lines.push(`【家庭成员】${members.map((m) => `${m.name}(${m.relation})`).join('、')}`)

  // 就诊记录（最近的在前，最多 60 条）
  const vSorted = visits.filter((v) => inScope(v.memberId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
  lines.push('【就诊记录】编号 | 日期 | 类型 | 医院科室 | 诊断')
  for (const v of vSorted) {
    if (v.id == null) continue
    visitIds.add(v.id)
    visitMeta.set(v.id, { title: `${v.type}·${trim(v.hospital, 12)}`, date: v.date })
    lines.push(
      `V${v.id} | ${v.date} | ${v.type} | ${trim(v.hospital, 12)}${v.department ? ' ' + trim(v.department, 10) : ''} | 诊断:${trim(v.diagnosis, 24) || '未填'}`,
    )
  }

  // 单据（最近在前，最多 40 条）
  const dSorted = docs.filter((d) => inScope(d.memberId)).sort((a, b) => b.docDate.localeCompare(a.docDate)).slice(0, 40)
  lines.push('【单据】编号 | 日期 | 类型 | 标题 | 医院科室 | 诊断 | 金额(自付) | 药品 | 指标')
  for (const d of dSorted) {
    if (d.id == null) continue
    docIds.add(d.id)
    docMeta.set(d.id, { title: d.title, date: d.docDate })
    const meds = (d.aiMeta?.medications ?? []).slice(0, 4).map((m) => `${m.name}${m.dosage ?? ''}`).join('、')
    const inds = (d.aiMeta?.indicators ?? [])
      .slice(0, 6)
      .map((i) => `${i.name} ${i.value}${i.unit ?? ''}${i.flag && i.flag !== '正常' ? `[${i.flag}]` : ''}`)
      .join('；')
    const money = d.amount != null ? `¥${d.amount}${d.selfPaid != null ? `(自付${d.selfPaid})` : ''}` : '未填'
    lines.push(
      `D${d.id} | ${d.docDate} | ${d.category} | ${trim(d.title, 20)} | ${trim(d.hospital, 10)}${
        d.department ? ' ' + trim(d.department, 8) : ''
      } | ${trim(d.diagnosis, 18) || '-'} | ${money}${meds ? ` | 药品:${meds}` : ''}${inds ? ` | 指标:${inds}` : ''}`,
    )
  }

  // 用药计划
  const pSorted = plans.filter((p) => inScope(p.memberId))
  if (pSorted.length) {
    lines.push('【进行中的用药计划】')
    for (const p of pSorted) {
      if (p.id == null) continue
      planIds.add(p.id)
      lines.push(
        `P${p.id} | ${memberName(p.memberId)} | ${p.name} ${p.dosage ?? ''} ${p.timing ?? ''} 每日${p.timesPerDay}次(${p.times.join('/')}) 至${planEndDate(p)}`,
      )
    }
  }

  // 待办提醒
  const rSorted = reminders.filter((r) => inScope(r.memberId)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20)
  if (rSorted.length) {
    lines.push('【待办提醒】')
    for (const r of rSorted) {
      if (r.id == null) continue
      reminderIds.add(r.id)
      lines.push(`R${r.id} | ${memberName(r.memberId)} | ${r.kind}·${r.title} | ${r.date} ${r.time ?? ''}`)
    }
  }

  // 指标历史序列（按 成员+指标名 聚合，最多 12 项 × 最近 8 点）
  const seriesMap = new Map<string, { member: string; name: string; points: string[] }>()
  for (const d of dSorted) {
    for (const ind of d.aiMeta?.indicators ?? []) {
      const v = Number(String(ind.value).match(/-?\d+(?:\.\d+)?/)?.[0])
      if (!Number.isFinite(v)) continue
      const key = `${d.memberId}|${ind.name}`
      const item = seriesMap.get(key) ?? { member: memberName(d.memberId), name: ind.name, points: [] }
      const ref = ind.reference ? `(参考${ind.reference})` : ''
      const flag = ind.flag && ind.flag !== '正常' ? `[${ind.flag}]` : ''
      item.points.push(`${d.docDate} ${v}${ind.unit ?? ''}${ref}${flag}`)
      seriesMap.set(key, item)
    }
  }
  const seriesList = [...seriesMap.values()].slice(0, 12)
  if (seriesList.length) {
    lines.push('【指标历史】（同名指标按时间累计，从早到晚）')
    for (const s of seriesList) {
      const pts = s.points.slice(0, 8).reverse().join(' → ')
      lines.push(`${s.name}(${s.member}): ${pts}`)
    }
  }

  return {
    text: lines.join('\n'),
    docIds,
    visitIds,
    planIds,
    reminderIds,
    docMeta,
    visitMeta,
  }
}

export type AskRole = 'user' | 'assistant'
export interface AskMessage {
  role: AskRole
  content: string
}

/** 提问：首问携带档案摘要，之后靠 history 延续多轮 */
export async function askQuestion(
  cfg: AiConfig,
  context: AskContext,
  history: AskMessage[],
  question: string,
): Promise<string> {
  const messages: unknown[] = [{ role: 'system', content: ASK_SYSTEM }]
  for (const m of history) messages.push({ role: m.role, content: m.content })
  const withContext = history.length === 0
  messages.push({
    role: 'user',
    content: withContext ? `档案摘要：\n${context.text}\n\n我的问题：${question}` : question,
  })
  return chatCompletion(cfg, messages, 3000, true)
}
