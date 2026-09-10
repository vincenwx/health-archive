// 生成一张 800x600 测试照片（纯 Node，无依赖）
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

let T
function crc32(buf) {
  if (!T) {
    T = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      T[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function png(w, h, rgba) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const W = 800
const H = 600
const buf = Buffer.alloc(W * H * 4)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    // 青绿背景 + 白色大十字 + 蓝色角块，便于确认缩放和切换
    buf[i] = 20
    buf[i + 1] = 150 - Math.floor((y / H) * 60)
    buf[i + 2] = 130
    buf[i + 3] = 255
    const cx = W / 2
    const cy = H / 2
    const inCross =
      (Math.abs(x - cx) < 60 && Math.abs(y - cy) < 200) ||
      (Math.abs(y - cy) < 60 && Math.abs(x - cx) < 200)
    if (inCross) {
      buf[i] = 255
      buf[i + 1] = 255
      buf[i + 2] = 255
    }
    if (x < 90 && y < 90) {
      buf[i] = 30
      buf[i + 1] = 60
      buf[i + 2] = 220
    }
  }
}
writeFileSync('D:/test-photo.png', png(W, H, buf))
console.log('test image written: D:/test-photo.png')
