import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { CalendarPlus, Bell, Camera, ChevronRight, UserPlus } from 'lucide-react'
import {
  db,
  getSetting,
  APP_VERSION,
  VISIT_TYPE_STYLE,
  type MedDoc,
  type MedPlan,
  type Visit,
} from '../db'
import { today, fmtDate, fmtMoney } from '../lib/format'
import { addDays, planEndDate } from '../lib/medParse'
import { MemberChips, PageHeader } from '../components/ui'
import { DocThumb } from '../components/doc'

export default function HomePage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const ready = activeId !== undefined
  const scopeIds = activeId == null ? members.map((m) => m.id!) : [activeId]

  const recentVisits = useLiveQuery(async () => {
    const all = await db.visits.toArray()
    all.sort((a, b) => (a.date < b.date ? 1 : -1))
    return all.filter((v) => scopeIds.includes(v.memberId)).slice(0, 3)
  }, [activeId, members.length])

  const recentDocs = useLiveQuery(async () => {
    const all = await db.docs.toArray()
    all.sort((a, b) => b.createdAt - a.createdAt)
    return all.filter((d) => scopeIds.includes(d.memberId)).slice(0, 8)
  }, [activeId, members.length])

  // 提醒概览
  const t0 = today()
  const activePlans = useLiveQuery(async () => {
    const all = await db.medPlans.where('active').equals(1).toArray()
    all.sort((a, b) => a.createdAt - b.createdAt)
    return all
  }, [])
  const logsToday = useLiveQuery(() => db.medLogs.where('date').equals(t0).toArray(), [])
  const nextReminder = useLiveQuery(async () => {
    const all = await db.reminders.where('done').equals(0).toArray()
    const up = all.filter((r) => r.date >= t0).sort((a, b) => a.date.localeCompare(b.date))
    return up[0]
  }, [])
  const todayPlans: MedPlan[] = (activePlans ?? []).filter((p) => p.startDate <= t0 && planEndDate(p) >= t0)
  const medTotal = todayPlans.reduce((s, p) => s + p.times.length, 0)
  const medTaken = (logsToday ?? []).filter((l) =>
    todayPlans.some((p) => p.id === l.planId && p.times.includes(l.time)),
  ).length

  if (!ready) return null

  return (
    <div>
      <PageHeader title="家庭健康档案" />
      <p className="px-4 pt-1 text-right text-[10px] text-stone-300">{APP_VERSION}</p>

      {/* 成员切换 */}
      <div className="pt-2">
        <MemberChips
          members={members}
          value={activeId ?? null}
          onChange={(id) => db.settings.put({ key: 'activeMemberId', value: id })}
        />
      </div>

      {members.length === 0 ? (
        <div className="mx-4 mt-4 rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="text-4xl">🏠</div>
          <div className="mt-3 text-[17px] font-semibold">欢迎使用家庭健康档案</div>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            数据只保存在你自己的设备上。
            <br />
            三步开始：① 添加家庭成员 → ② 记录就诊 → ③ 拍单据归档
          </p>
          <Link
            to="/settings"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 font-medium text-white active:bg-teal-700"
          >
            <UserPlus size={18} /> 先去添加成员
          </Link>
        </div>
      ) : (
        <>
          {/* 快捷操作 */}
          <div className="mx-4 mt-3 grid grid-cols-2 gap-3">
            <Link
              to="/docs/new"
              className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:bg-stone-100"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                <Camera size={20} />
              </div>
              <div>
                <div className="text-[15px] font-medium">拍单据</div>
                <div className="text-xs text-stone-400">拍照 / 上传归档</div>
              </div>
            </Link>
            <Link
              to="/visits/new"
              className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:bg-stone-100"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
                <CalendarPlus size={20} />
              </div>
              <div>
                <div className="text-[15px] font-medium">记就诊</div>
                <div className="text-xs text-stone-400">门诊 / 体检 / 住院</div>
              </div>
            </Link>
          </div>

          {/* 今日提醒 */}
          {((activePlans?.length ?? 0) > 0 || nextReminder) && (
            <div className="mx-4 mt-3">
              <Link
                to="/reminders"
                className="block rounded-2xl bg-white p-4 shadow-sm active:bg-stone-100"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                    <Bell size={16} className="text-teal-600" /> 今日提醒
                  </span>
                  {medTotal > 0 && (
                    <span className="text-xs text-stone-400">
                      今日用药 {medTaken}/{medTotal} 已服
                    </span>
                  )}
                </div>
                {medTotal > 0 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${Math.round((medTaken / medTotal) * 100)}%` }}
                    />
                  </div>
                )}
                {nextReminder && (
                  <div className="mt-2 truncate text-xs text-stone-500">
                    <span className={nextReminder.date < t0 ? 'text-rose-500' : ''}>
                      {nextReminder.date === t0 ? '今天' : nextReminder.date === addDays(t0, 1) ? '明天' : nextReminder.date}
                    </span>{' '}
                    · {nextReminder.kind}·{nextReminder.title}
                  </div>
                )}
              </Link>
            </div>
          )}

          {/* 最近就诊 */}
          <Section title="最近就诊" moreTo="/visits" moreText="全部就诊">
            {(recentVisits ?? []).length === 0 ? (
              <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
                还没有就诊记录，点上方「记就诊」添加
              </div>
            ) : (
              (recentVisits ?? []).map((v) => <VisitRow key={v.id} visit={v} />)
            )}
          </Section>

          {/* 最近单据 */}
          <Section title="最近单据" moreTo="/docs" moreText="全部单据">
            {(recentDocs ?? []).length === 0 ? (
              <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
                还没有单据，点上方「拍单据」添加
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(recentDocs ?? []).map((d) => (
                  <DocCard key={d.id} doc={d} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  moreTo,
  moreText,
  children,
}: {
  title: string
  moreTo: string
  moreText: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between px-4">
        <span className="text-[15px] font-semibold">{title}</span>
        <Link to={moreTo} className="flex items-center text-xs text-stone-400">
          {moreText} <ChevronRight size={14} />
        </Link>
      </div>
      <div className="px-4">{children}</div>
    </div>
  )
}

function VisitRow({ visit }: { visit: Visit }) {
  const style = VISIT_TYPE_STYLE[visit.type]
  return (
    <Link
      to={`/visits/${visit.id}`}
      className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:bg-stone-100"
    >
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.chip}`}>
        {visit.type}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px]">
          {visit.hospital || '未填医院'}
          {visit.department ? ` · ${visit.department}` : ''}
        </div>
        <div className="truncate text-xs text-stone-400">
          {fmtDate(visit.date)}
          {visit.diagnosis ? ` · ${visit.diagnosis}` : ''}
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-stone-300" />
    </Link>
  )
}

function DocCard({ doc }: { doc: MedDoc }) {
  return (
    <Link
      to={`/docs/${doc.id}`}
      className="overflow-hidden rounded-2xl bg-white shadow-sm active:bg-stone-100"
    >
      <span className="ratio-4-3 w-full">
        <DocThumb doc={doc} className="fill-abs" />
      </span>
      <div className="p-2.5">
        <div className="truncate text-[13px] font-medium">{doc.title}</div>
        <div className="mt-0.5 flex items-center justify-between text-xs text-stone-400">
          <span>{fmtDate(doc.docDate)}</span>
          <span className="text-teal-700">{doc.amount != null ? fmtMoney(doc.amount) : ''}</span>
        </div>
      </div>
    </Link>
  )
}
