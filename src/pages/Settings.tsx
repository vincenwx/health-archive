import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import {
  Database,
  Download,
  Info,
  KeyRound,
  Loader2,
  Pencil,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
} from 'lucide-react'
import {
  db,
  getSetting,
  APP_VERSION,
  GENDERS,
  RELATIONS,
  type Member,
  type SecurityConfig,
} from '../db'
import { fmtDateTime, fmtSize } from '../lib/format'
import { PBKDF2_ITERATIONS, hashPassword, isSecureEnough, newId, randomSalt, verifyPassword } from '../lib/crypto'
import { exportBackup, importBackup } from '../lib/backup'
import { DEFAULT_AI, testAiConnection, type AiConfig } from '../lib/ai'
import { blobToArrayBuffer } from '../lib/image'
import { today } from '../lib/format'
import { Field, MemberAvatar, PageHeader, inputCls, toast } from '../components/ui'

export default function SettingsPage() {
  return (
    <div className="pb-24">
      <PageHeader title="设置" />
      <div className="space-y-6 px-4 pt-4">
        <MemberSection />
        <SecuritySection />
        <AiSection />
        <BackupSection />
        <AboutSection />
      </div>
    </div>
  )
}

// ---------- 成员管理 ----------

function MemberSection() {
  const members = useLiveQuery(() => db.members.toArray(), []) ?? []
  const [editing, setEditing] = useState<Member | 'new' | null>(null)

  return (
    <section>
      <SectionTitle icon={<UserPlus size={16} />} title="家庭成员" />
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        {members.length === 0 && <div className="p-4 text-sm text-stone-400">还没有成员，先添加一个</div>}
        {members.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setEditing(m)}
            className={`flex w-full items-center gap-3 p-3.5 text-left active:bg-stone-50 ${
              i > 0 ? 'border-t border-stone-100' : ''
            }`}
          >
            <MemberAvatar member={m} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">
                {m.name}
                <span className="ml-1.5 text-xs font-normal text-stone-400">{m.relation}</span>
              </div>
              <div className="truncate text-xs text-stone-400">
                {[m.gender, m.birthDate, m.bloodType ? `血型${m.bloodType}` : '']
                  .filter(Boolean)
                  .join(' · ') || '点击完善信息'}
              </div>
            </div>
            <Pencil size={16} className="shrink-0 text-stone-300" />
          </button>
        ))}
        <button
          onClick={() => setEditing('new')}
          className="flex w-full items-center gap-2 border-t border-stone-100 p-3.5 text-sm font-medium text-teal-600 active:bg-stone-50"
        >
          <UserPlus size={16} /> 添加成员
        </button>
      </div>
      {editing && <MemberModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const [name, setName] = useState(member?.name ?? '')
  const [relation, setRelation] = useState(member?.relation ?? '本人')
  const [gender, setGender] = useState(member?.gender ?? '')
  const initBirth = (() => {
    const m = member?.birthDate?.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/)
    return { y: m?.[1] ?? '', mm: m?.[2] ?? '', d: m?.[3] ?? '' }
  })()
  const [birth, setBirth] = useState(initBirth)
  const setBirthPart = (k: 'y' | 'mm' | 'd', v: string, max: number) =>
    setBirth((b) => ({ ...b, [k]: v.replace(/\D/g, '').slice(0, max) }))
  const [bloodType, setBloodType] = useState(member?.bloodType ?? '')
  const [allergies, setAllergies] = useState(member?.allergies ?? '')
  const [notes, setNotes] = useState(member?.notes ?? '')
  const [busy, setBusy] = useState(false)

  const counts = useLiveQuery(async () => {
    const mid = member?.id
    if (!mid) return { docs: 0, visits: 0 }
    const [docs, visits] = await Promise.all([
      db.docs.where('memberId').equals(mid).count(),
      db.visits.where('memberId').equals(mid).count(),
    ])
    return { docs, visits }
  }, [member?.id])

  const save = async () => {
    if (!name.trim()) {
      toast('请填写姓名', 'err')
      return
    }
    setBusy(true)
    try {
      const by = birth.y.trim()
      let birthDate: string | undefined
      if (by) {
        if (by.length !== 4 || Number(by) < 1900 || Number(by) > 2100) {
          toast('出生年份需为 4 位数字（如 1981）', 'err')
          return
        }
        const bm = birth.mm ? String(Math.min(12, Math.max(1, Number(birth.mm)))).padStart(2, '0') : ''
        const bd = birth.d ? String(Math.min(31, Math.max(1, Number(birth.d)))).padStart(2, '0') : ''
        birthDate = bm ? (bd ? `${by}-${bm}-${bd}` : `${by}-${bm}`) : by
      } else if (birth.mm || birth.d) {
        toast('填写了月/日时，出生年份不能为空', 'err')
        return
      }
      const row: Member = {
        ...(member?.id ? { id: member.id } : {}),
        name: name.trim(),
        relation,
        gender: gender || undefined,
        birthDate,
        bloodType: bloodType || undefined,
        allergies: allergies.trim() || undefined,
        notes: notes.trim() || undefined,
        createdAt: member?.createdAt ?? Date.now(),
      }
      await db.members.put(row)
      toast('已保存')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!member?.id) return
    const c = counts ?? { docs: 0, visits: 0 }
    if (
      !confirm(
        `确定删除成员「${member.name}」吗？\n其名下 ${c.docs} 张单据、${c.visits} 条就诊记录及附件照片将一并删除，不可恢复。`,
      )
    )
      return
    setBusy(true)
    try {
      const mid = member.id
      const docs = await db.docs.where('memberId').equals(mid).toArray()
      const fileIds = docs.flatMap((d) => d.fileIds)
      await db.transaction('rw', [db.members, db.visits, db.docs, db.files], async () => {
        await db.files.bulkDelete(fileIds)
        await db.docs.where('memberId').equals(mid).delete()
        await db.visits.where('memberId').equals(mid).delete()
        await db.members.delete(mid)
      })
      toast('已删除')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={member ? '编辑成员' : '添加成员'} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="姓名 *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="如：张三" />
          </Field>
          <Field label="关系">
            <select className={inputCls} value={relation} onChange={(e) => setRelation(e.target.value)}>
              {RELATIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="性别">
            <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">未填</option>
              {GENDERS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
          <Field label="血型">
            <select className={inputCls} value={bloodType} onChange={(e) => setBloodType(e.target.value)}>
              <option value="">未填</option>
              {['A', 'B', 'AB', 'O', '不详'].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="出生日期（直接输入，月/日可不填）">
          <div className="flex items-center gap-1.5">
            <input
              inputMode="numeric"
              className={`${inputCls} w-20 px-2 text-center`}
              value={birth.y}
              placeholder="1990"
              onChange={(e) => setBirthPart('y', e.target.value, 4)}
            />
            <span className="text-sm text-stone-500">年</span>
            <input
              inputMode="numeric"
              className={`${inputCls} w-14 px-2 text-center`}
              value={birth.mm}
              placeholder="10"
              onChange={(e) => setBirthPart('mm', e.target.value, 2)}
            />
            <span className="text-sm text-stone-500">月</span>
            <input
              inputMode="numeric"
              className={`${inputCls} w-14 px-2 text-center`}
              value={birth.d}
              placeholder="30"
              onChange={(e) => setBirthPart('d', e.target.value, 2)}
            />
            <span className="text-sm text-stone-500">日</span>
          </div>
        </Field>
        <Field label="过敏史">
          <input
            className={inputCls}
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            placeholder="如：青霉素过敏"
          />
        </Field>
        <Field label="备注">
          <textarea
            className={`${inputCls} min-h-[4rem] resize-none`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="慢性病、既往史等"
          />
        </Field>
        <div className="flex gap-3 pt-1">
          {member && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-600 active:bg-rose-100"
            >
              删除
            </button>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white active:bg-teal-700 disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : '保存'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ---------- 安全（访问口令） ----------

function SecuritySection() {
  const security = useLiveQuery(() => getSetting<SecurityConfig | null>('security', null), [])
  const secure = isSecureEnough()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [oldPw, setOldPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'idle' | 'set' | 'change'>('idle')

  const create = async () => {
    if (pw1.length < 4) {
      toast('口令至少 4 位', 'err')
      return
    }
    if (pw1 !== pw2) {
      toast('两次输入不一致', 'err')
      return
    }
    setBusy(true)
    try {
      const salt = randomSalt()
      const hash = await hashPassword(pw1, salt, PBKDF2_ITERATIONS)
      await db.settings.put({
        key: 'security',
        value: { hash, salt, iterations: PBKDF2_ITERATIONS, autoLockMin: 5 },
      })
      toast('口令已开启，下次打开应用生效')
      setMode('idle')
      setPw1('')
      setPw2('')
    } finally {
      setBusy(false)
    }
  }

  const change = async () => {
    if (!security) return
    if (!(await verifyPassword(oldPw, security.salt, security.iterations, security.hash))) {
      toast('当前口令不正确', 'err')
      return
    }
    if (pw1.length < 4 || pw1 !== pw2) {
      toast('新口令至少 4 位且两次一致', 'err')
      return
    }
    setBusy(true)
    try {
      const salt = randomSalt()
      const hash = await hashPassword(pw1, salt, PBKDF2_ITERATIONS)
      await db.settings.put({
        key: 'security',
        value: { ...security, hash, salt, iterations: PBKDF2_ITERATIONS },
      })
      toast('口令已修改')
      setMode('idle')
      setOldPw('')
      setPw1('')
      setPw2('')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    if (!security) return
    if (!(await verifyPassword(oldPw, security.salt, security.iterations, security.hash))) {
      toast('当前口令不正确', 'err')
      return
    }
    await db.settings.delete('security')
    sessionStorage.removeItem('fha-unlocked')
    toast('口令已关闭')
  }

  const setAutoLock = async (min: number) => {
    if (!security) return
    await db.settings.put({ key: 'security', value: { ...security, autoLockMin: min } })
  }

  return (
    <section>
      <SectionTitle icon={<ShieldCheck size={16} />} title="安全" />
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        {!secure ? (
          <p className="text-sm leading-6 text-stone-500">
            访问口令需要安全环境（HTTPS 或 localhost）。通过 EdgeOne Pages 的 https 网址访问时可用。
          </p>
        ) : security === undefined ? null : security === null ? (
          mode === 'set' ? (
            <div className="space-y-3">
              <Field label="设置访问口令（至少 4 位）">
                <input type="password" className={inputCls} value={pw1} onChange={(e) => setPw1(e.target.value)} />
              </Field>
              <Field label="再输入一次">
                <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
              <div className="flex gap-3">
                <button onClick={() => setMode('idle')} className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm">
                  取消
                </button>
                <button
                  onClick={create}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  确认开启
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm leading-6 text-stone-500">
                开启后每次打开应用需输入口令，防止他人翻看本机档案数据。
              </p>
              <button
                onClick={() => setMode('set')}
                className="mt-3 flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white active:bg-teal-700"
              >
                <KeyRound size={16} /> 开启访问口令
              </button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {mode === 'change' ? (
              <div className="space-y-3">
                <Field label="当前口令">
                  <input type="password" className={inputCls} value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                </Field>
                <Field label="新口令">
                  <input type="password" className={inputCls} value={pw1} onChange={(e) => setPw1(e.target.value)} />
                </Field>
                <Field label="再输入一次新口令">
                  <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </Field>
                <div className="flex gap-3">
                  <button
                    onClick={() => setMode('idle')}
                    className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm"
                  >
                    取消
                  </button>
                  <button
                    onClick={change}
                    disabled={busy}
                    className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                  >
                    确认修改
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm">访问口令</span>
                  <span className="text-xs text-teal-700">已开启</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">无操作自动锁定</span>
                  <select
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm"
                    value={security.autoLockMin}
                    onChange={(e) => setAutoLock(Number(e.target.value))}
                  >
                    <option value={1}>1 分钟</option>
                    <option value={5}>5 分钟</option>
                    <option value={15}>15 分钟</option>
                    <option value={0}>不自动锁定</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setMode('change')}
                    className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm"
                  >
                    修改口令
                  </button>
                  <button
                    onClick={disable}
                    className="flex-1 rounded-xl bg-rose-50 py-2.5 text-sm font-medium text-rose-600 active:bg-rose-100"
                  >
                    关闭口令
                  </button>
                </div>
                <p className="text-xs leading-5 text-stone-400">
                  说明：口令用于防止随手翻看，不等于对数据加密。请务必定期备份。
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- AI 识别 ----------

function AiSection() {
  const cfg = useLiveQuery(() => getSetting<AiConfig>('aiConfig', DEFAULT_AI), [])
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (cfg && !loaded) {
      setApiKey(cfg.apiKey)
      setModel(cfg.model)
      setLoaded(true)
    }
  }, [cfg, loaded])

  if (!cfg) return null
  const current = { baseUrl: cfg.baseUrl, apiKey: apiKey.trim(), model: model.trim() || DEFAULT_AI.model }
  const configured = apiKey.trim().length > 0

  const save = async () => {
    await db.settings.put({ key: 'aiConfig', value: current })
    toast('已保存 AI 配置')
  }

  const test = async () => {
    if (!configured) {
      toast('请先填写 API Key', 'err')
      return
    }
    setBusy(true)
    setTestResult(null)
    try {
      const r = await testAiConnection(current)
      setTestResult({ ok: true, text: `连接正常，模型回复：${r.slice(0, 40)}` })
    } catch (e) {
      setTestResult({ ok: false, text: '连接失败：' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionTitle icon={<Sparkles size={16} />} title="AI 识别" />
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm leading-6 text-stone-500">
          配置后，上传单据照片可一键识别医院、日期、诊断、金额、药品、化验指标。
          识别时单据图片会发送给你配置的模型服务商；不配置则全部手动填写，数据不出设备。
        </p>
        <div className="text-xs text-stone-400">
          推荐使用智谱 GLM（国内直连、有免费额度）：
          <a
            href="https://open.bigmodel.cn"
            target="_blank"
            rel="noreferrer"
            className="text-teal-600 underline"
          >
            open.bigmodel.cn
          </a>{' '}
          注册 → API Keys → 复制黏贴到下方
        </div>
        <Field label="API Key">
          <input
            type="password"
            className={inputCls}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴你的 API Key（只保存在本设备）"
          />
        </Field>
        <Field label="模型">
          <input
            className={inputCls}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={DEFAULT_AI.model}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white active:bg-teal-700"
          >
            保存
          </button>
          <button
            onClick={test}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:bg-stone-100 disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            测试连接
          </button>
        </div>
        {testResult && (
          <p className={`text-xs leading-5 ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
            {testResult.text}
          </p>
        )}
        <p className="text-xs text-stone-400">
          状态：{configured ? '已配置' : '未配置'} · 模型：{current.model}
        </p>
      </div>
    </section>
  )
}

// ---------- 备份与恢复 ----------

function BackupSection() {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const lastBackupAt = useLiveQuery(() => getSetting<number | null>('lastBackupAt', null), [])
  const lastRestoreAt = useLiveQuery(() => getSetting<number | null>('lastRestoreAt', null), [])
  const [usage, setUsage] = useState<string | null>(null)

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage != null && setUsage(fmtSize(e.usage)))
      .catch(() => {})
  }, [])

  const doExport = async () => {
    setBusy('export')
    try {
      const filename = await exportBackup()
      toast(`已导出 ${filename}`)
    } catch (e) {
      console.error(e)
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (file: File) => {
    if (
      !confirm(
        '导入将【覆盖】当前设备上的全部数据（成员、就诊、单据、照片）。\n建议先导出一份当前数据再操作。确定继续吗？',
      )
    )
      return
    setBusy('import')
    try {
      const r = await importBackup(file)
      toast(`导入成功：${r.members} 位成员 / ${r.docs} 张单据`)
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      console.error(e)
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 'err')
      setBusy(null)
    }
  }

  return (
    <section>
      <SectionTitle icon={<Database size={16} />} title="备份与恢复" />
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm leading-6 text-stone-500">
          数据只存在本设备浏览器中，换手机、卸载浏览器或清理网站数据都会丢失。请养成每月导出备份、存到云盘或电脑的习惯。
        </p>
        <div className="text-xs text-stone-400">
          {usage && <div>本机数据量：{usage}</div>}
          {lastBackupAt != null && <div>上次备份：{fmtDateTime(lastBackupAt)}</div>}
          {lastRestoreAt != null && <div>上次恢复：{fmtDateTime(lastRestoreAt)}</div>}
        </div>
        <div className="flex gap-3">
          <button
            onClick={doExport}
            disabled={busy !== null}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white active:bg-teal-700 disabled:opacity-60"
          >
            {busy === 'export' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            导出备份
          </button>
          <label
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:bg-stone-100 ${
              busy !== null ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            导入恢复
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) doImport(f)
              }}
            />
          </label>
        </div>
      </div>
    </section>
  )
}

// ---------- 关于 ----------

function AboutSection() {
  const navigate = useNavigate()
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  /** 显示自检：生成一张测试单据并跳到详情页，验证"点图→全屏→缩放"链路 */
  const selfTest = async () => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 1200
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('画布不可用')
      const g = ctx.createLinearGradient(0, 0, 0, 1200)
      g.addColorStop(0, '#0d9488')
      g.addColorStop(1, '#1e40af')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 900, 1200)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 150px sans-serif'
      ctx.fillText('自检图 A', 450, 420)
      ctx.font = 'bold 80px sans-serif'
      ctx.fillText(new Date().toLocaleTimeString(), 450, 560)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
      if (!blob) throw new Error('生成图片失败')
      let member = (await db.members.toArray()).find((x) => x.name === '自检成员')
      if (!member) {
        member = { name: '自检成员', relation: '其他', createdAt: Date.now() }
        member.id = await db.members.add(member)
      }
      const fid = newId()
      await db.files.add({
        id: fid,
        name: `自检${Date.now()}.jpg`,
        mime: 'image/jpeg',
        size: blob.size,
        data: await blobToArrayBuffer(blob),
        createdAt: Date.now(),
      })
      const now = Date.now()
      const docId = await db.docs.put({
        memberId: member.id!,
        category: '检查报告',
        title: `显示自检 ${new Date().toLocaleTimeString()}`,
        docDate: today(),
        fileIds: [fid],
        createdAt: now,
        updatedAt: now,
      })
      navigate(`/docs/${docId}`)
    } catch (e) {
      toast('自检失败：' + (e instanceof Error ? e.message : String(e)), 'err')
    }
  }

  return (
    <section>
      <SectionTitle icon={<Info size={16} />} title="关于" />
      <div className="space-y-2 rounded-2xl bg-white p-4 text-sm leading-6 text-stone-500 shadow-sm">
        <div>家庭健康档案 {APP_VERSION}</div>
        <div>
          数据与隐私：全部数据仅保存在本设备浏览器（IndexedDB）中，应用无服务器、无账号。后续 AI
          识别功能仅在识别时将单据图片发送给所配置的模型服务。
        </div>
        {isIOS && !isStandalone && (
          <div className="rounded-xl bg-amber-50 p-3 text-amber-700">
            iPhone 用户请注意：请用 Safari 打开本应用 → 分享 →「添加到主屏幕」，从主屏幕图标使用。普通标签页模式下，
            Safari 可能在 7 天未使用后清除数据。
          </div>
        )}
        <div className="pt-1 text-xs text-stone-400">
          后续版本：AI 识别入库 → 用药/复诊提醒 → 花费与指标分析 → 自然语言问答
        </div>
        <button
          onClick={selfTest}
          className="mt-1 w-full rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:bg-stone-100"
        >
          显示自检：创建测试单据并打开
        </button>
      </div>
    </section>
  )
}

// ---------- 公共小组件 ----------

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 px-1 text-[15px] font-semibold">
      <span className="text-teal-600">{icon}</span>
      {title}
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  // Portal 挂到 body：规避老内核浏览器对滚动容器内 fixed 定位的 bug
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="safe-bottom max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[16px] font-semibold">{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
