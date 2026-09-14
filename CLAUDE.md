# CLAUDE.md — 家庭健康档案 项目记忆

> 任何 AI 会话进入本项目时先读本文件。最后更新：2026-09-14（v1.0.0 交付）

## 项目概述

家庭医疗单据的存储、查询、AI 解读与提醒。**纯前端 PWA，无后端无账号**：数据（含照片）全部存在各设备浏览器的 IndexedDB（Dexie），多设备靠备份文件迁移。

- **线上地址**：https://vincenwx.github.io/health-archive/
- **仓库**：github.com/vincenwx/health-archive（公开，`main`=源码，`gh-pages`=构建产物）
- 用户设备：iPhone + 华为 Mate60 Pro（鸿蒙）；全家多成员共用理念

## 技术栈与架构

- Vite 7 + React 19 + TypeScript(strict) + **Tailwind CSS 3.4**（勿升 v4！v4 的 @layer/oklch 会让老内核手机整表样式丢失）+ Dexie 4 + dexie-react-hooks + fflate + vite-plugin-pwa
- 构建 target **es2018**（老内核兼容）；`base: './'` 相对路径（兼容 GitHub Pages 子路径）
- 路由用 **HashRouter**；全屏层/弹窗一律 **createPortal 挂 body**（老内核滚动容器内 fixed 定位有 bug）
- 所有资源引用用**相对路径**（./icons/... ./manifest.webmanifest，PWA start_url:'.' scope:'./'）
- 文件附件存 **ArrayBuffer 而非 Blob**（老 Safari/WebView 不支持 IDB 存 Blob），读取兼容旧 blob 字段
- AI 集成：`src/lib/ai.ts`，OpenAI 兼容接口直连（默认智谱 `glm-5.3-flash`），Key 存本地 settings。识别/解读/分析/问答全在此文件
- Dexie schema 在 `src/db.ts`（v2 含提醒中心三表）；APP_VERSION 常量也在 db.ts

## 关键目录

- `src/db.ts` 数据层+类型（成员/就诊/单据/附件/用药计划/提醒/打卡）
- `src/lib/`：ai.ts(识别/解读/指标分析) · ask.ts(问答上下文) · backup.ts(备份/自动备份) · ics.ts(日历导出) · medParse.ts(用药解析) · visitMatching.ts(自动归就诊) · image.ts(压缩) · crypto.ts(口令)
- `src/pages/`：Home/Documents/DocForm/DocDetail/Visits/VisitForm/VisitDetail/Reminders/MedPlanForm/ReminderForm/Stats/Ask/Settings/LockScreen
- `scripts/gen-icons.mjs` 纯Node生成PWA图标；`scripts/gen-test-image.mjs` 测试图

## 常用命令

```bash
npm run build   # tsc -b && vite build（构建必须通过严格TS检查）
npm run dev / preview
```

## 部署流程（GitHub Pages）

1. `npm run build`
2. `cd dist && git add -A && git commit -m "deploy" && git push origin gh-pages --force`（dist 是独立 git 仓库，remote 指向 health-archive 仓库的 gh-pages 分支）
3. 源码改动提交并推送 main 分支
4. 线上约 1 分钟生效；**注意 npm 管道失败时 `| tail` 会吞退出码**，部署脚本里要先判断构建是否成功

## 历史教训（勿重蹈）

- **绝对不要**给交互元素加 `onTouchEnd` 双通道触发——Chrome Android 会吞合成点击（曾导致图片点不开）
- 输入框隐藏用移屏方式（left:-9999px），不用 display:none（旧内核不触发 change）
- LLM 输出**避免 JSON 格式**用于展示文本（解读/分析用纯文本+【段落】结构）；识别等结构化提取仍用 JSON 但解析要有兜底
- max_tokens 会包含思考 token：GLM-5 系列**解读类任务传 `thinking:{type:'disabled'}`** 并放宽 max_tokens，否则正文被截断（chatCompletion 已支持自动重试兜底）
- 发给 AI 的图片先压到 1280px（`toAiImage`），控制请求体积
- PWA/清单/图标引用全部相对路径；全屏层必须 Portal；构建产物禁止出现 `src="/..."` 绝对引用
- 项目的 CLAUDE.md、README.md、DEPLOY.md 在版本发布时同步更新

## 尚未做/可选

- WebDAV 云盘自动备份（评估后延后）
- 指标手动合并/改名（同名不同叫法拆曲线时）
- 化验定性结果（阴性/阳性）展示与趋势
