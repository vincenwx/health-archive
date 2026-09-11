import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { CalendarDays, Check, ChevronRight, Pill, Plus } from 'lucide-react'
import dayjs from 'dayjs'
import { db, type MedPlan, type MedReminder } from '../db'
import { today } from '../lib/format'
import { addDays, planEndDate } from '../lib/medParse'
import { buildIcs, downloadIcsFile, type IcsEvent } from '../lib/ics'
import { PageHeader, toast } from '../components/ui'

export default function RemindersPage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const plans = useLiveQuery(async () => {
    const all = await db.medPlans.where('active').equals(1).toArray()
    all.sort((a, b) => a.createdAt - b.createdAt)
    return all
  }, [])
  const reminders = useLiveQuery(async () => {
    const all = await db.reminders.where('done').equals(0).toArray()
    all.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
    return all
  }, [])
  const logsToday = useLiveQuery(() => db.medLogs.where('date').equals(today()).toArray(), [])

  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? ''
  const t = today()
  const inToday = (p: MedPlan) => p.startDate <= t && planEndDate(p) >= t

  const schedule = useMemo(
    () =>
      (plans ?? [])
        .filter(inToday)
        .flatMap((p) => p.times.map((time) => ({ p, time }))),
    [plans],
  )
  const taken = (logsToday ?? []).filter((l) =>
    schedule.some((s) => s.p.id === l.planId && s.time === l.time),
  ).length
  const total = schedule.length

  const toggleLog = async (p: MedPlan, time: string) => {
    const l = (logsToday ?? []).find((x) => x.planId === p.id && x.time === time)
    if (l?.id) {
      await db.medLogs.delete(l.id)
    } else {
      await db.medLogs.add({ planId: p.id!, memberId: p.memberId, date: t, time, ts: Date.now() })
    }
  }

  const endPlan = async (p: MedPlan) => {
    if (!confirm(`结束「${p.name}」的用药计划？（记录保留，可随时删除）`)) return
    await db.medPlans.update(p.id!, { active: 0 })
    toast('计划已结束')
  }

  const markDone = async (r: MedReminder) => {
    await db.reminders.update(r.id!, { done: 1 })
    toast('已完成')
  }

  const dayLabel = (d: string): { text: string; urgent: boolean } => {
    if (d === t) return { text: '今天', urgent: true }
    if (d === addDays(t, 1)) return { text: '明天', urgent: false }
    const diff = dayjs(d).diff(dayjs(t), 'day')
    if (diff < 0) return { text: `已过${-diff}天`, urgent: true }
    return { text: `${diff}天后`, urgent: false }
  }

  const exportAll = () => {
    const events: IcsEvent[] = []
    const endCap = addDays(t, 29)
    for (const p of plans ?? []) {
      if (p.startDate > endCap) continue
      let d = p.startDate > t ? p.startDate : t
      const end = planEndDate(p) < endCap ? planEndDate(p) : endCap
      while (d <= end) {
        for (const time of p.times) {
          events.push({
            title: `服药·${p.name}${p.dosage ?? ''}`,
            date: d,
            time,
            durationMin: 15,
            note: `${memberName(p.memberId)}${p.timing ? '，' + p.timing : ''}${
              p.note ? '，' + p.note : ''
            }`,
            alarmMin: 10,
          })
        }
        d = addDays(d, 1)
      }
    }
    for (const r of reminders ?? []) {
      events.push({
        title: `${r.kind}·${r.title}`,
        date: r.date,
        time: r.time ?? '09:00',
        durationMin: 60,
        note: `${memberName(r.memberId)}${r.note ? '，' + r.note : ''}`,
        alarmMin: 30,
      })
    }
    if (!events.length) {
      toast('暂无可导出的提醒', 'err')
      return
    }
    downloadIcsFile(buildIcs(events), `健康提醒-${t}.ics`)
    toast(`已导出 ${events.length} 条日历提醒，请在手机日历应用中打开该文件导入`)
  }

  const exportPlan = (p: MedPlan) => {
    const events: IcsEvent[] = []
    let d = p.startDate > t ? p.startDate : t
    const end = planEndDate(p) < addDays(t, 29) ? planEndDate(p) : addDays(t, 29)
    while (d <= end) {
      for (const time of p.times) {
        events.push({
          title: `服药·${p.name}${p.dosage ?? ''}`,
          date: d,
          time,
          durationMin: 15,
          note: `${memberName(p.memberId)}${p.timing ? '，' + p.timing : ''}`,
          alarmMin: 10,
        })
      }
      d = addDays(d, 1)
    }
    downloadIcsFile(buildIcs(events), `用药计划-${p.name}.ics`)
    toast(`已导出 ${events.length} 条日历提醒`)
  }

  return (
    <div>
      <PageHeader
        title="提醒"
        actions={
          <button
            onClick={exportAll}
            className="flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 active:bg-stone-100"
          >
            <CalendarDays size={14} /> 导出日历
          </button>
        }
      />

      {/* 今日用药 */}
      <section className="pt-3">
        <div className="mb-2 flex items-center justify-between px-4">
          <span className="text-[15px] font-semibold">
            今日用药
            {total > 0 && <span className="ml-2 text-xs font-normal text-stone-400">{taken}/{total} 已服</span>}
          </span>
          <Link to="/plans/new" className="flex items-center text-xs text-teal-600">
            <Plus size={14} /> 用药计划
          </Link>
        </div>
        <div className="px-4">
          {total === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
              {plans?.length
                ? '今天没有排班内的用药（计划未开始或已结束）'
                : '还没有用药计划，点右上角「用药计划」添加'}
            </div>
          ) : (
            schedule.map(({ p, time }) => {
              const done = (logsToday ?? []).some((l) => l.planId === p.id && l.time === time)
              return (
                <div
                  key={`${p.id}-${time}`}
                  className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm"
                >
                  <span className="w-12 shrink-0 text-center text-sm font-semibold text-stone-600">
                    {time}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px]">
                      {p.name}
                      {p.dosage && <span className="ml-1 text-xs text-stone-400">{p.dosage}</span>}
                    </div>
                    <div className="truncate text-xs text-stone-400">
                      {memberName(p.memberId)}
                      {p.timing ? ` · ${p.timing}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleLog(p, time)}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${
                      done
                        ? 'bg-emerald-500 text-white'
                        : 'border border-teal-200 bg-teal-50 text-teal-700 active:bg-teal-100'
                    }`}
                  >
                    {done && <Check size={13} />}
                    {done ? '已服' : '服药'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* 即将提醒（复诊/复查/疫苗） */}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between px-4">
          <span className="text-[15px] font-semibold">复诊 / 复查 / 疫苗</span>
          <Link to="/reminders/new" className="flex items-center text-xs text-teal-600">
            <Plus size={14} /> 添加提醒
          </Link>
        </div>
        <div className="px-4">
          {(reminders ?? []).length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
              暂无日程提醒，医生说「X月X日来复诊」时记得加一条
            </div>
          ) : (
            (reminders ?? []).map((r) => {
              const lb = dayLabel(r.date)
              const overdue = r.date < t
              return (
                <div
                  key={r.id}
                  className={`mb-2 flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ${
                    overdue ? 'border-l-4 border-rose-400' : ''
                  }`}
                >
                  <div className="w-12 shrink-0 text-center">
                    <div className={`text-xs font-medium ${lb.urgent ? 'text-rose-500' : 'text-stone-400'}`}>
                      {lb.text}
                    </div>
                    <div className="text-[11px] text-stone-400">{r.date.slice(5)}</div>
                  </div>
                  <Link to={`/reminders/${r.id}/edit`} className="min-w-0 flex-1">
                    <div className="truncate text-[15px]">
                      <span
                        className={`mr-1.5 rounded px-1.5 py-0.5 text-[11px] ${
                          r.kind === '复诊'
                            ? 'bg-sky-100 text-sky-700'
                            : r.kind === '复查'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {r.kind}
                      </span>
                      {r.title}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-stone-400">
                      {memberName(r.memberId)} · {r.time ?? '09:00'}
                      {r.note ? ` · ${r.note}` : ''}
                    </div>
                  </Link>
                  <button
                    onClick={() => markDone(r)}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 active:bg-emerald-100"
                    aria-label="标记完成"
                  >
                    <Check size={13} /> 完成
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* 全部用药计划 */}
      <section className="mt-5">
        <div className="mb-2 px-4">
          <span className="text-[15px] font-semibold">全部用药计划</span>
        </div>
        <div className="px-4">
          {(plans ?? []).length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">暂无进行中的计划</div>
          ) : (
            (plans ?? []).map((p) => {
              const dl = dayjs(planEndDate(p)).diff(dayjs(t), 'day')
              return (
                <div key={p.id} className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
                    <Pill size={18} />
                  </div>
                  <Link to={`/plans/${p.id}/edit`} className="min-w-0 flex-1">
                    <div className="truncate text-[15px]">
                      {p.name}
                      {p.dosage && <span className="ml-1 text-xs text-stone-400">{p.dosage}</span>}
                    </div>
                    <div className="truncate text-xs text-stone-400">
                      {memberName(p.memberId)} · 每日{p.timesPerDay}次（{p.times.join(' ')}） ·{' '}
                      {p.startDate.slice(5)}~{planEndDate(p).slice(5)}
                    </div>
                  </Link>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                      dl < 0 ? 'bg-stone-100 text-stone-400' : dl === 0 ? 'bg-amber-100 text-amber-700' : 'bg-teal-50 text-teal-700'
                    }`}
                  >
                    {dl < 0 ? '已到期' : dl === 0 ? '最后一天' : `剩${dl}天`}
                  </span>
                  <button
                    onClick={() => exportPlan(p)}
                    className="shrink-0 rounded-full p-2 text-stone-400 active:bg-stone-100"
                    aria-label="导出此计划到日历"
                  >
                    <CalendarDays size={16} />
                  </button>
                  <button
                    onClick={() => endPlan(p)}
                    className="shrink-0 rounded-full p-2 text-stone-400 active:bg-stone-100"
                    aria-label="结束计划"
                  >
                    <ChevronRight size={16} className="rotate-90" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

      <p className="mt-4 px-5 text-xs leading-5 text-stone-400">
        提示：点「导出日历」生成 .ics 文件，在手机上打开即可把提醒写入系统日历——由系统日历负责准点提醒，
        iPhone 和鸿蒙都支持。计划结束后可在列表中结束或删除。
      </p>
    </div>
  )
}
