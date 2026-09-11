import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { db, getSetting, type MedPlan } from '../db'
import { today } from '../lib/format'
import { defaultTimes } from '../lib/medParse'
import { Field, PageHeader, inputCls, toast } from '../components/ui'

const TIMINGS = ['任意', '餐前', '餐中', '餐后', '睡前']

export default function MedPlanFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id

  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])

  const [ready, setReady] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [name, setName] = useState('')
  const [dosage, setDosage] = useState('')
  const [timing, setTiming] = useState('餐后')
  const [timesPerDay, setTimesPerDay] = useState(3)
  const [times, setTimes] = useState<string[]>(defaultTimes(3))
  const [startDate, setStartDate] = useState(today())
  const [days, setDays] = useState('7')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (id) {
        const p = await db.medPlans.get(Number(id))
        if (p) {
          setMemberId(String(p.memberId))
          setName(p.name)
          setDosage(p.dosage ?? '')
          setTiming(p.timing ?? '餐后')
          setTimesPerDay(p.timesPerDay)
          setTimes(p.times)
          setStartDate(p.startDate)
          setDays(String(p.days))
          setNote(p.note ?? '')
        }
        setReady(true)
      } else {
        setMemberId(activeId != null ? String(activeId) : '')
        setReady(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const changeCount = (n: number) => {
    setTimesPerDay(n)
    setTimes((prev) => {
      const next = defaultTimes(n)
      for (let i = 0; i < Math.min(prev.length, n); i++) next[i] = prev[i]
      return next
    })
  }

  const setTime = (i: number, v: string) =>
    setTimes((prev) => prev.map((t, j) => (j === i ? v : t)))

  const save = async () => {
    if (!memberId) return toast('请先选择成员', 'err')
    if (!name.trim()) return toast('请填写药名', 'err')
    if (times.some((t) => !t)) return toast('请把每日时间点填完整', 'err')
    const d = Number(days)
    if (!Number.isFinite(d) || d < 1 || d > 365) return toast('连用天数需在 1~365 之间', 'err')
    setSaving(true)
    try {
      const now = Date.now()
      const old = id ? await db.medPlans.get(Number(id)) : undefined
      const payload: MedPlan = {
        ...(id ? { id: Number(id) } : {}),
        memberId: Number(memberId),
        name: name.trim(),
        dosage: dosage.trim() || undefined,
        timing: timing,
        timesPerDay,
        times,
        startDate,
        days: d,
        sourceDocId: old?.sourceDocId,
        note: note.trim() || undefined,
        active: 1,
        createdAt: old?.createdAt ?? now,
      }
      await db.medPlans.put(payload)
      toast('用药计划已保存')
      navigate('/reminders')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!id) return
    if (!confirm('删除该用药计划及其全部打卡记录？')) return
    await db.transaction('rw', db.medPlans, db.medLogs, async () => {
      await db.medLogs.where('planId').equals(Number(id)).delete()
      await db.medPlans.delete(Number(id))
    })
    toast('已删除')
    navigate('/reminders')
  }

  if (!ready) return null

  return (
    <div className="pb-24">
      <PageHeader
        back
        title={editing ? '编辑用药计划' : '用药计划'}
        actions={
          <button
            onClick={save}
            disabled={saving}
            className="rounded-full bg-teal-600 px-4 py-1.5 text-sm font-medium text-white active:bg-teal-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : '保存'}
          </button>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <Field label="成员 *">
            <select className={inputCls} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">请选择</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.relation}）
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="药名 *">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：阿莫西林"
              />
            </Field>
            <Field label="每次剂量">
              <input
                className={inputCls}
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="如：0.5g / 2片"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="服用时机">
              <select className={inputCls} value={timing} onChange={(e) => setTiming(e.target.value)}>
                {TIMINGS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="每日次数">
              <select
                className={inputCls}
                value={timesPerDay}
                onChange={(e) => changeCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    每日 {n} 次
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="每日时间点 *">
            <div className="flex flex-wrap gap-2">
              {times.map((t, i) => (
                <input
                  key={i}
                  type="time"
                  className={`${inputCls} w-28`}
                  value={t}
                  onChange={(e) => setTime(i, e.target.value)}
                />
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="开始日期 *">
              <input
                type="date"
                className={inputCls}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="连用天数 *">
              <input
                inputMode="numeric"
                className={inputCls}
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
                placeholder="如：7"
              />
            </Field>
          </div>
          <Field label="备注">
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：连服7天（来自处方）"
            />
          </Field>
        </div>

        {editing && (
          <button
            onClick={remove}
            className="w-full rounded-xl bg-rose-50 py-2.5 text-sm font-medium text-rose-600 active:bg-rose-100"
          >
            删除此计划
          </button>
        )}
      </div>
    </div>
  )
}
