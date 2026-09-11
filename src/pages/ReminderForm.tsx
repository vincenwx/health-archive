import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { db, getSetting, REMINDER_KINDS, type MedReminder, type ReminderKind } from '../db'
import { today } from '../lib/format'
import { Field, PageHeader, inputCls, toast } from '../components/ui'

export default function ReminderFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id

  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])

  const [ready, setReady] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [kind, setKind] = useState<ReminderKind>('复诊')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('09:00')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (id) {
        const r = await db.reminders.get(Number(id))
        if (r) {
          setMemberId(String(r.memberId))
          setKind(r.kind)
          setTitle(r.title)
          setDate(r.date)
          setTime(r.time ?? '09:00')
          setNote(r.note ?? '')
        }
        setReady(true)
      } else {
        setMemberId(activeId != null ? String(activeId) : '')
        setReady(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const save = async () => {
    if (!memberId) return toast('请先选择成员', 'err')
    if (!date) return toast('请选择日期', 'err')
    setSaving(true)
    try {
      const now = Date.now()
      const old = id ? await db.reminders.get(Number(id)) : undefined
      const payload: MedReminder = {
        ...(id ? { id: Number(id) } : {}),
        memberId: Number(memberId),
        kind,
        title: title.trim() || kind,
        date,
        time: time || undefined,
        note: note.trim() || undefined,
        sourceDocId: old?.sourceDocId,
        done: old?.done ?? 0,
        createdAt: old?.createdAt ?? now,
      }
      await db.reminders.put(payload)
      toast('提醒已保存')
      navigate('/reminders')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!id) return
    if (!confirm('删除这条提醒？')) return
    await db.reminders.delete(Number(id))
    toast('已删除')
    navigate('/reminders')
  }

  if (!ready) return null

  return (
    <div className="pb-24">
      <PageHeader
        back
        title={editing ? '编辑提醒' : '添加提醒'}
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
            <Field label="类型 *">
              <select
                className={inputCls}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as ReminderKind)
                  if (!title.trim()) setTitle(e.target.value)
                }}
              >
                {REMINDER_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="标题">
              <input
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`默认「${kind}」`}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="日期 *">
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="时间">
              <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="备注">
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="如：带上次的化验单"
            />
          </Field>
        </div>

        <p className="px-1 text-xs leading-5 text-stone-400">
          提示：保存后到「提醒」页点「导出日历」，把提醒写入手机系统日历，即可获得准点推送。
        </p>

        {editing && (
          <button
            onClick={remove}
            className="w-full rounded-xl bg-rose-50 py-2.5 text-sm font-medium text-rose-600 active:bg-rose-100"
          >
            删除此提醒
          </button>
        )}
      </div>
    </div>
  )
}
