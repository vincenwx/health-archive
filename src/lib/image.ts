// 上传文件预处理：大图压缩到最长边 2048px 的 JPEG，其余原样保留
// 兼容旧内核：图片解码带 <img> 兜底，字节读取带 FileReader 兜底

const MAX_DIM = 2048
const KEEP_BELOW = 400 * 1024

export interface NormalizedFile {
  blob: Blob
  mime: string
  name: string
}

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsArrayBuffer(blob)
  })
}

interface DecodedImage {
  w: number
  h: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

function decodeImage(file: Blob): Promise<DecodedImage | null> {
  return new Promise((resolve) => {
    // 优先 createImageBitmap，旧内核回退到 <img>
    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then((bmp) => {
          resolve({
            w: bmp.width,
            h: bmp.height,
            draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
          })
          return
        })
        .catch(() => {})
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({
        w: img.naturalWidth,
        h: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

async function toScaledJpeg(file: Blob): Promise<Blob | null> {
  try {
    const dec = await decodeImage(file)
    if (!dec || !dec.w || !dec.h) return null
    const scale = Math.min(1, MAX_DIM / Math.max(dec.w, dec.h))
    const w = Math.max(1, Math.round(dec.w * scale))
    const h = Math.max(1, Math.round(dec.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    dec.draw(ctx, w, h)
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    )
  } catch {
    return null
  }
}

export async function normalizeFile(file: File): Promise<NormalizedFile> {
  const isImage = file.type.startsWith('image/')
  if (isImage && file.size > KEEP_BELOW) {
    const jpeg = await toScaledJpeg(file)
    if (jpeg) {
      const base = file.name.replace(/\.[^.]+$/, '') || '照片'
      return { blob: jpeg, mime: 'image/jpeg', name: `${base}.jpg` }
    }
  }
  return { blob: file, mime: file.type || 'application/octet-stream', name: file.name || '未命名' }
}
