import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, FileText, Loader2, Sparkles, X } from 'lucide-react'
import {
  db,
  fileBlob,
  getSetting,
  CATEGORY_GROUPS,
  type AiMeta,
  type DocCategory,
  type MedDoc,
} from '../db'
import { today, fmtSize, parseAmount } from '../lib/format'
import { blobToArrayBuffer, normalizeFile, toAiImage } from '../lib/image'
import { newId } from '../lib/crypto'
import {
  DEFAULT_AI,
  blobToDataUrl,
  recognizeDocument,
  type AiConfig,
  type ExtractResult,
} from '../lib/ai'
import { resolveVisit, type VisitResolution } from '../lib/visitMatching'
import { Field, PageHeader, inputCls, toast } from '../components/ui'
import { DocThumb } from '../components/doc'

interface Draft {
  memberId: string
  visitId: string // ''=不指定（保存时自动归就诊）
  category: DocCategory
  title: string
  docDate: string
  hospital: string
  department: string
  doctor: string
  diagnosis: string
  amount: string
  selfPaid: string
  note: string
}

const emptyDraft = (memberId: number | null, category: DocCategory = '门诊病历'): Draft => ({
  memberId: memberId != null ? String(memberId) : '',
  visitId: '',
  category,
  title: '',
  docDate: today(),
  hospital: '',
  department: '',
  doctor: '',
  diagnosis: '',
  amount: '',
  selfPaid: '',
  note: '',
})

const MAX_RECOGNIZE_IMAGES = 20

interface NewItem {
  localId: string
  file: File
}

function dedupeByName<T extends { name: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)))
}

