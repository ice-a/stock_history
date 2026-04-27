# 单标的收益动画面板（Vue3 + Element Plus）

输入股票代码或基金代码、买入日期、买入数量，即可计算到最新估值日的终值与收益率，并以动画形式展示价格走势。

## 功能

1. 支持股票（A/HK/US）与基金（FUND）两类
2. 输入最简：代码 + 日期 + 数量
3. 动画加载价格曲线（速度较慢，动画中显示当前价格）
4. 显示终值、买入价/当前价、收益率
5. 分享能力：复制文案、下载卡片、系统分享

## 技术栈

- Vue 3
- Vite
- Element Plus
- ECharts

## 本地开发

```bash
npm install
npm run dev
```

默认会启动 Vite 开发服务（通常是 `http://localhost:5173`）。

## 生产部署

```bash
npm run build
```

构建产物位于 `dist/`，可部署到 Nginx、静态托管（如 Vercel、Netlify）或任意静态服务器。
