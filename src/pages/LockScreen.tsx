import { useState } from 'react'
import { Lock } from 'lucide-react'
import type { SecurityConfig } from '../db'
import { verifyPassword } from '../lib/crypto'

export function LockScreen({ security, onUnlock }: { security: SecurityConfig; onUnlock: () => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!pw || busy) return
    setBusy(true)
    try {
      const ok = await verifyPassword(pw, security.salt, security.iterations, security.hash)
      if (ok) {
        onUnlock()
      } else {
        setError(true)
        setPw('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-b from-teal-600 to-teal-800 px-8">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15">
        <Lock size={30} className="text-white" />
      </div>
      <div className="mb-8 text-xl font-semibold text-white">家庭健康档案</div>
      <input
        type="password"
        value={pw}
        autoFocus
        onChange={(e) => {
          setPw(e.target.value)
          setError(false)
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="输入访问口令"
        className={`w-full max-w-xs rounded-xl border bg-white/95 px-4 py-3 text-center text-lg tracking-widest outline-none ${
          error ? 'border-rose-400 ring-2 ring-rose-400/30' : 'border-transparent focus:ring-2 focus:ring-white/40'
        }`}
      />
      {error && <div className="mt-2 text-sm text-rose-200">口令不正确，请重试</div>}
      <button
        onClick={submit}
        disabled={busy}
        className="mt-4 w-full max-w-xs rounded-xl bg-white py-3 font-medium text-teal-700 active:bg-teal-50 disabled:opacity-60"
      >
        {busy ? '校验中…' : '解锁'}
      </button>
    </div>
  )
}
