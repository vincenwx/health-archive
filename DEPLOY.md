# 部署说明

应用是纯静态 PWA，`npm run build` 的产物 `dist/` 即可部署到任意静态托管。

## 现行方案：GitHub Pages（已上线）

- 仓库：`vincenwx/health-archive`（公开仓库）
- `main` 分支：源码；`gh-pages` 分支：构建产物（Pages 来源分支）
- **正式地址**：https://vincenwx.github.io/health-archive/

### 更新流程

```bash
npm run build
cd dist
git add -A && git commit -m "deploy" && git push origin gh-pages --force
```

GitHub Pages 构建约 1 分钟生效；已安装的 PWA 会在下次打开时自动更新（必要时刷新一次）。

### 手机安装

浏览器（建议 Edge）打开正式地址 → 菜单 →「添加到主屏幕」→ 从图标使用。**地址必须带 `/health-archive/` 路径**——从正确打开的页面上添加即可（PWA 清单已按相对路径配置）。

## 备选方案

- **腾讯 EdgeOne Pages**（国内 CDN，免费）：国内访问速度更好，但默认 `edgeone.cool` 域名带令牌保护（需定期重新复制阅览地址）；要无令牌的固定域名需自定义域名 + ICP 备案。此前已部署过：`health-archive-ojutbwix.edgeone.cool`
- **自定义域名**：在 GitHub Pages（Settings → Pages → Custom domain）或 EdgeOne 绑定自有域名；EdgeOne 国内节点需 ICP 备案
- **本地运行**：`npm run build && npm run preview`，电脑访问 `http://localhost:4173`（仅临时调试用，HTTP 环境下口令/PWA 受限）

## 注意

- 每台设备的数据相互独立；换设备/换域名用「导出备份 → 导入恢复」迁移
- 版本更新后如页面无变化，刷新一至两次即可（离线缓存切换）
