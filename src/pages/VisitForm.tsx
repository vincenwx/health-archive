import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { db, getSetting, VISIT_TYPES, type Visit, type VisitType } from '../db'
import { today } from '../lib/format'
import { Field, PageHeader, inputCls, toast } from '../components/ui'

interface Draft {
  memberId: string
  type: VisitType
  date: string
  hospital: string
  department: string
  doctor: string
  diagnosis: string
  summary: string
}

const emptyDraft = (memberId: number | null): Draft => ({
  memberId: memberId != null ? String(memberId) : '',
  type: '门诊',
  date: today(),
  hospital: '',
  department: '',
  doctor: '',
  diagnosis: '',
  summary: '',
})

export default function VisitFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editing = !!id

  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (id) {
        const v = await db.visits.get(Number(id))
        if (v) {
          setDraft({
            memberId: String(v.memberId),
            type: v.type,
            date: v.date,
            hospital: v.hospital ?? '',
            department: v.department ?? '',
            doctor: v.doctor ?? '',
            diagnosis: v.diagnosis ?? '',
            summary: v.summary ?? '',
          })
        }
      } else {
        setDraft(emptyDraft(activeId ?? null))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  const save = async () => {
    if (!draft) return
    if (!draft.memberId) {
      toast('请先选择成员（或到设置里添加）', 'err')
      return
    }
    if (!draft.date) {
      toast('请选择日期', 'err')
      return
    }
    setSaving(true)
    try {
      const now = Date.now()
      const old = id ? await db.visits.get(Number(id)) : undefined
      const payload: Visit = {
        ...(id ? { id: Number(id) } : {}),
        memberId: Number(draft.memberId),
        type: draft.type,
        date: draft.date,
        hospital: draft.hospital.trim() || undefined,
        department: draft.department.trim() || undefined,
        doctor: draft.doctor.trim() || undefined,
        diagnosis: draft.diagnosis.trim() || undefined,
        summary: draft.summary.trim() || undefined,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      }
      const visitId = await db.visits.put(payload)
      toast('已保存')
      navigate(`/visits/${visitId}`)
    } catch (e) {
      console.error(e)
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return null

  return (
    <div className="pb-24">
      <PageHeader
        back
        title={editing ? '编辑就诊记录' : '记就诊'}
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
            <select
              className={inputCls}
              value={draft.memberId}
              onChange={(e) => set('memberId', e.target.value)}
            >
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
                value={draft.type}
                onChange={(e) => set('type', e.target.value as VisitType)}
              >
                {VISIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="日期 *">
              <input
                type="date"
                className={inputCls}
                value={draft.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </Field>
          </div>
          <Field label="医院">
            <input
              className={inputCls}
              value={draft.hospital}
              onChange={(e) => set('hospital', e.target.value)}
              placeholder="如：市第一人民医院"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="科室">
              <input
                className={inputCls}
                value={draft.department}
                onChange={(e) => set('department', e.target.value)}
                placeholder="如：内分泌科"
              />
            </Field>
            <Field label="医生">
              <input
                className={inputCls}
                value={draft.doctor}
                onChange={(e) => set('doctor', e.target.value)}
                placeholder="如：王医生"
              />
            </Field>
          </div>
          <Field label="诊断 / 结论">
            <input
              className={inputCls}
              value={draft.diagnosis}
              onChange={(e) => set('diagnosis', e.target.value)}
              placeholder="如：高血压2级"
            />
          </Field>
          <Field label="经过 / 医嘱小结">
            <textarea
              className={`${inputCls} min-h-[6rem] resize-none`}
              value={draft.summary}
              onChange={(e) => set('summary', e.target.value)}
              placeholder="做了什么检查、开了什么药、有什么注意事项…"
            />
          </Field>
        </div>
        <p className="px-1 text-xs leading-5 text-stone-400">
          保存后可在详情页把挂号单、处方、发票等单据关联到这次就诊。
        </p>
      </div>
    </div>
  )
}