function extOf(name: string): string {
  const m = name.match(/(\.[a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : ''
}

export default function DocFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const editing = !!id

  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const aiCfg = useLiveQuery(() => getSetting<AiConfig>('aiConfig', DEFAULT_AI), [])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [existingFileIds, setExistingFileIds] = useState<string[]>([])
  const [removedIds, setRemovedIds] = useState<string[]>([])
  const [newItems, setNewItems] = useState<NewItem[]>([])
  const [saving, setSaving] = useState(false)
  const [originalVisitId, setOriginalVisitId] = useState<number | undefined>(undefined)
  const [recognizing, setRecognizing] = useState(false)
  const [aiInfo, setAiInfo] = useState<string | null>(null)
  const [aiMeta, setAiMeta] = useState<AiMeta | undefined>(undefined)
  /** 每张照片各自的识别结果：key = 既有文件id 或 新文件localId */
  const [recognResults, setRecognResults] = useState<Record<string, ExtractResult>>({})

  // 初始化表单
  useEffect(() => {
    ;(async () => {
      if (id) {
        const doc = await db.docs.get(Number(id))
        if (doc) {
          setDraft({
            memberId: String(doc.memberId),
            visitId: doc.visitId ? String(doc.visitId) : '',
            category: doc.category,
            title: doc.title,
            docDate: doc.docDate,
            hospital: doc.hospital ?? '',
            department: doc.department ?? '',
            doctor: doc.doctor ?? '',
            diagnosis: doc.diagnosis ?? '',
            amount: doc.amount != null ? String(doc.amount) : '',
            selfPaid: doc.selfPaid != null ? String(doc.selfPaid) : '',
            note: doc.note ?? '',
          })
          setExistingFileIds(doc.fileIds)
          setOriginalVisitId(doc.visitId)
          setAiMeta(doc.aiMeta)
        }
      } else {
        const presetVisitId = params.get('visitId')
        const presetMember = params.get('memberId') ?? (activeId != null ? String(activeId) : '')
        const base = emptyDraft(presetMember ? Number(presetMember) : null)
        if (presetVisitId) base.visitId = presetVisitId
        setDraft(base)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const relatedVisits = useLiveQuery(async () => {
    if (!draft?.memberId) return []
    const list = await db.visits.where('memberId').equals(Number(draft.memberId)).toArray()
    list.sort((a, b) => (a.date < b.date ? 1 : -1))
    return list
  }, [draft?.memberId])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  const previewUrls = useMemo(() => newItems.map((it) => URL.createObjectURL(it.file)), [newItems])
  useEffect(() => {
    return () => previewUrls.forEach((u) => URL.revokeObjectURL(u))
  }, [previewUrls])

  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) {
      toast('没有读到所选文件，请换另一个入口再试', 'err')
      return
    }
    const files = Array.from(list)
    setNewItems((prev) => [...prev, ...files.map((file) => ({ localId: newId(), file }))])
    toast(`已选择 ${files.length} 个文件`)
  }

  // ---------- AI 识别 ----------

  /** 文本字段合并：识别结果累加不覆盖，避免多页单据（如病历+报告）互相冲掉内容 */
  const mergeText = (oldV: string, newV?: string): string => {
    if (!newV) return oldV
    if (!oldV) return newV
    if (oldV.includes(newV) || newV.includes(oldV)) {
      return oldV.length >= newV.length ? oldV : newV
    }
    return `${oldV}\n${newV}`
  }

  /** 把一张照片的识别结果合并进表单；返回按患者姓名匹配到的成员名 */
  const applyExtract = (r: ExtractResult): string | null => {
    let matched: string | null = null
    if (r.patientName) {
      const nm = r.patientName.trim()
      const hit = members.find(
        (m) => m.name === nm || m.name.includes(nm) || nm.includes(m.name),
      )
      if (hit?.id) {
        matched = hit.name
        setDraft((d) => (d ? { ...d, memberId: String(hit.id) } : d))
      }
    }
    setDraft((d) =>
      d
        ? {
            ...d,
            category: r.category ?? d.category,
            docDate: r.docDate ?? d.docDate,
            hospital: r.hospital ?? d.hospital,
            department: r.department ?? d.department,
            doctor: r.doctor ?? d.doctor,
            diagnosis: mergeText(d.diagnosis, r.diagnosis),
            amount: r.amountTotal != null ? String(r.amountTotal) : d.amount,
            selfPaid: r.amountSelfPaid != null ? String(r.amountSelfPaid) : d.selfPaid,
            note: mergeText(d.note, r.note),
          }
        : d,
    )
    if (r.medications?.length || r.indicators?.length) {
      setAiMeta((prev) => {
        const meds = dedupeByName([...(prev?.medications ?? []), ...(r.medications ?? [])])
        const inds = dedupeByName([...(prev?.indicators ?? []), ...(r.indicators ?? [])])
        return {
          model: aiCfg?.model,
          recognizedAt: Date.now(),
          medications: meds.length ? meds : undefined,
          indicators: inds.length ? inds : undefined,
        }
      })
    }
    return matched
  }

  const recognize = async () => {
    const cfg = await getSetting<AiConfig>('aiConfig', DEFAULT_AI)
    if (!cfg.apiKey) {
      toast('请先到「设置 → AI 识别」配置 API Key', 'err')
      return
    }
    const jobs: { key: string; blob: Blob }[] = []
    for (const fid of existingFileIds) {
      if (removedIds.includes(fid)) continue
      const f = await db.files.get(fid)
      if (f?.mime.startsWith('image/')) jobs.push({ key: fid, blob: fileBlob(f) })
    }
    for (const it of newItems) {
      if (it.file.type.startsWith('image/')) jobs.push({ key: it.localId, blob: it.file })
    }
    const images = jobs.slice(0, MAX_RECOGNIZE_IMAGES)
    if (!images.length) {
      toast('请先添加单据照片（PDF 暂不支持识别）', 'err')
      return
    }
    setRecognizing(true)
    let matchedMember: string | null = null
    try {
      for (let i = 0; i < images.length; i++) {
        setAiInfo(`识别中 第 ${i + 1}/${images.length} 张…`)
        const dataUrl = await blobToDataUrl(await toAiImage(images[i].blob))
        const r = await recognizeDocument(cfg, dataUrl)
        setRecognResults((prev) => ({ ...prev, [images[i].key]: r }))
        const hit = applyExtract(r)
        if (hit) matchedMember = hit
      }
      if (matchedMember) toast(`已按单据姓名匹配成员「${matchedMember}」`)
      toast('识别完成，请核对结果')
    } catch (e) {
      toast('识别失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally {
      setRecognizing(false)
      setAiInfo(null)
    }
  }

  // ---------- 保存（按识别日期自动拆分成多份单据/多次就诊） ----------

  const save = async () => {
    if (!draft) return
    if (!draft.memberId) {
      toast('请先选择成员（或到设置里添加）', 'err')
      return
    }
    if (!draft.docDate) {
      toast('请选择单据日期', 'err')
      return
    }
    setSaving(true)
    try {
      const now = Date.now()
      const old = id ? await db.docs.get(Number(id)) : undefined
      if (removedIds.length) await db.files.bulkDelete(removedIds)

      // 1. 存新文件
      const stored = new Map<string, { fileId: string; ext: string }>()
      for (const ni of newItems) {
        const norm = await normalizeFile(ni.file)
        const data = await blobToArrayBuffer(norm.blob)
        const row = {
          id: newId(),
          name: norm.name,
          mime: norm.mime,
          size: data.byteLength,
          data,
          createdAt: now,
        }
        await db.files.add(row)
        stored.set(ni.localId, { fileId: row.id, ext: extOf(norm.name) })
      }

      // 2. 统一附件清单（既有保留的 + 新增的），挂上各自识别结果
      const items: {
        key: string
        fileId: string
        ext: string
        result?: ExtractResult
      }[] = []
      for (const fid of existingFileIds) {
        if (removedIds.includes(fid)) continue
        const f = await db.files.get(fid)
        items.push({ key: fid, fileId: fid, ext: extOf(f?.name ?? ''), result: recognResults[fid] })
      }
      for (const ni of newItems) {
        const s = stored.get(ni.localId)
        if (!s) continue
        items.push({ key: ni.localId, fileId: s.fileId, ext: s.ext, result: recognResults[ni.localId] })
      }

      // 3. 按识别出的日期分桶（编辑模式强制单桶，不拆分）
      const bucketOrder: string[] = []
      const buckets = new Map<string, typeof items>()
      for (const it of items) {
        const date = (!editing && it.result?.docDate) || draft.docDate
        if (!buckets.has(date)) {
          buckets.set(date, [])
          bucketOrder.push(date)
        }
        buckets.get(date)!.push(it)
      }

      // 4. 逐桶生成单据并归就诊
      const ymd = (d: string) => d.replaceAll('-', '').slice(2)
      let visitsCreated = 0
      let visitsMatched = 0
      const createdIds: number[] = []
      for (const [date, group] of buckets) {
        const results = group.map((g) => g.result).filter(Boolean) as ExtractResult[]
        const stamp = ymd(date)

        // 4a. 文件按内容重命名：如「B超报告260908.jpg」
        const nameCount = new Map<string, number>()
        for (const it of group) {
          const base = it.result?.docName?.trim() || draft.category
          const c = (nameCount.get(base) ?? 0) + 1
          nameCount.set(base, c)
          await db.files.update(it.fileId, {
            name: `${base}${stamp}${c > 1 ? `-${c}` : ''}${it.ext}`,
          })
        }

        // 4b. 字段合并
        const pick = <K extends keyof ExtractResult>(k: K): ExtractResult[K] =>
          results.map((r) => r[k]).find((v) => v != null) ?? undefined
        const mergedDiag = results.map((r) => r.diagnosis).filter(Boolean).join('；')
        const mergedNote = results.map((r) => r.note).filter(Boolean).join('\n')
        const meds = dedupeByName(results.flatMap((r) => r.medications ?? []))
        const inds = dedupeByName(results.flatMap((r) => r.indicators ?? []))
        // 标题兜底：识别名称 > 「诊断+类型」，保证辨识度
        const firstDocName = results.map((r) => r.docName).find(Boolean)
        const diagFirst = (mergedDiag || draft.diagnosis).split(/[；;]/)[0].trim().slice(0, 12)
        const fallbackTitle =
          firstDocName ?? (diagFirst ? `${diagFirst}${draft.category}`.slice(0, 20) : draft.category)
        const bucketAiMeta: AiMeta =
          editing && (aiMeta || old?.aiMeta)
            ? (aiMeta ?? old!.aiMeta!)
            : {
                model: aiCfg?.model,
                recognizedAt: now,
                medications: meds.length ? meds : undefined,
                indicators: inds.length ? inds : undefined,
              }

        const payload: MedDoc = {
          ...(editing ? { id: Number(id) } : {}),
          memberId: Number(draft.memberId),
          visitId: undefined,
          category: pick('category') ?? draft.category,
          title: draft.title.trim() || fallbackTitle,
          docDate: date,
          hospital: (pick('hospital') ?? draft.hospital.trim()) || undefined,
          department: (pick('department') ?? draft.department.trim()) || undefined,
          doctor: (pick('doctor') ?? draft.doctor.trim()) || undefined,
          diagnosis: mergedDiag || draft.diagnosis.trim() || undefined,
          amount: (pick('amountTotal') ?? parseAmount(draft.amount)) ?? null,
          selfPaid: (pick('amountSelfPaid') ?? parseAmount(draft.selfPaid)) ?? null,
          note: mergedNote || draft.note.trim() || undefined,
          fileIds: group.map((g) => g.fileId),
          aiMeta: meds.length || inds.length || editing ? bucketAiMeta : undefined,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
        }

        // 4c. 就诊归属：显式选择 > 编辑保持原关联 > 按成员+日期+医院自动归档
        const explicit = draft.visitId ? Number(draft.visitId) : undefined
        let resolution: VisitResolution | null = null
        if (explicit) {
          payload.visitId = explicit
        } else if (editing && originalVisitId && draft.visitId === String(originalVisitId)) {
          payload.visitId = originalVisitId
        } else {
          resolution = await resolveVisit(payload)
          payload.visitId = resolution.visitId
          if (resolution.created) visitsCreated++
          else if (resolution.matched) visitsMatched++
        }

        const docId = await db.docs.put(payload)
        createdIds.push(docId)
      }

      // 5. 提示与跳转
      if (buckets.size > 1) {
        toast(`已按日期拆成 ${buckets.size} 份单据，归入 ${visitsCreated + visitsMatched} 次就诊`)
      } else if (visitsCreated) {
        toast('已保存，并自动创建就诊记录')
      } else if (visitsMatched) {
        toast('已保存，已归入同日同院的就诊记录')
      } else {
        toast('已保存')
      }
      navigate(buckets.size > 1 ? '/docs' : `/docs/${createdIds[0]}`)
    } catch (e) {
      console.error(e)
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!draft) return null

  const imageCount =
    existingFileIds.filter((f) => !removedIds.includes(f)).length + newItems.length

  return (
    <div className="pb-24">
      <PageHeader
        back
        title={editing ? '编辑单据' : '新增单据'}
        actions={
          <button
            onClick={save}
            disabled={saving || recognizing}
            className="rounded-full bg-teal-600 px-4 py-1.5 text-sm font-medium text-white active:bg-teal-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : '保存'}
          </button>
        }
      />

      <div className="space-y-4 px-4 pt-4">
        {/* 附件 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-stone-500">
              单据照片 / 文件（{imageCount} 个）
            </span>
          </div>
          {/* 注意：不用 display:none 隐藏文件框，部分旧内核浏览器不触发其 change 事件 */}
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            multiple
            style={{ position: 'absolute', left: '-9999px', top: 0, width: '1px', height: '1px', opacity: 0 }}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <input
            ref={galRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ position: 'absolute', left: '-9999px', top: 0, width: '1px', height: '1px', opacity: 0 }}
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="grid grid-cols-3 gap-2">
            {existingFileIds
              .filter((fid) => !removedIds.includes(fid))
              .map((fid) => (
                <div key={fid} className="relative">
                  <span className="ratio-1-1 w-full">
                    <DocThumb doc={{ fileIds: [fid] } as MedDoc} className="fill-abs rounded-xl" />
                  </span>
                  <button
                    onClick={() => setRemovedIds((p) => [...p, fid])}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-stone-800 p-1 text-white shadow"
                    aria-label="移除附件"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            {newItems.map((it, i) => (
              <NewFileTile
                key={it.localId}
                file={it.file}
                url={previewUrls[i]}
                onRemove={() => setNewItems((p) => p.filter((x) => x.localId !== it.localId))}
              />
            ))}
            <button
              onClick={() => camRef.current?.click()}
              className="relative block w-full rounded-xl border-2 border-dashed border-stone-300 text-stone-400 active:bg-stone-100"
            >
              <span className="ratio-1-1 w-full" />
              <span className="fill-abs flex flex-col items-center justify-center gap-1">
                <Camera size={20} />
                <span className="text-xs">拍照 / 相册</span>
              </span>
            </button>
            <button
              onClick={() => galRef.current?.click()}
              className="relative block w-full rounded-xl border-2 border-dashed border-stone-300 text-stone-400 active:bg-stone-100"
            >
              <span className="ratio-1-1 w-full" />
              <span className="fill-abs flex flex-col items-center justify-center gap-1">
                <FileText size={20} />
                <span className="text-xs">PDF 文件</span>
              </span>
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-400">
            「拍照 / 相册」会弹出选择：拍照或从图库多选。识别后按日期自动拆分归档，
            最多识别 20 张。
          </p>

          {/* AI 识别 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={recognize}
              disabled={recognizing || saving}
              className="flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 active:bg-teal-100 disabled:opacity-60"
            >
              {recognizing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {recognizing ? (aiInfo ?? '识别中…') : 'AI 识别填写'}
            </button>
            <span className="text-xs text-stone-400">
              {aiCfg?.apiKey ? '识别后请核对再保存' : '需先在设置中配置 AI Key'}
            </span>
          </div>
          {aiMeta && (
            <p className="mt-2 text-xs text-teal-700">
              已识别：药品 {aiMeta.medications?.length ?? 0} 种 · 指标 {aiMeta.indicators?.length ?? 0} 项
              （保存后在详情页查看）
            </p>
          )}
        </div>

        {/* 基本信息 */}
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
          <Field label="单据类型 *">
            <select
              className={inputCls}
              value={draft.category}
              onChange={(e) => set('category', e.target.value as DocCategory)}
            >
              {CATEGORY_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.cats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="标题">
            <input
              className={inputCls}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="留空则自动取「诊断+类型」或识别名称"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="单据日期 *">
              <input
                type="date"
                className={inputCls}
                value={draft.docDate}
                onChange={(e) => set('docDate', e.target.value)}
              />
            </Field>
            <Field label="医院">
              <input
                className={inputCls}
                value={draft.hospital}
                onChange={(e) => set('hospital', e.target.value)}
                placeholder="如：市第一人民医院"
              />
            </Field>
          </div>
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
              placeholder="如：2型糖尿病"
            />
          </Field>
          <Field label="关联就诊记录">
            <select
              className={inputCls}
              value={draft.visitId}
              onChange={(e) => set('visitId', e.target.value)}
            >
              <option value="">自动（按成员+日期+医院+科室归档）</option>
              {(relatedVisits ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.date} {v.type} {v.hospital ?? ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* 金额与备注 */}
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="总金额（元）">
              <input
                inputMode="decimal"
                className={inputCls}
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
                placeholder="如：256.80"
              />
            </Field>
            <Field label="其中自付（元）">
              <input
                inputMode="decimal"
                className={inputCls}
                value={draft.selfPaid}
                onChange={(e) => set('selfPaid', e.target.value)}
                placeholder="医保报销外的部分"
              />
            </Field>
          </div>
          <Field label="备注">
            <textarea
              className={`${inputCls} min-h-[5rem] resize-none`}
              value={draft.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="医嘱、注意事项等"
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

/** 待保存文件的预览块：图片解码失败时退化为文件名占位，保证"选了就能看见" */
function NewFileTile({
  file,
  url,
  onRemove,
}: {
  file: File
  url?: string
  onRemove: () => void
}) {
  const [broken, setBroken] = useState(false)
  const isImg = file.type.startsWith('image/')
  return (
    <div className="relative">
      {isImg && !broken && url ? (
        <span className="ratio-1-1 w-full">
          <img
            src={url}
            alt=""
            className="fill-abs rounded-xl object-cover"
            onError={() => setBroken(true)}
          />
        </span>
      ) : (
        <span className="ratio-1-1 w-full rounded-xl border border-stone-200 bg-stone-50">
          <span className="fill-abs flex flex-col items-center justify-center gap-0.5 px-1 text-center">
            <FileText size={18} className="shrink-0 text-stone-400" />
            <span className="w-full truncate text-[10px] text-stone-500">{file.name}</span>
            <span className="text-[10px] text-stone-300">{fmtSize(file.size)}</span>
          </span>
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full bg-stone-800 p-1 text-white shadow"
        aria-label="移除附件"
      >
        <X size={12} />
      </button>
    </div>
  )
}
