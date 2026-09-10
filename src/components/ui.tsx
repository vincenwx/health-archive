import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus } from 'lucide-react'
import type { Member } from '../db'
import { ageFromBirth } from '../lib/format'

// ---------- 轻量 Toast ----------

type ToastType = 'ok' | 'err'
let toastListener: ((msg: string, type: ToastType) => void) | null = null

export function toast(msg: string, type: ToastType = 'ok') {
  toastListener?.(msg, type)
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; type: ToastType }[]>([])
  useEffect(() => {
    toastListener = (msg, type) => {
      const id = Date.now() + Math.random()
      setItems((s) => [...s, { id, msg, type }])
      setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 2600)
    }
    return () => {
      toastListener = null
    }
  }, [])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-6">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-full px-4 py-2 text-sm text-white shadow-lg ${
            t.type === 'err' ? 'bg-rose-600' : 'bg-stone-800'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  )
}

// ---------- 页面骨架 ----------

export function PageHeader({
  title,
  back,
  actions,
}: {
  title: ReactNode
  back?: boolean
  actions?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="safe-top sticky top-0 z-20 border-b border-stone-200/70 bg-stone-50/95 backdrop-blur">
      <div className="flex h-12 items-center gap-1 px-3">
        {back && (
          <button
            onClick={() => navigate(-1)}
            className="-ml-1 rounded-full p-1.5 text-stone-500 active:bg-stone-200"
            aria-label="返回"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</div>
        {actions}
      </div>
    </div>
  )
}

export function FAB({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="fixed bottom-20 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/30 active:bg-teal-700"
      style={{ right: 'max(1rem, calc(50vw - 22rem))' }}
      aria-label="新增"
    >
      <Plus size={26} />
    </Link>
  )
}

export function EmptyState({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-stone-400">
      {icon}
      <div className="text-sm">{text}</div>
    </div>
  )
}

// ---------- 表单 ----------

export const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[15px] outline-none placeholder:text-stone-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-stone-500">{label}</span>
      {children}
    </label>
  )
}

// ---------- 成员 ----------

export function MemberAvatar({ member, size = 40 }: { member: Member; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-teal-100 font-semibold text-teal-700"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {member.name.slice(0, 1)}
    </div>
  )
}

export function MemberChips({
  members,
  value,
  onChange,
}: {
  members: Member[]
  value: number | null
  onChange: (id: number | null) => void
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-1">
      <Chip active={value === null} onClick={() => onChange(null)}>
        全部
      </Chip>
      {members.map((m) => (
        <Chip key={m.id} active={value === m.id} onClick={() => onChange(m.id ?? null)}>
          {m.name}
          {ageFromBirth(m.birthDate) ? ` · ${ageFromBirth(m.birthDate)}` : ''}
        </Chip>
      ))}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
        active ? 'bg-teal-600 font-medium text-white' : 'bg-white text-stone-600 border border-stone-200'
      }`}
    >
      {children}
    </button>
  )
}
