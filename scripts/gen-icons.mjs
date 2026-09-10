// 生成 PWA 图标（纯 Node 实现 PNG 编码，无需任何依赖）
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

let CRC_TABLE
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function pngEncode(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inRounded(x, y, s, r) {
  const cx = Math.min(Math.max(x, r), s - r)
  const cy = Math.min(Math.max(y, r), s - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// 圆角方块 + 白色十字，青绿渐变背景
function makeIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const top = [16, 185, 129] // emerald-500
  const bottom = [13, 148, 136] // teal-600
  const r = maskable ? 0 : size * 0.2
  // maskable 需要留出安全区（图形只占约 60%）
  const scale = maskable ? 0.6 : 1
  const barW = size * 0.17 * scale
  const barL = size * 0.56 * scale
  const cx = size / 2
  const cy = size / 2
  for (let y = 0; y < size; y++) {
    const t = y / size
    const br = Math.round(top[0] + (bottom[0] - top[0]) * t)
    const bg = Math.round(top[1] + (bottom[1] - top[1]) * t)
    const bb = Math.round(top[2] + (bottom[2] - top[2]) * t)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRounded(x, y, size, r)) continue // 圆角外透明
      const inCross =
        (Math.abs(x - cx) < barW / 2 && Math.abs(y - cy) < barL / 2) ||
        (Math.abs(y - cy) < barW / 2 && Math.abs(x - cx) < barL / 2)
      if (inCross) {
        buf[i] = 255
        buf[i + 1] = 255
        buf[i + 2] = 255
      } else {
        buf[i] = br
        buf[i + 1] = bg
        buf[i + 2] = bb
      }
      buf[i + 3] = 255
    }
  }
  return pngEncode(size, size, buf)
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-512.png', makeIcon(512))
writeFileSync('public/icons/icon-192.png', makeIcon(192))
writeFileSync('public/icons/icon-512-maskable.png', makeIcon(512, { maskable: true }))
writeFileSync('public/icons/apple-touch-icon.png', makeIcon(180, { maskable: true }))
console.log('icons generated: 512 / 192 / 512-maskable / apple-touch-180')
