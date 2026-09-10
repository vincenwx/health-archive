// 访问口令：PBKDF2-SHA256（WebCrypto，需 HTTPS 或 localhost 环境）

const encoder = new TextEncoder()

export function isSecureEnough(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function randomSalt(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return toHex(b)
}

export const PBKDF2_ITERATIONS = 210000

export async function hashPassword(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export async function verifyPassword(
  password: string,
  saltHex: string,
  iterations: number,
  expectedHex: string,
): Promise<boolean> {
  const actual = await hashPassword(password, saltHex, iterations)
  if (actual.length !== expectedHex.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHex.charCodeAt(i)
  }
  return diff === 0
}

export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // 非安全上下文兜底
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}
