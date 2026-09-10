// 备份：整库导出为 zip（数据 + 原始文件），导入时全量恢复
import { zip, unzip, strToU8, strFromU8, type Zippable, type Unzipped } from 'fflate'
import {
  db,
  APP_NAME,
  SCHEMA_VERSION,
  setSetting,
  type ArchiveFile,
  type Member,
  type Visit,
  type MedDoc,
  type Setting,
} from '../db'
import { blobToArrayBuffer } from './image'

const zipAsync = (data: Zippable, opts: { level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) =>
  new Promise<Uint8Array>((resolve, reject) =>
    zip(data, opts, (err, out) => (err ? reject(err) : resolve(out))),
  )

const unzipAsync = (data: Uint8Array) =>
  new Promise<Unzipped>((resolve, reject) =>
    unzip(data, (err, out) => (err ? reject(err) : resolve(out))),
  )

function u8ToBlob(u8: Uint8Array, type: string): Blob {
  return new Blob([u8.slice().buffer as ArrayBuffer], { type })
}

function downloadBlob(blob: Blob, filename: string) {  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function exportBackup(): Promise<string> {
  const [members, visits, docs, files, settings] = await Promise.all([
    db.members.toArray(),
    db.visits.toArray(),
    db.docs.toArray(),
    db.files.toArray(),
    db.settings.toArray(),
  ])
  const fileMetas = files.map((f) => ({
    id: f.id,
    docId: f.docId,
    name: f.name,
    mime: f.mime,
    size: f.size,
    createdAt: f.createdAt,
  }))
  const manifest = {
    app: APP_NAME,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      members: members.length,
      visits: visits.length,
      docs: docs.length,
      files: files.length,
    },
  }
  const entries: Zippable = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'data.json': strToU8(JSON.stringify({ members, visits, docs, files: fileMetas, settings }, null, 2)),
  }
  for (const f of files) {
    const bytes = f.blob ? new Uint8Array(await blobToArrayBuffer(f.blob)) : new Uint8Array(f.data)
    entries[`files/${f.id}/${encodeURIComponent(f.name)}`] = bytes
  }
  const out = await zipAsync(entries, { level: 6 })
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 13) // YYYYMMDDHHmm
  const filename = `健康档案备份-${stamp}.zip`
  downloadBlob(u8ToBlob(out, 'application/zip'), filename)
  await setSetting('lastBackupAt', Date.now())
  return filename
}

export interface ImportResult {
  members: number
  visits: number
  docs: number
  files: number
}

export async function importBackup(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = await unzipAsync(bytes)
  const manifestRaw = entries['manifest.json']
  const dataRaw = entries['data.json']
  if (!manifestRaw || !dataRaw) throw new Error('不是有效的备份文件（缺少 manifest.json 或 data.json）')
  const manifest = JSON.parse(strFromU8(manifestRaw))
  if (manifest.app !== APP_NAME) throw new Error('备份文件来源不符，拒绝导入')
  if (manifest.schemaVersion > SCHEMA_VERSION)
    throw new Error('备份来自更新版本的应用，请先升级应用再导入')

  const data = JSON.parse(strFromU8(dataRaw)) as {
    members?: Member[]
    visits?: Visit[]
    docs?: MedDoc[]
    files?: Omit<ArchiveFile, 'blob'>[]
    settings?: Setting[]
  }

  const fileRows: ArchiveFile[] = (data.files ?? []).map((m) => {
    const key = Object.keys(entries).find((k) => k.startsWith(`files/${m.id}/`))
    if (!key) throw new Error(`备份缺少文件内容：${m.name}`)
    const u8 = entries[key]
    return { ...m, data: u8.slice().buffer as ArrayBuffer, blob: undefined } as ArchiveFile
  })

  await db.transaction('rw', [db.members, db.visits, db.docs, db.files, db.settings], async () => {
    await Promise.all([
      db.members.clear(),
      db.visits.clear(),
      db.docs.clear(),
      db.files.clear(),
      db.settings.clear(),
    ])
    if (data.members?.length) await db.members.bulkPut(data.members)
    if (data.visits?.length) await db.visits.bulkPut(data.visits)
    if (data.docs?.length) await db.docs.bulkPut(data.docs)
    if (fileRows.length) await db.files.bulkPut(fileRows)
    if (data.settings?.length) await db.settings.bulkPut(data.settings)
    await setSetting('lastRestoreAt', Date.now())
  })

  return {
    members: data.members?.length ?? 0,
    visits: data.visits?.length ?? 0,
    docs: data.docs?.length ?? 0,
    files: fileRows.length,
  }
}
