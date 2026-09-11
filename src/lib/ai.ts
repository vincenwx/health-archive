// 视觉大模型单据识别客户端（OpenAI 兼容接口，默认智谱 GLM）
import dayjs from 'dayjs'
import { db, fileBlob, ALL_CATEGORIES, type DocCategory, type LabIndicator, type MedItem } from '../db'
import { toAiImage } from './image'

/** 单次送给模型解读的图片上限 */
export const MAX_INTERPRET_IMAGES = 20

/** 收集一批附件里的图片并转为 data URL（跳过 PDF 等非图片；先压缩控制请求体积） */
export async function collectImageDataUrls(fileIds: string[], cap = MAX_INTERPRET_IMAGES): Promise<string[]> {
  const out: string[] = []
  for (const fid of fileIds) {
    if (out.length >= cap) break
    const f = await db.files.get(fid)
    if (f && f.mime.startsWith('image/')) out.push(await blobToDataUrl(await toAiImage(fileBlob(f))))
  }
  return out
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export const DEFAULT_AI: AiConfig = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: '',
  model: 'glm-5.3-flash',
}

export interface ExtractResult {
  docName?: string // 单据简短名称（用于文件命名）
  patientName?: string // 单据上的患者姓名（用于匹配成员）
  category?: DocCategory
  docDate?: string
  hospital?: string
  department?: string
  doctor?: string
  diagnosis?: string
  amountTotal?: number
  amountSelfPaid?: number
  note?: string
  medications?: MedItem[]
  indicators?: LabIndicator[]
}

const CATEGORY_LIST = ALL_CATEGORIES.join('、')

const SYSTEM_PROMPT = `你是医疗单据信息提取助手。请从用户提供的医疗单据图片中提取结构化信息，严格输出 JSON，不要输出任何其他文字，不要用 markdown 代码块。字段定义：
{
  "docName": "这张单据的简短名称，3-8个字，按内容起名（如：门诊病历、B超报告、化验报告、处方、发票、出院小结）",
  "patientName": "单据上显示的患者姓名",
  "category": "单据类型，只能取：${CATEGORY_LIST}",
  "docDate": "单据日期，格式 YYYY-MM-DD；年份缺失时根据内容推断，无法推断则省略",
  "hospital": "医院名称",
  "department": "科室",
  "doctor": "医生姓名",
  "diagnosis": "诊断或结论",
  "amountTotal": "总金额，纯数字（元）",
  "amountSelfPaid": "自付金额，纯数字（元），无法区分则省略",
  "note": "医嘱或注意事项的简要文字",
  "medications": [{"name":"药名","dosage":"每次剂量如 0.5g","frequency":"如 每日3次","timing":"如 饭后","duration":"如 7天"}],
  "indicators": [{"name":"指标名如 空腹血糖","value":"数值","unit":"单位","reference":"参考区间","flag":"偏高/偏低/正常"}]
}
规则：
1. 单据中没有的信息直接省略该字段，不要编造。
2. 图片可能是多页单据中的一页（如病历、报告、发票各一张），只提取当前这张图片上的内容。
3. medications 只在处方、用药指导中提取；indicators 只在化验单中提取。
4. 金额去掉货币符号和千分位，只保留数字。
5. 只输出 JSON 本身。`

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function chatCompletion(
  cfg: AiConfig,
  messages: unknown[],
  maxTokens?: number,
  thinkingDisabled = false,
): Promise<string> {
  if (!cfg.apiKey) throw new Error('未配置 API Key')
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const buildBody = (withThinking: boolean) =>
    JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.1,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(withThinking ? { thinking: { type: 'disabled' } } : {}),
    })
  const send = (body: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body,
    })

  let res: Response
  try {
    res = await send(buildBody(thinkingDisabled))
  } catch {
    throw new Error('网络请求失败（请检查网络或接口地址是否支持浏览器直连）')
  }
  // 个别模型不认识 thinking 参数时自动去掉重试
  if (!res.ok && res.status === 400 && thinkingDisabled) {
    try {
      res = await send(buildBody(false))
    } catch {
      throw new Error('网络请求失败（请检查网络或接口地址是否支持浏览器直连）')
    }
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    let msg = `接口返回 ${res.status}`
    try {
      const j = JSON.parse(t) as { error?: { message?: string } }
      msg += `：${j?.error?.message ?? t.slice(0, 160)}`
    } catch {
      if (t) msg += `：${t.slice(0, 160)}`
    }
    throw new Error(msg)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('模型未返回内容')
  return content
}

