import { useEffect, useState } from 'react'
import { db, fileBlob } from '../db'

export interface FileMeta {
  id: string
  name: string
  mime: string
  size: number
}

/** 从 IndexedDB 取文件 blob 并生成 object URL（自动释放） */
export function useFileUrl(fileId?: string): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let dead = false
    let created: string | undefined
    if (!fileId) {
      setUrl(undefined)
      return
    }
    db.files
      .get(fileId)
      .then((f) => {
        if (!f || dead) return
        created = URL.createObjectURL(fileBlob(f))
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      dead = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId])
  return url
}

/** 读取文件元信息（不加载 blob 到内存） */
export function useFileMeta(fileId?: string): FileMeta | undefined {
  const [meta, setMeta] = useState<FileMeta>()
  useEffect(() => {
    let dead = false
    if (!fileId) {
      setMeta(undefined)
      return
    }
    db.files
      .get(fileId)
      .then((f) => {
        if (!f || dead) return
        setMeta({ id: f.id, name: f.name, mime: f.mime, size: f.size })
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [fileId])
  return meta
}
