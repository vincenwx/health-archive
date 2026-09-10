import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ChevronRight, Stethoscope } from 'lucide-react'
import { db, getSetting, VISIT_TYPES, VISIT_TYPE_STYLE, type Visit, type VisitType } from '../db'
import { Chip, EmptyState, FAB, MemberChips, PageHeader } from '../components/ui'

export default function VisitsPage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const [memberFilter, setMemberFilter] = useState<number | 'all' | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | VisitType>('all')

  // 初始化成员筛选（跟随首页选中的成员）
  useEffect(() => {
    if (memberFilter === null && activeId !== undefined) {
      setMemberFilter(activeId ?? 'all')
    }
  }, [activeId, memberFilter])

  const visits = useLiveQuery(async () => {
    const all = await db.visits.toArray()
    all.sort((a, b) => (a.date < b.date ? 1 : -1))
    return all
  }, [])

  if (memberFilter === null) return null

  const memberName = (id: number) => members.find((m) => m.id === id)?.name ?? '已删除成员'
  const filtered = (visits ?? []).filter((v) => {
    if (memberFilter !== 'all' && v.memberId !== memberFilter) return false
    if (typeFilter !== 'all' && v.type !== typeFilter) return false
    return true
  })

  return (
    <div>
      <PageHeader title={`就诊记录${visits ? `（${visits.length}）` : ''}`} />

      <div className="pt-2">
        <MemberChips
          members={members}
          value={memberFilter === 'all' ? null : memberFilter}
          onChange={(id) => setMemberFilter(id)}
        />
      </div>
      <div className="no-scrollbar mt-1 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
          全部类型
        </Chip>
        {VISIT_TYPES.map((t) => (
          <Chip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
            {t}
          </Chip>
        ))}
      </div>

      <div className="px-4 pt-2">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Stethoscope size={36} />}
            text={visits?.length ? '没有符合筛选条件的记录' : '还没有就诊记录，点右下角 + 添加'}
          />
        ) : (
          filtered.map((v) => <VisitRow key={v.id} visit={v} memberName={memberName(v.memberId)} />)
        )}
      </div>

      <FAB to="/visits/new" />
    </div>
  )
}

function VisitRow({ visit, memberName }: { visit: Visit; memberName: string }) {
  const style = VISIT_TYPE_STYLE[visit.type]
  return (
    <Link
      to={`/visits/${visit.id}`}
      className="mb-2 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm active:bg-stone-100"
    >
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className="text-lg font-semibold leading-5">{visit.date.slice(8)}</span>
        <span className="text-[11px] text-stone-400">{visit.date.slice(0, 7)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.chip}`}>
            {visit.type}
          </span>
          <span className="truncate text-[15px]">
            {visit.hospital || '未填医院'}
            {visit.department ? ` · ${visit.department}` : ''}
          </span>
        </div>
        <div className="mt-1 truncate text-xs text-stone-400">
          {memberName}
          {visit.doctor ? ` · ${visit.doctor}` : ''}
          {visit.diagnosis ? ` · ${visit.diagnosis}` : ''}
        </div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-stone-300" />
    </Link>
  )
}