export async function recognizeDocument(cfg: AiConfig, imageDataUrl: string): Promise<ExtractResult> {
  const text = await chatCompletion(cfg, [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageDataUrl } },
        { type: 'text', text: '请提取这张医疗单据的信息。' },
      ],
    },
  ])
  return parseExtract(text)
}

export async function testAiConnection(cfg: AiConfig): Promise<string> {
  return chatCompletion(cfg, [{ role: 'user', content: '请只回复两个字：正常' }], 200)
}

const INTERPRET_SYSTEM = `你是面向普通家庭的就医解读与整理助手。用户会提供一张或多张医疗单据图片（如医生病历、检查/检验报告、处方、发票等）以及已提取的结构化信息。请完成两件事：一是把所有单据的内容【归纳整理】成一份条理清晰的总结；二是基于整理结果【给出具体建议】。要求：
1. 必须覆盖全部图片和单据，不得遗漏；医生病历中的主诉、诊断、医嘱要与检查报告的结论相互印证、结合起来讲（如"因为诊断XX所以做了XX检查、开了XX药"）。
2. 用大白话，术语出现时用括号一句话解释；单据上没有的信息明确写"单据上未显示"，绝不编造。
3. 按以下结构分段输出（某段没内容就整段省略，不要硬凑）：
【本次就医概览】时间、医院、科室、医生、就诊原因，一两句
【诊断与检查】医生诊断；各项检查/化验的关键结果归纳，异常项对比参考区间并用白话解释含义
【用药方案】每种药治什么、怎么吃、常见的注意点
【医嘱与注意事项】医生交代的内容整理；需要警惕的情况
【总结与建议】这是全文重点，最后写但绝不能简写。先用两三句综合评价这次就医的情况与整体状态；然后逐条列出具体建议（每条以"·"开头），必须包含：
· 复诊/复查：是否需要、建议时间、重点复查什么项目
· 用药：依从要点、出现什么情况需要咨询医生调整
· 生活：结合诊断给出的饮食、运动、作息建议
· 下次就医：建议携带的材料、应主动向医生说明的信息
本段不少于 150 字。
4. 各段篇幅要均衡，不要前详后略，尤其不得省略或压缩【总结与建议】。
5. 不要罗列与解读无关的原始数据。
6. 结尾固定单独一行：「以上为 AI 归纳整理，仅供参考，请以医生意见为准。」
7. 全文控制在 1200 字以内。
8. 直接输出解读正文本身：不要 JSON、不要代码块、不要"interpretation"等字段名、不要任何开场白或收尾说明。段落之间空一行。`

/** 生成单据的大白话解读（多页单据把所有图片一起发给模型综合解读） */
export async function interpretDocument(
  cfg: AiConfig,
  imageDataUrls: string[],
  structuredInfo: string,
): Promise<string> {
  const content: unknown[] = imageDataUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }))
  content.push({
    type: 'text',
    text: `共 ${imageDataUrls.length} 张单据图片，可能包含病历、报告等不同页面，请全部覆盖、综合解读。\n已提取的单据信息：\n${
      structuredInfo || '（无，请仅依据图片）'
    }`,
  })
  const text = await chatCompletion(
    cfg,
    [
      { role: 'system', content: INTERPRET_SYSTEM },
      { role: 'user', content },
    ],
    6000,
    true, // 关闭深度思考：正文额度不被推理占用，归纳整理任务也不需要
  )
  return parseInterpretation(text)
}

