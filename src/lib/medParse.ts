// 用药计划的频次/时长解析与工具
import dayjs from 'dayjs'

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

function num(raw: string): number | undefined {
  const n = Number(raw) || CN_NUM[raw]
  return Number.isFinite(n) ? n : undefined
}

/** 从频次文本解析每日次数，如 "每日3次" / "一日三次" → 3 */
export function parseTimesPerDay(s?: string): number | undefined {
  if (!s) return undefined
  const m = s.match(/([0-9一二两三四五六])\s*次/)
  if (!m) return undefined
  const n = num(m[1])
  return n && n >= 1 && n <= 6 ? n : undefined
}

/** 从时长文本解析天数，如 "7天" / "连用两周" → 7 / 14 */
export function parseDays(s?: string): number | undefined {
  if (!s) return undefined
  const w = s.match(/([0-9一二两三四五六])\s*周/)
  if (w) {
    const n = num(w[1])
    return n ? n * 7 : undefined
  }
  const m = s.match(/([0-9一二两三四五六])\s*(?:天|日)/)
  if (m) {
    const n = num(m[1])
    return n && n <= 365 ? n : undefined
  }
  return undefined
}

/** 每日次数对应的默认时间点 */
export function defaultTimes(n: number): string[] {
  const presets: Record<number, string[]> = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '12:00', '18:00'],
    4: ['08:00', '12:00', '16:00', '20:00'],
    5: ['06:00', '10:00', '14:00', '18:00', '22:00'],
    6: ['06:00', '10:00', '14:00', '18:00', '22:00', '02:00'],
  }
  return (presets[n] ?? presets[3]).slice(0, n)
}

export function addDays(dateStr: string, days: number): string {
  const d = dayjs(dateStr).add(days, 'day')
  return d.isValid() ? d.format('YYYY-MM-DD') : dateStr
}

/** 计划最后一天 */
export function planEndDate(p: { startDate: string; days: number }): string {
  return addDays(p.startDate, Math.max(0, p.days - 1))
}

/** 距计划结束还剩几天（负数 = 已超期） */
export function planDaysLeft(p: { startDate: string; days: number }): number {
  return dayjs(planEndDate(p)).diff(dayjs(todayStr()), 'day')
}

function todayStr(): string {
  return dayjs().format('YYYY-MM-DD')
}
