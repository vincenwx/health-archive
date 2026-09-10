// 保存单据时自动归就诊：按「成员 + 日期 + 医院 + 科室」匹配已有就诊，匹配不到则自动创建
import { db, categoryToVisitType, type MedDoc, type Visit } from '../db'

export interface VisitResolution {
  visitId?: number
  created: boolean // 新建了就诊
  matched: boolean // 归入了已有就诊
}

const eq = (a?: string, b?: string) => (a ?? '').trim() !== '' && (a ?? '').trim() === (b ?? '').trim()

export async function resolveVisit(
  doc: Pick<
    MedDoc,
    'memberId' | 'category' | 'docDate' | 'hospital' | 'department' | 'doctor' | 'diagnosis'
  >,
  explicitVisitId?: number,
): Promise<VisitResolution> {
  if (explicitVisitId) {
    const v = await db.visits.get(explicitVisitId)
    if (v) return { visitId: explicitVisitId, created: false, matched: true }
  }
  if (!doc.hospital?.trim()) return { created: false, matched: false }

  const candidates = await db.visits.where('memberId').equals(doc.memberId).toArray()
  const sameDay = candidates.filter((v) => v.date === doc.docDate)
  const hospital = doc.hospital.trim()
  const department = doc.department?.trim()

  // 匹配优先级：
  // 1. 同日同院同科（科室都有且相同）
  // 2. 同日同院，且其中一方没填科室（信息不全时不强行拆分）
  // 3. 同日仅有一条且没填医院（早先用法的兼容）
  const match =
    sameDay.find((v) => eq(v.hospital, hospital) && eq(v.department, department)) ??
    sameDay.find((v) => eq(v.hospital, hospital) && (!v.department?.trim() || !department)) ??
    (sameDay.length === 1 && !sameDay[0].hospital ? sameDay[0] : undefined)

  if (match?.id) return { visitId: match.id, created: false, matched: true }

  const now = Date.now()
  const newVisit: Visit = {
    memberId: doc.memberId,
    type: categoryToVisitType(doc.category),
    date: doc.docDate,
    hospital,
    department: department || undefined,
    doctor: doc.doctor,
    diagnosis: doc.diagnosis,
    createdAt: now,
    updatedAt: now,
  }
  const id = await db.visits.add(newVisit)
  return { visitId: id, created: true, matched: false }
}