/** 清洗解读输出：剥掉可能的代码块/字段名/引号包装，把字面 \n 转成真实换行 */
function parseInterpretation(text: string): string {
  let s = text.trim()
  const fenced = s.match(/```(?:json|markdown)?\s*([\s\S]*?)```/)
  if (fenced) s = fenced[1].trim()
  const brace = s.match(/\{[\s\S]*\}/)
  if (brace) {
    try {
      const raw = JSON.parse(brace[0]) as { interpretation?: unknown }
      const out = typeof raw.interpretation === 'string' ? raw.interpretation.trim() : ''
      if (out) s = out
    } catch {
      /* 解析失败就按原文清洗 */
    }
  }
  // 模型偶尔输出 "interpretation: ..." 的松散格式
  s = s.replace(/^\s*"?interpretation"?\s*[:：]?\s*/i, '')
  s = s.replace(/^["'`](.*)["'`]$/s, '$1').trim()
  // 字面 \n 转真实换行（未按 JSON 输出时的兜底）
  if (!s.includes('\n')) s = s.replace(/\\n/g, '\n')
  return s.trim()
}

export interface IndicatorRow {
  date: string
  value: number
  unit?: string
  reference?: string
  flag?: string
}

const INDICATOR_SYSTEM = `你是健康指标分析助手，面向普通家庭用户。用户会提供某一项健康指标（如空腹血糖、糖化血红蛋白、低密度脂蛋白胆固醇）的历次检测记录。请输出一份通俗易懂的分析：
【趋势判断】结合首末数值和中间变化，判断整体趋势（上升/下降/平稳/波动），引用具体日期和数值
【当前状态】最新数值相对参考区间的位置（正常/略高/偏高/略低/偏低），用白话解释这个指标反映什么、当前水平可能意味着什么
【建议】分点列出（每条以"·"开头）：
· 复查：是否需要复查、建议多久后、复查前注意事项（如需空腹）
· 生活：结合该指标的饮食、运动、作息建议
· 就医：出现什么情况应当及时就医
要求：只基于提供的记录分析，不编造；只有一次记录时重点讲当前状态与复查建议；结尾固定单独一行「以上为 AI 分析，仅供参考，请以医生意见为准。」；全文 500 字以内；直接输出分析正文，不要 JSON、不要代码块、不要开场白，段落间空一行。`

/** 指标趋势 AI 分析（纯文本输出） */
export async function analyzeIndicator(
  cfg: AiConfig,
  memberName: string,
  indicatorName: string,
  rows: IndicatorRow[],
): Promise<string> {
  const lines = rows.map(
    (r) => `${r.date}  ${r.value}${r.unit ?? ''}  参考:${r.reference ?? '未显示'}${r.flag ? `  [${r.flag}]` : ''}`,
  )
  const text = await chatCompletion(
    cfg,
    [
      { role: 'system', content: INDICATOR_SYSTEM },
      {
        role: 'user',
        content: `成员：${memberName}\n指标：${indicatorName}\n历次记录（从早到晚）：\n${lines.join('\n')}\n\n请按系统要求分析。`,
      },
    ],
    4000,
    true,
  )
  return parseInterpretation(text)
}

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s && s !== 'null' ? s : undefined
}

function parseDate(v: unknown): string | undefined {
  const s = pickString(v)
  if (!s) return undefined
  const m = s.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/)
  if (m) {
    const d = dayjs(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : undefined
}

function parseNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = pickString(v)
  if (!s) return undefined
  const n = Number(s.replace(/[,，¥￥元\s]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function mapCategory(v: unknown): DocCategory | undefined {
  const s = pickString(v)
  if (!s) return undefined
  if ((ALL_CATEGORIES as string[]).includes(s)) return s as DocCategory
  return ALL_CATEGORIES.find((c) => s.includes(c) || c.includes(s))
}

export function parseExtract(text: string): ExtractResult {
  let s = text.trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) s = fenced[1].trim()
  const brace = s.match(/\{[\s\S]*\}/)
  if (brace) s = brace[0]
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(s) as Record<string, unknown>
  } catch {
    throw new Error('模型返回的不是有效 JSON，请重试或更换模型')
  }
  const out: ExtractResult = {
    docName: pickString(raw.docName),
    patientName: pickString(raw.patientName),
    category: mapCategory(raw.category),
    docDate: parseDate(raw.docDate),
    hospital: pickString(raw.hospital),
    department: pickString(raw.department),
    doctor: pickString(raw.doctor),
    diagnosis: pickString(raw.diagnosis),
    amountTotal: parseNum(raw.amountTotal),
    amountSelfPaid: parseNum(raw.amountSelfPaid),
    note: pickString(raw.note),
  }
  if (Array.isArray(raw.medications)) {
    out.medications = (raw.medications as Record<string, unknown>[])
      .map((m) => ({
        name: pickString(m.name) ?? '',
        dosage: pickString(m.dosage),
        frequency: pickString(m.frequency),
        timing: pickString(m.timing),
        duration: pickString(m.duration),
      }))
      .filter((m) => m.name)
  }
  if (Array.isArray(raw.indicators)) {
    out.indicators = (raw.indicators as Record<string, unknown>[])
      .map((i) => ({
        name: pickString(i.name) ?? '',
        value: pickString(i.value),
        unit: pickString(i.unit),
        reference: pickString(i.reference),
        flag: pickString(i.flag),
      }))
      .filter((i) => i.name)
  }
  return out
}
