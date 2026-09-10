import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter } from 'react-router-dom'
import { getSetting, type SecurityConfig } from './db'
import { LockScreen } from './pages/LockScreen'
import { Layout } from './components/Layout'

const UNLOCK_KEY = 'fha-unlocked'

export default function App() {
  // security: undefined=加载中, null=未启用口令, 对象=已启用
  const security = useLiveQuery(async () => {
    if (!window.isSecureContext) return null // 非安全上下文无法做 PBKDF2 校验，跳过锁定
    return getSetting<SecurityConfig | null>('security', null)
  }, [])
  const [locked, setLocked] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (security === undefined) return
    setLocked(!!security && sessionStorage.getItem(UNLOCK_KEY) !== '1')
    setReady(true)
  }, [security])

  // 请求持久化存储，降低浏览器自动清理数据的风险
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {})
  }, [])

  // 无操作自动锁定
  useEffect(() => {
    if (!security) return
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    for (const ev of events) window.addEventListener(ev, bump, { passive: true })
    const timer = setInterval(() => {
      const min = security.autoLockMin
      if (min > 0 && !locked && Date.now() - last > min * 60_000) {
        sessionStorage.removeItem(UNLOCK_KEY)
        setLocked(true)
      }
    }, 5000)
    return () => {
      clearInterval(timer)
      for (const ev of events) window.removeEventListener(ev, bump)
    }
  }, [security, locked])

  if (security === undefined || !ready) {
    return (
      <div className="flex h-full items-center justify-center bg-teal-600 text-white">
        <div className="text-lg font-semibold">家庭健康档案</div>
      </div>
    )
  }

  if (security && locked) {
    return (
      <LockScreen
        security={security}
        onUnlock={() => {
          sessionStorage.setItem(UNLOCK_KEY, '1')
          setLocked(false)
        }}
      />
    )
  }

  return (
    <HashRouter>
      <Layout />
    </HashRouter>
  )
}
