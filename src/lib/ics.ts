// 系统日历(.ics) 导出：把提醒写入手机日历，由系统负责准点提醒（iOS/鸿蒙/安卓通吃）
import dayjs from 'dayjs'
import { newId } from './crypto'

export interface IcsEvent {
  title: string
  date: string // YYYY-MM-DD
  time?: string // HH:MM，默认 09:00
  durationMin?: number // 持续分钟数，默认 30
  note?: string
  alarmMin?: number // 提前提醒分钟数，默认 15
}

const pad = (n: number) => String(n).padStart(2, '0')

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** RFC5545 行折叠：单行超长时折行（按 UTF-8 字节数计算） */
function foldLine(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 73) return line
  const parts: string[] = []
  let cur = ''
  let curBytes = 0
  for (const ch of line) {
    const cb = enc.encode(ch).length
    if (curBytes + cb > (parts.length ? 72 : 73)) {
      parts.push(cur)
      cur = ''
      curBytes = 0
    }
    cur += ch
    curBytes += cb
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

export function buildIcs(events: IcsEvent[], calName = '家庭健康档案提醒'): string {
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//family-health-archive//CN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(calName)}`,
    'X-WR-CALDESC:由家庭健康档案导出的服药与就诊提醒',
  ]
  for (const [i, ev] of events.entries()) {
    const startTime = ev.time ?? '09:00'
    const dur = ev.durationMin ?? 30
    const start = dayjs(`${ev.date}T${startTime}`)
    if (!start.isValid()) continue
    const end = start.add(dur, 'minute')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${newId()}-ev${i}@family-health-archive`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start.format('YYYYMMDDTHHmm00')}`,
      `DTEND:${end.format('YYYYMMDDTHHmm00')}`,
      `SUMMARY:${esc(ev.title)}`,
    )
    if (ev.note) lines.push(`DESCRIPTION:${esc(ev.note)}`)
    const alarm = ev.alarmMin ?? 15
    if (alarm >= 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${alarm}M`, `DESCRIPTION:${esc(ev.title)}`, 'END:VALARM')
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n')
}

export function downloadIcsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
