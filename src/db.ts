import Dexie, { type Table } from 'dexie'

export const APP_NAME = 'family-health-archive'
export const APP_TITLE = '家庭健康档案'
export const APP_VERSION = '0.2.9 (M2)'
export const SCHEMA_VERSION = 1

// ---------- 实体类型 ----------

export interface Member {
  id?: number
  name: string
  relation: string
  gender?: string
  birthDate?: string
  bloodType?: string
  allergies?: string
  notes?: string
  createdAt: number
}

export const RELATIONS = ['本人', '配偶', '父亲', '母亲', '儿子', '女儿', '公公', '婆婆', '岳父', '岳母', '其他'] as const
export const GENDERS = ['男', '女', '其他'] as const

export const VISIT_TYPES = ['门诊', '住院', '体检', '疫苗', '自购', '其他'] as const
export type VisitType = (typeof VISIT_TYPES)[number]

/** 就诊类型的展示样式（徽章配色） */
export const VISIT_TYPE_STYLE: Record<VisitType, { chip: string }> = {
  门诊: { chip: 'bg-sky-100 text-sky-700' },
  住院: { chip: 'bg-rose-100 text-rose-700' },
  体检: { chip: 'bg-emerald-100 text-emerald-700' },
  疫苗: { chip: 'bg-amber-100 text-amber-700' },
  自购: { chip: 'bg-stone-200 text-stone-600' },
  其他: { chip: 'bg-stone-200 text-stone-600' },
}

export interface Visit {
  id?: number
  memberId: number
  type: VisitType
  date: string // YYYY-MM-DD
  hospital?: string
  department?: string
  doctor?: string
  diagnosis?: string
  summary?: string
  /** 就诊级 AI 综合解读（覆盖本次就诊全部单据） */
  interpretation?: string
  interpretationAt?: number
  interpretationModel?: string
  createdAt: number
  updatedAt: number
}

export type DocCategory =
  | '挂号单'
  | '门诊病历'
  | '处方'
  | '用药指导'
  | '发票'
  | '费用清单'
  | '化验单'
  | '检查报告'
  | '出院小结'
  | '住院费用明细'
  | '手术记录'
  | '体检报告'
  | '疫苗记录'
  | '自购小票'
  | '其他'

export const CATEGORY_GROUPS: { group: string; cats: DocCategory[] }[] = [
  { group: '门诊类', cats: ['挂号单', '门诊病历', '处方', '用药指导', '发票', '费用清单'] },
  { group: '检验检查', cats: ['化验单', '检查报告'] },
  { group: '住院类', cats: ['出院小结', '住院费用明细', '手术记录'] },
  { group: '体检疫苗', cats: ['体检报告', '疫苗记录'] },
  { group: '其他', cats: ['自购小票', '其他'] },
]

export const ALL_CATEGORIES: DocCategory[] = CATEGORY_GROUPS.flatMap((g) => g.cats)

export interface MedDoc {
  id?: number
  memberId: number
  visitId?: number
  category: DocCategory
  title: string
  docDate: string // YYYY-MM-DD
  hospital?: string
  department?: string
  doctor?: string
  diagnosis?: string
  amount?: number | null
  selfPaid?: number | null
  note?: string
  fileIds: string[]
  aiMeta?: AiMeta
  createdAt: number
  updatedAt: number
}

/** 处方/用药指导里识别出的药品 */
export interface MedItem {
  name: string
  dosage?: string // 每次剂量，如 0.5g
  frequency?: string // 如 每日3次
  timing?: string // 如 饭后
  duration?: string // 如 7天
}

/** 化验单里识别出的指标 */
export interface LabIndicator {
  name: string
  value?: string
  unit?: string
  reference?: string
  flag?: string // 偏高 / 偏低 / 正常
}

export interface AiMeta {
  model?: string
  recognizedAt: number
  medications?: MedItem[]
  indicators?: LabIndicator[]
  interpretation?: string // AI 大白话解读
  interpretationAt?: number
}

/** 按单据类型推断就诊类型 */
export function categoryToVisitType(c: DocCategory): VisitType {
  if (c === '出院小结' || c === '住院费用明细' || c === '手术记录') return '住院'
  if (c === '体检报告') return '体检'
  if (c === '疫苗记录') return '疫苗'
  if (c === '自购小票') return '自购'
  return '门诊'
}

export interface ArchiveFile {
  id: string
  docId?: number
  name: string
  mime: string
  size: number
  /** 文件内容存原始字节（旧版 Safari/WebView 不支持在 IndexedDB 里存 Blob） */
  data: ArrayBuffer
  /** 极旧版本数据的遗留字段，仅读取兼容 */
  blob?: Blob
  createdAt: number
}

/** 取文件内容为 Blob（兼容新旧两种存储） */
export function fileBlob(f: ArchiveFile): Blob {
  if (f.blob) return f.blob
  return new Blob([f.data], { type: f.mime })
}

export interface SecurityConfig {
  hash: string
  salt: string
  iterations: number
  autoLockMin: number // 0 = 不自动锁定
}

export interface Setting {
  key: string
  value: unknown
}

// ---------- 数据库 ----------

class AppDB extends Dexie {
  members!: Table<Member, number>
  visits!: Table<Visit, number>
  docs!: Table<MedDoc, number>
  files!: Table<ArchiveFile, string>
  settings!: Table<Setting, string>

  constructor() {
    super(APP_NAME)
    this.version(1).stores({
      members: '++id, name',
      visits: '++id, memberId, type, date, [memberId+date]',
      docs: '++id, memberId, visitId, category, docDate, [memberId+docDate]',
      files: 'id, docId',
      settings: 'key',
    })
  }
}

export const db = new AppDB()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export function setSetting(key: string, value: unknown) {
  return db.settings.put({ key, value })
}
