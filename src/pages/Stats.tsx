import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Loader2, Sparkles } from 'lucide-react'
import {
  CATEGORY_GROUPS,
  db,
  getSetting,
  VISIT_TYPE_STYLE,
  type DocCategory,
  type MedDoc,
  type Visit,
} from '../db'
import { fmtMoney } from '../lib/format'
import { AiConfig, DEFAULT_AI, analyzeIndicator } from '../lib/ai'
import { MemberChips, PageHeader, toast } from '../components/ui'

const docGroup = (c: DocCategory): string =>
  CATEGORY_GROUPS.find((g) => g.cats.includes(c))?.group ?? '其他'

function parseNum(v?: string): number | null {
  if (!v) return null
  const m = v.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

function parseRef(s?: string): { min: number; max: number } | null {
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)\s*[-~～]\s*(\d+(?:\.\d+)?)/)
  if (!m) return null
  const min = Number(m[1])
  const max = Number(m[2])
  return min < max ? { min, max } : null
}

interface SavedAnalysis {
  text: string
  at: number
  model?: string
}

export default function StatsPage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const [memberFilter, setMemberFilter] = useState<number | 'all' | null>(null)
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [spendingDetail, setSpendingDetail] = useState(false)

  useEffect(() => {
    if (memberFilter === null && activeId !== undefined) setMemberFilter(activeId ?? 'all')
  }, [activeId, memberFilter])

  const docs = useLiveQuery(() => db.docs.toArray(), []) ?? []
  const visits = useLiveQuery(() => db.visits.toArray(), []) ?? []

  const memberName = (id: number | 'all') =>
    id === 'all' ? '全家' : (members.find((m) => m.id === id)?.name ?? '—')

  const filteredDocs = useMemo(
    () =>
      docs.filter((d) => (memberFilter === 'all' || memberFilter === null ? true : d.memberId === memberFilter)),
    [docs, memberFilter],
  )
  const filteredVisits = useMemo(
    () =>
      visits
        .filter((v) => (memberFilter === 'all' || memberFilter === null ? true : v.memberId === memberFilter))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [visits, memberFilter],
  )

  // ---------- 指标趋势 + AI 分析 ----------
  interface IndicatorPoint {
    name: string
    value: number
    unit?: string
    reference?: string
    flag?: string
    date: string
  }
  const indicatorPoints = useMemo(() => {
    const out: IndicatorPoint[] = []
    for (const d of filteredDocs) {
      for (const ind of d.aiMeta?.indicators ?? []) {
        const v = parseNum(ind.value)
        if (v == null) continue
        out.push({ name: ind.name, value: v, unit: ind.unit, reference: ind.reference, flag: ind.flag, date: d.docDate })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredDocs])
  const indicatorNames = useMemo(
    () => [...new Set(indicatorPoints.map((p) => p.name))].sort(),
    [indicatorPoints],
  )
  const [selectedIndicator, setSelectedIndicator] = useState<string | null>(null)
  const activeIndicator = selectedIndicator && indicatorNames.includes(selectedIndicator) ? selectedIndicator : indicatorNames[0]
  const series = useMemo(
    () => indicatorPoints.filter((p) => p.name === activeIndicator),
    [indicatorPoints, activeIndicator],
  )

  const analysisKey =
    memberFilter != null && activeIndicator ? `ind-analysis:${String(memberFilter)}:${activeIndicator}` : null
  const [analysis, setAnalysis] = useState<SavedAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)

  useEffect(() => {
    setAnalysis(null)
    setAnalysisError(null)
    if (!analysisKey) return
    db.settings
      .get(analysisKey)
      .then((row) => {
        const v = row?.value as SavedAnalysis | undefined
        if (v?.text) setAnalysis(v)
      })
      .catch(() => {})
  }, [analysisKey])

  const runAnalysis = async () => {
    const cfg = (await getSetting<AiConfig>('aiConfig', DEFAULT_AI)) as AiConfig
    if (!cfg.apiKey) {
      toast('请先在设置中配置 AI Key', 'err')
      return
    }
    if (!activeIndicator || series.length === 0) return
    setAnalyzing(true)
    setAnalysisError(null)
    try {
      const text = await analyzeIndicator(
        cfg,
        memberName(memberFilter ?? 'all'),
        activeIndicator,
        series.map((p) => ({ date: p.date, value: p.value, unit: p.unit, reference: p.reference, flag: p.flag })),
      )
      const saved: SavedAnalysis = { text, at: Date.now(), model: cfg.model }
      if (analysisKey) await db.settings.put({ key: analysisKey, value: saved })
      setAnalysis(saved)
      toast('分析完成')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAnalysisError(msg)
      toast('分析失败：' + msg, 'err')
    } finally {
      setAnalyzing(false)
    }
  }

  // ---------- 花费统计 ----------
  const amountDocs = filteredDocs.filter((d) => d.amount != null)
  const yearDocs = amountDocs.filter((d) => year === 'all' || d.docDate.startsWith(String(year)))
  const totalAmount = yearDocs.reduce((s, d) => s + (d.amount ?? 0), 0)
  const totalSelf = yearDocs.reduce((s, d) => s + (d.selfPaid ?? 0), 0)

  const monthly = useMemo(() => {
    if (year === 'all') {
      const byYear = new Map<string, { total: number; self: number }>()
      for (const d of amountDocs) {
        const y = d.docDate.slice(0, 4)
        const cur = byYear.get(y) ?? { total: 0, self: 0 }
        cur.total += d.amount ?? 0
        cur.self += d.selfPaid ?? 0
        byYear.set(y, cur)
      }
      return [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, v]) => ({
        label: `${y}年`,
        total: v.total,
        self: v.self,
      }))
    }
    const arr = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, total: 0, self: 0 }))
    for (const d of yearDocs) {
      const m = Number(d.docDate.slice(5, 7)) - 1
      if (m >= 0 && m < 12) {
        arr[m].total += d.amount ?? 0
        arr[m].self += d.selfPaid ?? 0
      }
    }
    return arr
  }, [amountDocs, yearDocs, year])

  const byGroup = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of yearDocs) {
      const g = docGroup(d.category)
      map.set(g, (map.get(g) ?? 0) + (d.amount ?? 0))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [yearDocs])

  const byHospital = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of yearDocs) {
      const h = d.hospital?.trim() || '未填医院'
      map.set(h, (map.get(h) ?? 0) + (d.amount ?? 0))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [yearDocs])

  if (memberFilter === null) return null

  return (
    <div>
      <PageHeader title="统计分析" />
      <div className="pt-3">
        <MemberChips
          members={members}
          value={memberFilter === 'all' ? null : memberFilter}
          onChange={(id) => setMemberFilter(id)}
        />
      </div>

      {/* ---------- 指标趋势（重点） ---------- */}
      <section className="mt-3">
        <div className="mb-2 px-4">
          <span className="text-[15px] font-semibold">健康指标趋势</span>
        </div>
        <div className="px-4">
          {indicatorNames.length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
              还没有可绘制的化验指标——AI 识别化验单后，指标会自动存入这里
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
                {indicatorNames.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSelectedIndicator(n)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${
                      activeIndicator === n
                        ? 'bg-teal-600 font-medium text-white'
                        : 'border border-stone-200 text-stone-600'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <IndicatorChart
                series={series.filter((p) => p.name === activeIndicator)}
                name={activeIndicator ?? ''}
              />

              {/* AI 分析 */}
              <div className="mt-3 border-t border-stone-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600">
                    <Sparkles size={14} className="text-teal-600" /> AI 分析趋势
                  </span>
                  {analysis && (
                    <button
                      onClick={runAnalysis}
                      disabled={analyzing}
                      className="flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 active:bg-teal-200 disabled:opacity-60"
                    >
                      {analyzing && <Loader2 size={12} className="animate-spin" />}
                      {analyzing ? '分析中…' : '重新分析'}
                    </button>
                  )}
                </div>
                {analysis ? (
                  <>
                    <p
                      className={`mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700 ${
                        analyzing ? 'opacity-40' : ''
                      }`}
                    >
                      {analysis.text}
                    </p>
                    {analyzing && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-teal-700">
                        <Loader2 size={13} className="animate-spin" />
                        正在分析，约需 10~30 秒…
                      </div>
                    )}
                    <p className="mt-2 text-xs text-stone-400">
                      生成于 {fmtDateTimeSafe(analysis.at)} · 仅基于检测记录 · AI 仅供参考，请以医生意见为准
                    </p>
                  </>
                ) : (
                  <div className="mt-2">
                    <button
                      onClick={runAnalysis}
                      disabled={analyzing}
                      className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 active:bg-teal-100 disabled:opacity-60"
                    >
                      {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {analyzing ? '分析中…' : 'AI 分析趋势与建议'}
                    </button>
                    <p className="mt-2 text-xs text-stone-400">
                      基于该指标的全部历史检测记录，给出趋势判断、当前状态与复查/生活建议
                    </p>
                  </div>
                )}
                {analysisError && (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-600">
                    分析失败：{analysisError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- 花费统计（精简） ---------- */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between px-4">
          <span className="text-[15px] font-semibold">医疗花费</span>
          <div className="flex gap-1.5">
            {[
              { v: new Date().getFullYear(), label: '今年' },
              { v: new Date().getFullYear() - 1, label: '去年' },
              { v: 'all' as const, label: '全部' },
            ].map((o) => (
              <button
                key={o.label}
                onClick={() => setYear(o.v)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  year === o.v ? 'bg-teal-600 font-medium text-white' : 'border border-stone-200 bg-white text-stone-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="总支出" value={fmtMoney(totalAmount)} strong />
            <StatCard label="其中自付" value={fmtMoney(totalSelf)} />
            <StatCard label="计费单据" value={`${yearDocs.length} 张`} />
          </div>

          {monthly.length > 0 && (
            <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-3 text-[13px] font-medium text-stone-500">
                {year === 'all' ? '历年支出' : '月度支出'}（柱内深色为自付）
              </div>
              <BarChart data={monthly.map((m) => ({ label: m.label, value: m.total, sub: m.self }))} />
            </div>
          )}
          {yearDocs.length === 0 && (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
              该范围内没有带金额的单据（录入发票/清单时填写金额即可统计）
            </div>
          )}

          <button
            onClick={() => setSpendingDetail((v) => !v)}
            className="mt-3 w-full rounded-2xl bg-white py-2.5 text-xs font-medium text-teal-600 shadow-sm active:bg-stone-100"
          >
            {spendingDetail ? '收起类别 / 医院分布 ▴' : '查看类别 / 医院分布 ▾'}
          </button>
          {spendingDetail && (
            <>
              {byGroup.length > 0 && (
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
                  <div className="mb-3 text-[13px] font-medium text-stone-500">按单据类别（体检与就诊分开统计）</div>
                  <HBarList
                    items={byGroup.map(([label, v]) => ({ label, value: v, display: fmtMoney(v) }))}
                    max={Math.max(...byGroup.map((x) => x[1]))}
                  />
                </div>
              )}
              {byHospital.length > 0 && (
                <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
                  <div className="mb-3 text-[13px] font-medium text-stone-500">医院分布 Top{byHospital.length}</div>
                  <HBarList
                    items={byHospital.map(([label, v]) => ({ label, value: v, display: fmtMoney(v) }))}
                    max={Math.max(...byHospital.map((x) => x[1]))}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ---------- 就诊时间线 ---------- */}
      <section className="mt-6">
        <div className="mb-2 px-4">
          <span className="text-[15px] font-semibold">就诊时间线</span>
        </div>
        <div className="px-4 pb-6">
          {filteredVisits.length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">暂无就诊记录</div>
          ) : (
            <Timeline visits={filteredVisits} docs={docs} />
          )}
        </div>
      </section>
    </div>
  )
}

function fmtDateTimeSafe(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- 小组件 ----------

function StatCard({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
      <div className="text-xs text-stone-400">{label}</div>
      <div className={`mt-1 text-[15px] ${strong ? 'font-semibold text-teal-700' : 'font-medium'}`}>{value}</div>
    </div>
  )
}

function BarChart({ data }: { data: { label: string; value: number; sub: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {data.map((d) => {
          const h = Math.max(2, Math.round((d.value / max) * 100))
          const subH = d.value > 0 ? Math.round((d.sub / d.value) * h) : 0
          return (
            <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center justify-end">
              {d.value > 0 && (
                <span className="mb-0.5 text-[9px] text-stone-400">{Math.round(d.value)}</span>
              )}
              <div className="relative w-full max-w-8 overflow-hidden rounded-t bg-teal-100" style={{ height: `${h}%` }}>
                <div className="absolute bottom-0 w-full bg-teal-600" style={{ height: `${(subH / h) * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d) => (
          <div key={d.label} className="min-w-0 flex-1 truncate text-center text-[9px] text-stone-400">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

function HBarList({
  items,
  max,
}: {
  items: { label: string; value: number; display: string }[]
  max: number
}) {
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="min-w-0 truncate text-stone-600">{it.label}</span>
            <span className="shrink-0 font-medium text-stone-700">{it.display}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${Math.max(3, Math.round((it.value / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function IndicatorChart({
  series,
  name,
}: {
  series: { name: string; value: number; unit?: string; reference?: string; flag?: string; date: string }[]
  name: string
}) {
  if (series.length === 0) {
    return <div className="py-6 text-center text-sm text-stone-400">该指标没有可绘制的数值</div>
  }
  const W = 340
  const H = 170
  const padL = 34
  const padR = 12
  const padT = 12
  const padB = 26
  const values = series.map((p) => p.value)
  let min = Math.min(...values)
  let max = Math.max(...values)
  const ref = parseRef(series.find((p) => p.reference)?.reference)
  if (ref) {
    min = Math.min(min, ref.min)
    max = Math.max(max, ref.max)
  }
  const span = max - min || 1
  min -= span * 0.15
  max += span * 0.15
  const x = (i: number) =>
    padL + (series.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (series.length - 1))
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB)
  const polyline = series.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')
  const unit = series.find((p) => p.unit)?.unit ?? ''
  const last = series[series.length - 1]

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-stone-700">
          {name}
          {unit ? `（${unit}）` : ''}
        </span>
        <span className="text-stone-400">
          最新 {last.value}
          {last.flag && last.flag !== '正常' ? `（${last.flag}）` : ''} · {last.date}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ref && (
          <rect
            x={padL}
            y={y(ref.max)}
            width={W - padL - padR}
            height={Math.max(2, y(ref.min) - y(ref.max))}
            fill="#10b981"
            opacity="0.12"
          />
        )}
        {ref && (
          <>
            <text x={4} y={y(ref.max) + 4} fontSize="9" fill="#6b7280">
              {ref.max}
            </text>
            <text x={4} y={y(ref.min) + 4} fontSize="9" fill="#6b7280">
              {ref.min}
            </text>
          </>
        )}
        <polyline points={polyline} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinejoin="round" />
        {series.map((p, i) => {
          const abnormal = p.flag && p.flag !== '正常'
          return (
            <g key={i}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={series.length > 12 ? 2.5 : 3.5}
                fill={abnormal ? '#e11d48' : '#0d9488'}
              />
              {series.length <= 8 && (
                <text x={x(i)} y={y(p.value) - 8} fontSize="9" textAnchor="middle" fill="#334155">
                  {p.value}
                </text>
              )}
            </g>
          )
        })}
        <text x={padL} y={H - 8} fontSize="9" fill="#9ca3af">
          {series[0].date}
        </text>
        <text x={W - padR} y={H - 8} fontSize="9" textAnchor="end" fill="#9ca3af">
          {last.date}
        </text>
      </svg>
      <div className="mt-1 flex gap-3 text-[10px] text-stone-400">
        <span>· 绿色区带 = 参考区间</span>
        <span>· 红点 = 标记异常</span>
      </div>
    </div>
  )
}

function Timeline({ visits, docs }: { visits: Visit[]; docs: MedDoc[] }) {
  const years = [...new Set(visits.map((v) => v.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a))
  return (
    <div>
      {years.map((y) => (
        <div key={y} className="mb-2">
          <div className="py-1 text-sm font-semibold text-stone-500">{y}年</div>
          <div className="ml-3 space-y-3 border-l-2 border-stone-200 py-1 pl-4">
            {visits
              .filter((v) => v.date.startsWith(y))
              .map((v) => {
                const vd = docs.filter((d) => d.visitId === v.id)
                const sum = vd.reduce((s, d) => s + (d.amount ?? 0), 0)
                return (
                  <div key={v.id} className="relative">
                    <span className="absolute -left-[22px] top-4 h-2.5 w-2.5 rounded-full bg-teal-500 ring-2 ring-white" />
                    <Link
                      to={`/visits/${v.id}`}
                      className="block rounded-2xl bg-white p-3.5 shadow-sm active:bg-stone-100"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${VISIT_TYPE_STYLE[v.type].chip}`}>
                          {v.type}
                        </span>
                        <span className="text-xs text-stone-400">{v.date}</span>
                        {sum > 0 && <span className="ml-auto text-xs font-medium text-teal-700">{fmtMoney(sum)}</span>}
                      </div>
                      <div className="mt-1 truncate text-sm">
                        {v.hospital || '未填医院'}
                        {v.department ? ` · ${v.department}` : ''}
                      </div>
                      {v.diagnosis && <div className="truncate text-xs text-stone-500">诊断：{v.diagnosis}</div>}
                      {vd.length > 0 && (
                        <div className="mt-0.5 text-xs text-stone-400">关联单据 {vd.length} 张</div>
                      )}
                    </Link>
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
