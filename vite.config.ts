import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // 相对路径 base：兼容 GitHub Pages 子路径（/health-archive/）部署
  base: './',
  build: {
    // 兼容较旧的手机浏览器内核（如 iOS 15、旧版鸿蒙浏览器）
    target: 'es2018',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: '家庭健康档案',
        short_name: '健康档案',
        description: '家庭医疗单据的存储、查询、分析与提醒',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#0d9488',
        theme_color: '#0d9488',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
