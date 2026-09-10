import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Loader2, Maximize2, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { db, getSetting, VISIT_TYPE_STYLE } from '../db'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import {
  AiConfig,
  DEFAULT_AI,
  collectImageDataUrls,
  interpretDocument,
  MAX_INTERPRET_IMAGES,
} from '../lib/ai'
import { PageHeader, toast } from '../components/ui'
import { FileStrip, FullscreenViewer, MainPreview } from '../components/doc'

export default function DocDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [interpreting, setInterpreting] = useState(false)

  const doc = useLiveQuery(async () => (id ? db.docs.get(Number(id)) : undefined), [id])
  const member = useLiveQuery(
    async () => (doc ? db.members.get(doc.memberId) : undefined),
    [doc?.memberId],
  )
  const visit = useLiveQuery(
    async () => (doc?.visitId ? db.visits.get(doc.visitId) : undefined),
    [doc?.visitId],
  )

  if (!doc) {
    return (
      <div>
        <PageHeader back title="单据详情" />
        <div className="py-16 text-center text-sm text-stone-400">单据不存在或已删除</div>
      </div>
    )
  }

  const imageFileIds = doc.fileIds // 查看器内对非图片附件做降级提示

  const interpret = async () => {
    const cfg = await getSetting<AiConfig>('aiConfig', DEFAULT_AI)
    if (!cfg.apiKey) {
      toast('请先在设置中配置 AI Key', 'err')
      return
    }
    setInterpreting(true)
    try {
      // 多页单据：把所有图片一起发给模型综合解读（最多 20 张）
      const images = await collectImageDataUrls(doc.fileIds, MAX_INTERPRET_IMAGES)
      const info = [
        `类型：${doc.category}`,
        `标题：${doc.title}`,
        `日期：${doc.docDate}`,
        doc.hospital ? `医院：${doc.hospital}` : '',
        doc.department ? `科室：${doc.department}` : '',
        doc.doctor ? `医生：${doc.doctor}` : '',
        doc.diagnosis ? `诊断：${doc.diagnosis}` : '',
        doc.amount != null ? `总金额：${doc.amount}元` : '',
        doc.selfPaid != null ? `自付金额：${doc.selfPaid}元` : '',
        doc.note ? `备注：${doc.note}` : '',
        ...(doc.aiMeta?.medications ?? []).map(
          (m) =>
            `药品：${m.name} ${[m.dosage, m.frequency, m.timing, m.duration].filter(Boolean).join('/')}`,
        ),
        ...(doc.aiMeta?.indicators ?? []).map(
          (i) =>
            `指标：${i.name} ${i.value ?? ''}${i.unit ?? ''}（参考 ${i.reference ?? '未显示'}）${i.flag ?? ''}`,
        ),
      ]
        .filter(Boolean)
        .join('\n')
      const text = await interpretDocument(cfg, images, info)
      await db.docs.update(doc.id!, {
        aiMeta: {
          ...(doc.aiMeta ?? { recognizedAt: doc.createdAt }),
          interpretation: text,
          interpretationAt: Date.now(),
          model: cfg.model,
        },
      })
      toast('解读完成')
    } catch (e) {
      toast('解读失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally {
      setInterpreting(false)
    }
  }

  const remove = async () => {
    if (!doc.id) return
    if (!confirm('确定删除这张单据吗？其附件照片也将一并删除，且不可恢复。')) return
    await db.transaction('rw', [db.docs, db.files], async () => {
      await db.files.bulkDelete(doc.fileIds)
      await db.docs.delete(doc.id!)
    })
    toast('已删除')
    navigate('/docs')
  }

  return (
    <div className="pb-24">
      <PageHeader
        back
        title={doc.category}
        actions={
          <div className="flex items-center gap-1">
            {doc.fileIds.length > 0 && (
              <button
                onClick={() => setViewerIndex(0)}
                className="rounded-full p-2 text-teal-600 active:bg-stone-200"
                aria-label="放大查看"
              >
                <Maximize2 size={18} />
              </button>
            )}
            <Link
              to={`/docs/${doc.id}/edit`}
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
        {/* 附件 */}
        {doc.fileIds.length > 0 && (
          <div className="space-y-2">
            <MainPreview fileId={doc.fileIds[0]} onOpen={() => setViewerIndex(0)} />
            {doc.fileIds.length > 1 && (
              <FileStrip fileIds={imageFileIds} onPick={(i) => setViewerIndex(i)} />
            )}
          </div>
        )}

        {/* 标题与归属 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-[17px] font-semibold">{doc.title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
              {doc.category}
            </span>
            <span>{member?.name ?? '未知成员'}</span>
            <span>·</span>
            <span>{fmtDate(doc.docDate)}</span>
          </div>
          {visit && (
            <Link
              to={`/visits/${visit.id}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-600 active:bg-stone-200"
            >
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VISIT_TYPE_STYLE[visit.type].chip}`}>
                {visit.type}
              </span>
              {visit.date} {visit.hospital ?? ''}
              <ChevronLinkHint />
            </Link>
          )}
        </div>

        {/* AI 解读 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold">AI 解读</span>
            {doc.aiMeta?.interpretation && (
              <button
                onClick={interpret}
                disabled={interpreting}
                className="text-xs text-teal-600 active:opacity-70 disabled:opacity-60"
              >
                重新解读
              </button>
            )}
          </div>
          {doc.aiMeta?.interpretation ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                {doc.aiMeta.interpretation}
              </p>
              <p className="mt-2 text-xs text-stone-400">
                生成于 {doc.aiMeta.interpretationAt ? fmtDateTime(doc.aiMeta.interpretationAt) : '—'} · AI
                仅供参考，请以医生意见为准
              </p>
            </>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={interpret}
                disabled={interpreting}
                className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 active:bg-teal-100 disabled:opacity-60"
              >
                {interpreting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {interpreting ? '解读中…' : '生成 AI 解读'}
              </button>
              <span className="text-xs text-stone-400">把单据讲成大白话：关键结果、用药、注意事项</span>
            </div>
          )}
        </div>

        {/* 详细信息 */}
        <div className="divide-y divide-stone-100 rounded-2xl bg-white shadow-sm">
          <Row label="医院" value={doc.hospital} />
          <Row label="科室" value={doc.department} />
          <Row label="医生" value={doc.doctor} />
          <Row label="诊断 / 结论" value={doc.diagnosis} />
          <Row label="总金额" value={doc.amount != null ? fmtMoney(doc.amount) : undefined} strong />
          <Row
            label="自付金额"
            value={doc.selfPaid != null ? fmtMoney(doc.selfPaid) : undefined}
          />
          {doc.note && <Row label="备注" value={doc.note} multi />}
        </div>

        {/* AI 识别的结构化数据 */}
        {doc.aiMeta && ((doc.aiMeta.medications?.length ?? 0) > 0 || (doc.aiMeta.indicators?.length ?? 0) > 0) && (
          <div className="space-y-3">
            {(doc.aiMeta.medications?.length ?? 0) > 0 && (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-1 text-[15px] font-semibold">药品（AI 识别，{doc.aiMeta.medications!.length} 种）</div>
                <div className="divide-y divide-stone-100">
                  {doc.aiMeta.medications!.map((m, i) => (
                    <div key={i} className="py-2.5">
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="mt-0.5 text-xs text-stone-400">
                        {[m.dosage, m.frequency, m.timing, m.duration].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-stone-400">M3 版本起可基于此一键生成用药提醒计划</p>
              </div>
            )}
            {(doc.aiMeta.indicators?.length ?? 0) > 0 && (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-1 text-[15px] font-semibold">化验指标（AI 识别，{doc.aiMeta.indicators!.length} 项）</div>
                <div className="divide-y divide-stone-100">
                  {doc.aiMeta.indicators!.map((ind, i) => (
                    <div key={i} className="flex items-center gap-2 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm">{ind.name}</span>
                      <span className="text-sm font-medium">
                        {ind.value ?? '—'}
                        {ind.unit ? ` ${ind.unit}` : ''}
                      </span>
                      {ind.flag && ind.flag !== '正常' && (
                        <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-600">
                          {ind.flag}
                        </span>
                      )}
                      {ind.reference && (
                        <span className="shrink-0 text-xs text-stone-400">({ind.reference})</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-stone-400">M4 版本起将据此绘制指标趋势曲线</p>
              </div>
            )}
            <p className="px-1 text-xs text-stone-400">
              由 AI（{doc.aiMeta.model ?? '未知模型'}）识别，仅供参考，请以单据原图为准
            </p>
          </div>
        )}

        <p className="px-1 text-xs text-stone-400">
          创建于 {fmtDate(doc.docDate)} · 共 {doc.fileIds.length} 个附件
        </p>
      </div>

      {viewerIndex !== null && (
        <FullscreenViewer
          fileIds={imageFileIds}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndex={setViewerIndex}
        />
      )}
    </div>
  )
}

function ChevronLinkHint() {
  return <ExternalLink size={12} className="text-stone-400" />
}

function Row({
  label,
  value,
  strong,
  multi,
}: {
  label: string
  value?: string
  strong?: boolean
  multi?: boolean
}) {
  if (value === undefined || value === '') return null
  return (
    <div className="flex gap-4 px-4 py-3">
      <span className="w-20 shrink-0 text-sm text-stone-400">{label}</span>
      <span className={`min-w-0 flex-1 text-sm ${strong ? 'font-semibold text-teal-700' : ''} ${multi ? 'whitespace-pre-wrap leading-6' : ''}`}>
        {value}
      </span>
    </div>
  )
}

// 供列表场景复用（M1 暂未使用，预留）
