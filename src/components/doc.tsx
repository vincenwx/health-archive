import { Component, useEffect, useRef, useState, type ReactNode, type TouchEvent as RTouchEvent, type MouseEvent as RMouseEvent, type WheelEvent as RWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, FileText, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { MedDoc } from '../db'
import { useFileUrl, useFileMeta } from '../lib/hooks'

/** 单据缩略图（取第一个附件） */
export function DocThumb({ doc, className = '' }: { doc: MedDoc; className?: string }) {
  const url = useFileUrl(doc.fileIds[0])
  const meta = useFileMeta(doc.fileIds[0])
  return (
    <div className={`flex items-center justify-center overflow-hidden bg-stone-100 ${className}`}>
      {url && meta?.mime.startsWith('image/') ? (
        <img src={url} alt={doc.title} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <FileText size={22} className="text-stone-300" />
      )}
    </div>
  )
}

const MAX_SCALE = 8

/** 自研缩放图片：双指捏合 / 双击放大 / 按钮 / 滚轮，老内核友好 */
function ZoomableImage({ src }: { src: string }) {
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dbg, setDbg] = useState({ ts: 0, tm: 0, cl: 0 })
  const gest = useRef<{
    mode: 'pan' | 'pinch'
    sx: number
    sy: number
    bx: number
    by: number
    dist: number
    bscale: number
  } | null>(null)
  const lastTap = useRef(0)

  useEffect(() => {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }, [src])

  const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(1, s))
  const zoomBy = (f: number) => {
    setDbg((d) => ({ ...d, cl: d.cl + 1 }))
    setScale((s) => clamp(s * f))
  }
  const reset = () => {
    setScale(1)
    setPos({ x: 0, y: 0 })
  }

  const tdist = (a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) =>
    Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

  const onTouchStart = (e: RTouchEvent) => {
    setDbg((d) => ({ ...d, ts: d.ts + 1 }))
    if (e.touches.length === 2) {
      gest.current = {
        mode: 'pinch',
        sx: 0,
        sy: 0,
        bx: pos.x,
        by: pos.y,
        dist: tdist(e.touches[0], e.touches[1]),
        bscale: scale,
      }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      gest.current = { mode: 'pan', sx: t.clientX, sy: t.clientY, bx: pos.x, by: pos.y, dist: 0, bscale: scale }
    }
  }

  const onTouchMove = (e: RTouchEvent) => {
    const g = gest.current
    if (!g) return
    setDbg((d) => ({ ...d, tm: d.tm + 1 }))
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const d = tdist(e.touches[0], e.touches[1])
      setScale(clamp((g.bscale * d) / g.dist))
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]
      setPos({ x: g.bx + (t.clientX - g.sx), y: g.by + (t.clientY - g.sy) })
    }
  }

  const onTouchEnd = (e: RTouchEvent) => {
    const g = gest.current
    if (g?.mode === 'pan' && e.touches.length === 0) {
      const now = Date.now()
      if (now - lastTap.current < 300) {
        if (scale > 1) reset()
        else setScale(2.5)
        lastTap.current = 0
      } else {
        lastTap.current = now
      }
    }
    if (e.touches.length === 0) gest.current = null
    else if (e.touches.length === 1 && g?.mode === 'pinch') {
      const t = e.touches[0]
      gest.current = { mode: 'pan', sx: t.clientX, sy: t.clientY, bx: pos.x, by: pos.y, dist: 0, bscale: scale }
    }
  }

  const dragging = useRef(false)
  const onMouseDown = (e: RMouseEvent) => {
    dragging.current = true
    gest.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y, dist: 0, bscale: scale }
  }
  const onMouseMove = (e: RMouseEvent) => {
    if (!dragging.current) return
    const g = gest.current
    if (!g) return
    setPos({ x: g.bx + (e.clientX - g.sx), y: g.by + (e.clientY - g.sy) })
  }
  const onMouseUp = () => {
    dragging.current = false
  }
  const onWheel = (e: RWheelEvent) => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)

  return (
    <div
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
          transformOrigin: '50% 50%',
        }}
      />
      <div className="pointer-events-none absolute left-2 top-2 text-[10px] leading-4 text-lime-300">
        诊断：触{dbg.ts} 移{dbg.tm} 点{dbg.cl} · {Math.round(scale * 10) / 10}x
      </div>
      <div className="absolute bottom-2 right-2 flex gap-2">
        <button
          onClick={() => zoomBy(1.3)}
          className="rounded-full bg-white/15 p-2 text-white active:bg-white/30"
          aria-label="放大"
        >
          <ZoomIn size={18} />
        </button>
        <button
          onClick={() => zoomBy(1 / 1.3)}
          className="rounded-full bg-white/15 p-2 text-white active:bg-white/30"
          aria-label="缩小"
        >
          <ZoomOut size={18} />
        </button>
        <button
          onClick={reset}
          className="rounded-full bg-white/15 p-2 text-white active:bg-white/30"
          aria-label="复原"
        >
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  )
}

function isImageMeta(meta?: { mime: string }): boolean {
  return meta ? meta.mime.startsWith('image/') : true
}

