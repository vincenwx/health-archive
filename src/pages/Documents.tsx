import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ChevronRight, FileText, Search, X } from 'lucide-react'
import { db, getSetting, ALL_CATEGORIES, CATEGORY_GROUPS, type DocCategory, type MedDoc } from '../db'
import { fmtDate, fmtMoney } from '../lib/format'
import { Chip, EmptyState, FAB, MemberChips, PageHeader } from '../components/ui'
import { DocThumb } from '../components/doc'

export default function DocumentsPage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const [memberFilter, setMemberFilter] = useState<number | 'all' | null>(null) // null=未初始化
  const [cat, setCat] = useState<'all' | DocCategory>('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (memberFilter === null && activeId !== undefined) {
      setMemberFilter(activeId ?? 'all')
    }
  }, [activeId, memberFilter])

  const allDocs = useLiveQuery(async () => {
    const docs = await db.docs.toArray()
    docs.sort((a, b) => (a.docDate < b.docDate ? 1 : -1))
    return docs
  }, [])

  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? '已删除成员'

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (allDocs ?? []).filter((d) => {
      if (memberFilter !== null && memberFilter !== 'all' && d.memberId !== memberFilter) return false
      if (cat !== 'all' && d.category !== cat) return false
      if (kw) {
        const hay = [d.title, d.hospital, d.department, d.doctor, d.diagnosis, d.note, d.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(kw)) return false
      }
      return true
    })
  }, [allDocs, memberFilter, cat, q])

  if (memberFilter === null) return null

  return (
    <div>
      <PageHeader title={`单据${allDocs ? `（${allDocs.length}）` : ''}`} />

      {/* 搜索 */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜标题 / 医院 / 诊断 / 备注…"
            className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-9 text-[15px] outline-none placeholder:text-stone-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-400"
              aria-label="清空"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* 筛选：成员 */}
      <div className="pt-2">
        <MemberChips
          members={members}
          value={memberFilter === 'all' ? null : memberFilter}
          onChange={(id) => setMemberFilter(id)}
        />
      </div>

      {/* 筛选：类别 */}
      <div className="no-scrollbar mt-1 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={cat === 'all'} onClick={() => setCat('all')}>
          全部类型
        </Chip>
        {ALL_CATEGORIES.map((c) => (
          <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
            {c}
          </Chip>
        ))}
      </div>

      {/* 列表 */}
      <div className="px-4 pt-2">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileText size={36} />}
            text={allDocs?.length ? '没有符合筛选条件的单据' : '还没有单据，点右下角 + 添加'}
          />
        ) : (
          filtered.map((d) => <DocRow key={d.id} doc={d} memberName={memberName(d.memberId)} />)
        )}
      </div>

      <FAB to="/docs/new" />
    </div>
  )
}

function DocRow({ doc, memberName }: { doc: MedDoc; memberName: string }) {
  return (
    <Link
      to={`/docs/${doc.id}`}
      className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm active:bg-stone-100"
    >
      <DocThumb doc={doc} className="h-16 w-16 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
            {doc.category}
          </span>
          <span className="truncate text-[15px] font-medium">{doc.title}</span>
        </div>
        <div className="mt-1 truncate text-xs text-stone-400">
          {memberName} · {fmtDate(doc.docDate)}
          {doc.hospital ? ` · ${doc.hospital}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-medium text-teal-700">{doc.amount != null ? fmtMoney(doc.amount) : ''}</span>
        <ChevronRight size={16} className="text-stone-300" />
      </div>
    </Link>
  )
}

// 保留类别分组信息供后续版本使用
export const _categoryGroups = CATEGORY_GROUPS
