import dayjs from 'dayjs'

export function fmtMoney(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function today(): string {
  return dayjs().format('YYYY-MM-DD')
}

export function fmtDate(d: string): string {
  const day = dayjs(d)
  if (!day.isValid()) return d
  return day.year() === dayjs().year() ? day.format('M月D日') : day.format('YYYY年M月D日')
}

export function fmtDateTime(ts: number): string {
  return dayjs(ts).format('YYYY-MM-DD HH:mm')
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ageFromBirth(birth?: string): string | null {
  if (!birth) return null
  const b = dayjs(birth)
  if (!b.isValid()) return null
  const months = dayjs().diff(b, 'month')
  if (months < 24) return `${months}个月`
  return `${Math.floor(months / 12)}岁`
}

export function parseAmount(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