/** 详情页主预览：大图点击进全屏；PDF 给打开按钮 */
export function MainPreview({ fileId, onOpen }: { fileId: string; onOpen: () => void }) {
  const url = useFileUrl(fileId)
  const meta = useFileMeta(fileId)
  if (!isImageMeta(meta)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-3 rounded-2xl bg-stone-100 p-4 active:bg-stone-200"
      >
        <FileText size={24} className="shrink-0 text-stone-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-stone-600">{meta?.name ?? '文件'}</div>
          <div className="text-xs text-stone-400">点击在新窗口打开</div>
        </div>
      </a>
    )
  }
  return (
    <button onClick={onOpen} className="relative block w-full active:opacity-90">
      <span className="ratio-4-3 w-full">
        {url ? (
          <img src={url} alt="" className="fill-abs rounded-2xl object-cover" />
        ) : (
          <span className="fill-abs block bg-stone-100" />
        )}
      </span>
      <span className="absolute bottom-2 right-2 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white">
        点击放大
      </span>
    </button>
  )
}

/** 查看器错误边界：渲染崩溃时把错误显示在屏幕上（而不是一闪而过） */
class ViewerBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  render() {
    if (this.state.err) {
      return (
        <div className="fixed inset-0 z-[70] overflow-auto bg-rose-950 p-4 text-sm leading-6 text-rose-100">
          <div className="mb-2 font-bold">查看器出错（请截图发给开发者）：</div>
          <div className="break-all font-mono text-xs">
            {String(this.state.err?.stack ?? this.state.err)}
          </div>
          <button
            onClick={() => this.setState({ err: null })}
            className="mt-4 rounded-lg bg-white/10 px-4 py-2"
          >
            关闭
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

/** 附件全屏查看器（仅图片可翻页预览，PDF 提示去详情页打开） */
export function FullscreenViewer({
  fileIds,
  index,
  onClose,
  onIndex,
}: {
  fileIds: string[]
  index: number
  onClose: () => void
  onIndex: (i: number) => void
}) {
  const fileId = fileIds[index]
  const url = useFileUrl(fileId)
  const meta = useFileMeta(fileId)
  const isImage = meta ? meta.mime.startsWith('image/') : true
  // 防误触：全屏刚打开的 500ms 内，忽略关闭/切换（拦截手机浏览器松手后补发的合成点击，
  // 否则它会落在刚弹出的全屏层上造成"一闪即关"）
  const openedAt = useRef(Date.now())
  const safeClose = () => {
    if (Date.now() - openedAt.current < 500) return
    onClose()
  }
  const safeIndex = (i: number) => {
    if (Date.now() - openedAt.current < 500) return
    onIndex(i)
  }
  // Portal 挂到 body：老内核浏览器对滚动容器内的 fixed 全屏层定位有 bug
  return createPortal(
    <ViewerBoundary>
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="safe-top flex h-12 items-center justify-between px-3 text-white">
        <span className="text-sm text-white/70">
          {index + 1} / {fileIds.length}
        </span>
        <button onClick={safeClose} className="rounded-full p-1.5 active:bg-white/10" aria-label="关闭">
          <X size={24} />
        </button>
      </div>
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-2 pb-6">
        {isImage ? (
          url ? (
            <ZoomableImage src={url} />
          ) : (
            <span className="text-sm text-white/60">加载中…</span>
          )
        ) : (
          <div className="text-center text-white/70">
            <FileText size={40} className="mx-auto mb-3" />
            <div className="text-sm">{meta?.name ?? '文件'}</div>
            <div className="mt-1 text-xs">该附件类型请返回详情页打开查看</div>
          </div>
        )}
        {isImage && (
          <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 text-[11px] text-white/50">
            双击放大 · 双指缩放 · 拖动移动
          </div>
        )}
        {fileIds.length > 1 && (
          <>
            <button
              onClick={() => safeIndex((index - 1 + fileIds.length) % fileIds.length)}
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white active:bg-white/20"
              aria-label="上一张"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              onClick={() => safeIndex((index + 1) % fileIds.length)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white active:bg-white/20"
              aria-label="下一张"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>
    </ViewerBoundary>,
    document.body,
  )
}

/** 附件缩略图条（详情页用） */
export function FileStrip({
  fileIds,
  onPick,
}: {
  fileIds: string[]
  onPick?: (index: number) => void
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {fileIds.map((fid, i) => (
        <ThumbById key={fid} fileId={fid} onClick={() => onPick?.(i)} />
      ))}
    </div>
  )
}

function ThumbById({ fileId, onClick }: { fileId: string; onClick: () => void }) {
  const url = useFileUrl(fileId)
  const meta = useFileMeta(fileId)
  const isImage = meta?.mime.startsWith('image/') ?? false
  return (
    <button
      onClick={onClick}
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-100 active:opacity-80"
    >
      {url && isImage ? (
        <img src={url} alt={meta?.name ?? ''} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-stone-400">
          <FileText size={20} className="shrink-0" />
          <span className="w-full truncate text-center text-[10px]">{meta?.name ?? '文件'}</span>
        </div>
      )}
    </button>
  )
}
