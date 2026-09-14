import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loader2, MessageCircle, Send } from 'lucide-react'
import { db, getSetting } from '../db'
import { askQuestion, buildAskContext, type AskContext } from '../lib/ask'
import { AiConfig, DEFAULT_AI } from '../lib/ai'
import { MemberChips, PageHeader, inputCls, toast } from '../components/ui'

interface ChatEntry {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

const SUGGESTIONS = [
  '最近血糖趋势怎么样',
  '今年全家医疗花费合计，自付多少',
  '现在各成员都在吃什么药',
  '最近一次就诊是什么时候',
]

export default function AskPage() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const activeId = useLiveQuery(() => getSetting<number | null>('activeMemberId', null), [])
  const [scope, setScope] = useState<number | 'all' | null>(null)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [busy, setBusy] = useState(false)
  const contextRef = useRef<AskContext | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scope === null && activeId !== undefined) setScope(activeId ?? 'all')
  }, [activeId, scope])

  // 切换成员范围时重建上下文并清空会话
  useEffect(() => {
    contextRef.current = null
    setMessages([])
  }, [scope])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const send = async (preset?: string) => {
    const question = (preset ?? input).trim()
    if (!question || busy || scope === null) return
    const cfg = (await getSetting<AiConfig>('aiConfig', DEFAULT_AI)) as AiConfig
    if (!cfg.apiKey) {
      toast('请先在设置中配置 AI Key', 'err')
      return
    }
    setInput('')
    const history = messages
      .filter((m) => !m.error)
      .slice(-6)
      .map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)
    try {
      if (!contextRef.current) contextRef.current = await buildAskContext(scope)
      const answer = await askQuestion(cfg, contextRef.current, history, question)
      setMessages((m) => [...m, { role: 'assistant', content: answer }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessages((m) => [...m, { role: 'assistant', content: '出错了：' + msg, error: true }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader back title="问档案" />
      <div className="pt-2">
        <MemberChips
          members={members}
          value={scope === 'all' ? null : scope}
          onChange={(id) => setScope(id)}
        />
      </div>
      <p className="px-4 pt-2 text-xs leading-5 text-stone-400">
        回答基于你本机档案的文字摘要（不含图片），提问时会发送给所配置的模型服务商。
      </p>

      <div className="space-y-3 px-4 py-3 pb-40">
        {messages.length === 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-stone-600">
              <MessageCircle size={15} className="text-teal-600" /> 试试这样问
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-600 active:bg-stone-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-teal-600 px-3.5 py-2.5 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantBubble key={i} content={m.content} error={m.error} ctx={contextRef.current} />
          ),
        )}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 text-sm text-stone-500 shadow-sm">
              <Loader2 size={14} className="animate-spin" /> 正在翻档案思考…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入栏 */}
      <div className="fixed inset-x-0 bottom-[57px] z-30 border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2">
          <input
            className={`${inputCls} flex-1`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="问点什么，如：今年花了多少"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="rounded-xl bg-teal-600 p-2.5 text-white active:bg-teal-700 disabled:opacity-50"
            aria-label="发送"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
      <div className="h-16" />
    </div>
  )
}

/** 把回答里的 D12/V3/P1/R2 编号渲染成可点击链接（跳到对应单据/就诊） */
function renderContent(content: string, ctx: AskContext | null) {
  const parts = content.split(/((?:[DVPR])\d+)/g)
  return parts.map((p, i) => {
    const m = p.match(/^([DVPR])(\d+)$/)
    if (!m || !ctx) return <span key={i}>{p}</span>
    const kind = m[1]
    const n = Number(m[2])
    const cls = 'mx-0.5 rounded bg-teal-50 px-1 text-teal-700 underline decoration-teal-300'
    if (kind === 'D' && ctx.docIds.has(n))
      return (
        <Link key={i} className={cls} to={`/docs/${n}`}>
          {p}
        </Link>
      )
    if (kind === 'V' && ctx.visitIds.has(n))
      return (
        <Link key={i} className={cls} to={`/visits/${n}`}>
          {p}
        </Link>
      )
    if ((kind === 'P' || kind === 'R') && (ctx.planIds.has(n) || ctx.reminderIds.has(n)))
      return (
        <Link key={i} className={cls} to="/reminders">
          {p}
        </Link>
      )
    return <span key={i}>{p}</span>
  })
}

/** 从回答中拆出正文与引用的记录编号（"来源："行并入编号列表，不再单独显示） */
function splitSources(content: string, ctx: AskContext | null): { body: string; ids: string[] } {
  const ids: string[] = []
  const exists = (id: string) => {
    const kind = id[0]
    const n = Number(id.slice(1))
    if (!ctx) return false
    if (kind === 'D') return ctx.docIds.has(n)
    if (kind === 'V') return ctx.visitIds.has(n)
    if (kind === 'P') return ctx.planIds.has(n)
    return ctx.reminderIds.has(n)
  }
  for (const t of content.matchAll(/[DVPR]\d+/g)) {
    const id = t[0]
    if (exists(id) && !ids.includes(id)) ids.push(id)
  }
  const body = content
    .split('\n')
    .filter((l) => !/^\s*来源\s*[:：]/.test(l))
    .join('\n')
    .trim()
  return { body, ids }
}

function AssistantBubble({
  content,
  error,
  ctx,
}: {
  content: string
  error?: boolean
  ctx: AskContext | null
}) {
  const { body, ids } = error ? { body: content, ids: [] as string[] } : splitSources(content, ctx)
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[90%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm leading-6 ${
          error ? 'bg-rose-50 text-rose-600' : 'bg-white text-stone-700 shadow-sm'
        }`}
      >
        <div className="whitespace-pre-wrap">{renderContent(body, ctx)}</div>
        {ids.length > 0 && (
          <div className="mt-2 border-t border-stone-100 pt-2">
            <div className="mb-1.5 text-[11px] text-stone-400">相关记录（点击直达）</div>
            <div className="flex flex-col gap-1">
              {ids.map((id) => {
                const kind = id[0]
                const n = Number(id.slice(1))
                if (kind === 'D') {
                  const info = ctx?.docMeta.get(n)
                  return (
                    <Link
                      key={id}
                      to={`/docs/${n}`}
                      className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-2 py-1.5 text-xs text-stone-600 active:bg-stone-100"
                    >
                      📄 <span className="min-w-0 flex-1 truncate">{info?.title ?? `单据 ${n}`}</span>
                      <span className="shrink-0 text-[10px] text-stone-400">{info?.date}</span>
                    </Link>
                  )
                }
                if (kind === 'V') {
                  const info = ctx?.visitMeta.get(n)
                  return (
                    <Link
                      key={id}
                      to={`/visits/${n}`}
                      className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-2 py-1.5 text-xs text-stone-600 active:bg-stone-100"
                    >
                      🏥 <span className="min-w-0 flex-1 truncate">{info?.title ?? `就诊 ${n}`}</span>
                      <span className="shrink-0 text-[10px] text-stone-400">{info?.date}</span>
                    </Link>
                  )
                }
                return (
                  <Link
                    key={id}
                    to="/reminders"
                    className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-2 py-1.5 text-xs text-stone-600 active:bg-stone-100"
                  >
                    {kind === 'P' ? '💊' : '⏰'} <span className="flex-1">提醒/计划 {n}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
