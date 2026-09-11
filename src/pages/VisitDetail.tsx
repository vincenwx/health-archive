import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FilePlus2, Link2, Loader2, Pencil, Sparkles, Trash2, Unlink, X } from 'lucide-react'
import { db, getSetting, VISIT_TYPE_STYLE, type MedDoc } from '../db'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import {
  AiConfig,
  DEFAULT_AI,
  collectImageDataUrls,
  interpretDocument,
  MAX_INTERPRET_IMAGES,
} from '../lib/ai'
import { PageHeader, toast } from '../components/ui'
import { DocThumb } from '../components/doc'

export default function VisitDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [linking, setLinking] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [interpretError, setInterpretError] = useState<string | null>(null)

  const visit = useLiveQuery(async () => (id ? db.visits.get(Number(id)) : undefined), [id])
  const member = useLiveQuery(
    async () => (visit ? db.members.get(visit.memberId) : undefined),
    [visit?.memberId],
  )
  const docs = useLiveQuery(
    async () => {
      if (!visit?.id) return []
      const list = await db.docs.where('visitId').equals(visit.id).toArray()
      list.sort((a, b) => (a.docDate < b.docDate ? 1 : -1))
      return list
    },
    [visit?.id],
  )
  // 可关联的单据：同成员、当前未关联其他就诊
  const linkableDocs = useLiveQuery(async () => {
    if (!visit) return []
    const all = await db.docs.where('memberId').equals(visit.memberId).toArray()
    return all.filter((d) => !d.visitId)
  }, [visit?.id, visit?.memberId])

  if (!visit) {
    return (
      <div>
        <PageHeader back title="就诊详情" />
        <div className="py-16 text-center text-sm text-stone-400">记录不存在或已删除</div>
      </div>
    )
  }

  const remove = async () => {
    if (!visit.id) return
    const n = docs?.length ?? 0
    if (
      !confirm(
        n > 0
          ? `删除这条就诊记录后，关联的 ${n} 张单据会保留但取消关联。确定删除吗？`
          : '确定删除这条就诊记录吗？',
      )
    )
      return
    await db.transaction('rw', db.docs, db.visits, async () => {
      const attached = await db.docs.where('visitId').equals(visit.id!).toArray()
      for (const d of attached) await db.docs.update(d.id!, { visitId: undefined })
      await db.visits.delete(visit.id!)
    })
    toast('已删除')
    navigate('/visits')
  }

  const linkDoc = async (doc: MedDoc) => {
    await db.docs.update(doc.id!, { visitId: visit.id })
    toast(`已关联「${doc.title}」`)
    setLinking(false)
  }

  const unlinkDoc = async (doc: MedDoc) => {
    if (!confirm(`把「${doc.title}」从这次就诊中移除关联？（单据本身不会被删除）`)) return
    await db.docs.update(doc.id!, { visitId: undefined })
    toast('已取消关联')
  }

  const totalAmount = (docs ?? []).reduce((s, d) => s + (d.amount ?? 0), 0)

  /** 综合解读：本次就诊全部单据一起交给模型 */
  const interpretAll = async () => {
    const cfg = await getSetting<AiConfig>('aiConfig', DEFAULT_AI)
    if (!cfg.apiKey) {
      toast('请先在设置中配置 AI Key', 'err')
      return
    }
    const allDocs = docs ?? []
    if (!visit.id || allDocs.length === 0) {
      toast('请先关联单据再做综合解读', 'err')
      return
    }
    setInterpreting(true)
    setInterpretError(null)
    try {
      const images = await collectImageDataUrls(
        allDocs.flatMap((d) => d.fileIds),
        MAX_INTERPRET_IMAGES,
      )
      const info = [
        `就诊：${visit.date} ${visit.type} ${visit.hospital ?? ''}${
          visit.department ? ' ' + visit.department : ''
        }`,
        visit.doctor ? `医生：${visit.doctor}` : '',
        visit.diagnosis ? `医生诊断：${visit.diagnosis}` : '',
        visit.summary ? `就诊记录：${visit.summary}` : '',
        ...allDocs.flatMap((d, idx) => [
          `单据${idx + 1}：${d.category}「${d.title}」${d.docDate}`,
          d.diagnosis ? `  结论：${d.diagnosis}` : '',
          ...(d.aiMeta?.medications ?? []).map(
            (m) =>
              `  药品：${m.name} ${[m.dosage, m.frequency, m.timing, m.duration].filter(Boolean).join('/')}`,
          ),
          ...(d.aiMeta?.indicators ?? []).map(
            (i) =>
              `  指标：${i.name} ${i.value ?? ''}${i.unit ?? ''}（参考 ${i.reference ?? '未显示'}）${i.flag ?? ''}`,
          ),
          d.note ? `  备注：${d.note}` : '',
        ]),
      ]
        .filter(Boolean)
        .join('\n')
      const text = await interpretDocument(cfg, images, info)
      await db.visits.update(visit.id!, {
        interpretation: text,
        interpretationAt: Date.now(),
        interpretationModel: cfg.model,
      })
      toast('综合解读完成')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setInterpretError(msg)
      toast('解读失败：' + msg, 'err')
    } finally {
      setInterpreting(false)
    }
  }

  return (
    <div className="pb-24">
      <PageHeader
        back
        title="就诊详情"
        actions={
          <div className="flex items-center gap-1">
            <Link
              to={`/visits/${visit.id}/edit`}
              className="rounded-full p-2 text-stone-500 active:bg-stone-200"
              aria-label="编辑"
            >
              <Pencil size={18} />
            </Link>
            <button
              onClick={remove}
              className="rounded-full p-2 text-rose-500 active:bg-rose-50"
              aria-label="删除"
            >
              <Trash2 size={18} />
            </button>
          </div>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        {/* 基本信息 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VISIT_TYPE_STYLE[visit.type].chip}`}>
              {visit.type}
            </span>
            <span className="text-[17px] font-semibold">{fmtDate(visit.date)}</span>
          </div>
          <div className="mt-3 divide-y divide-stone-100">
            <Row label="成员" value={member?.name} />
            <Row label="医院" value={visit.hospital} />
            <Row label="科室" value={visit.department} />
            <Row label="医生" value={visit.doctor} />
            <Row label="诊断 / 结论" value={visit.diagnosis} />
            <Row label="经过 / 医嘱" value={visit.summary} multi />
          </div>
        </div>

        {/* AI 综合解读 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">AI 综合解读</span>
            {visit.interpretation && (
              <button
                onClick={interpretAll}
                disabled={interpreting}
                className="text-xs text-teal-600 active:opacity-70 disabled:opacity-60"
              >
                重新解读
              </button>
            )}
          </div>
          {visit.interpretation ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                {visit.interpretation}
              </p>
              <p className="mt-2 text-xs text-stone-400">
                生成于{' '}
                {visit.interpretationAt ? fmtDateTime(visit.interpretationAt) : '—'} · 综合本次就诊全部
                {docs?.length ?? 0} 张单据 · AI 仅供参考，请以医生意见为准
              </p>
            </>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={interpretAll}
                disabled={interpreting || (docs?.length ?? 0) === 0}
                className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 active:bg-teal-100 disabled:opacity-60"
              >
                {interpreting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {interpreting ? '解读中…' : '综合解读全部单据'}
              </button>
              <span className="text-xs text-stone-400">
                {(docs?.length ?? 0) > 0
                  ? `把本次就诊 ${docs!.length} 张单据放在一起讲，每张单据详情页里还各有单独解读`
                  : '先关联单据，才能综合解读'}
              </span>
            </div>
          )}
          {interpretError && (
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-600">
              解读失败：{interpretError}
              <br />
              （可重试；若持续失败请截图此文字反馈）
            </p>
          )}
        </div>

        {/* 关联单据 */}
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[15px] font-semibold">关联单据（{docs?.length ?? 0}）</span>
            {(docs?.length ?? 0) > 0 && (
              <span className="text-xs text-stone-400">合计 {fmtMoney(totalAmount)}</span>
            )}
          </div>
          {(docs ?? []).length === 0 ? (
            <div className="rounded-2xl bg-white p-5 text-sm text-stone-400 shadow-sm">
              还没有关联单据，可新建或关联已有单据
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {(docs ?? []).map((d) => (
                <div key={d.id} className="relative overflow-hidden rounded-2xl bg-white shadow-sm">
                  <Link to={`/docs/${d.id}`} className="block active:bg-stone-100">
                    <span className="ratio-4-3 block w-full">
                      <DocThumb doc={d} className="fill-abs" />
                    </span>
                    <div className="p-2.5">
                      <div className="truncate text-[13px] font-medium">{d.title}</div>
                      <div className="mt-0.5 text-xs text-stone-400">
                        {d.category} · {fmtDate(d.docDate)}
                      </div>
                      {d.amount != null && (
                        <div className="mt-0.5 text-xs font-medium text-teal-700">{fmtMoney(d.amount)}</div>
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => unlinkDoc(d)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/40 p-1.5 text-white active:bg-black/60"
                    aria-label="取消关联"
                  >
                    <Unlink size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Link
              to={`/docs/new?visitId=${visit.id}&memberId=${visit.memberId}`}
              className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white active:bg-teal-700"
            >
              <FilePlus2 size={16} /> 拍单据并关联
            </Link>
            <button
              onClick={() => setLinking(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-medium text-stone-600 active:bg-stone-100"
            >
              <Link2 size={16} /> 关联已有单据
            </button>
          </div>
        </div>
      </div>

      {/* 关联已有单据弹层（Portal 挂到 body，规避老内核 fixed 定位 bug） */}
      {linking &&
        createPortal(
          <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setLinking(false)}>
            <div
              className="safe-bottom max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-white pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-stone-100 bg-white px-4 py-3">
                <span className="font-semibold">选择要关联的单据</span>
                <button onClick={() => setLinking(false)} className="rounded-full p-1 text-stone-400">
                  <X size={20} />
                </button>
              </div>
              <div className="px-4 pt-2">
                {(linkableDocs ?? []).length === 0 ? (
                  <div className="py-10 text-center text-sm text-stone-400">
                    该成员没有待关联的单据
                  </div>
                ) : (
                  (linkableDocs ?? []).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => linkDoc(d)}
                      className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-stone-50 p-3 text-left active:bg-stone-100"
                    >
                      <DocThumb doc={d} className="h-14 w-14 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{d.title}</div>
                        <div className="text-xs text-stone-400">
                          {d.category} · {fmtDate(d.docDate)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function Row({
  label,
  value,
  multi,
}: {
  label: string
  value?: string
  multi?: boolean
}) {
  if (value === undefined || value === '') return null
  return (
    <div className="flex gap-4 py-2.5">
      <span className="w-20 shrink-0 text-sm text-stone-400">{label}</span>
      <span className={`min-w-0 flex-1 text-sm ${multi ? 'whitespace-pre-wrap leading-6' : ''}`}>
        {value}
      </span>
    </div>
  )
}
