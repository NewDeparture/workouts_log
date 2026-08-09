# RUN.LOG 设计借鉴与前端重构计划

**Date:** 2026-08-08
**来源参考网站：** https://run.731558.xyz:6881 （下文以「目标网站」指代）
**Scope:** 前端 UI 重构与组件扩展，Python 数据同步脚本不动。
**目标：** 把目标网站的视觉语言、交互范式融入本项目，保留本项目已有的双栏布局、状态联动、`--color-accent` 等架构资产。

---

## 0. 分析方法与产物

目标网站分析经过**两轮**，结果完全一致：

**第一轮（2026-08-08，agent-browser）**：使用 `agent-browser`（vercel-labs CLI + 自装 Chromium 151）远程调试式浏览 5 个路由（`/`、`/routes`、`/heatmap`、`/running_life`、`/mls`），抓取：
- 11 张页面截图（含全屏 `--full`）
- HTML 源（关键节点 + className）
- 计算样式（背景色、字体、柱状图 fill）
- 路由表（`<a href>`）
- 关键 className token（热力图配色、轨迹缩略图 stroke 等）

**第二轮（2026-08-08，Web Access skill / CDP 复用本机 Chrome）**：使用 IDE 的 `Web Access（浏览器自动化）` skill 通过 CDP 直连用户本机 Chrome（port 9222），重新分析首页/热力图/奔跑人生/赛事记录 4 页，结果与第一轮逐项吻合（配色 token、路由、字体、赛事数据、PB 徽章数等全部一致）。CDP 方式**带用户登录态、零额外浏览器安装**，为后续访问目标网站的首选方式。

**第三轮（2026-08-08，完整长截图）**：发现第二轮截图受 framer-motion 入场动画影响出现半透明/空白，通过 CDP 注入 CSS 禁用动画（`*{animation:none!important;transition:none!important;opacity:1!important;transform:none!important}`）后，用 `Page.captureScreenshot + captureBeyondViewport` 抓取 **5 个路由的完整长截图**，均验证尺寸/大小正常（非空白）。这也是当前**唯一存档的视觉对照基准**。

**临时分析产物（不入仓库，第一、二轮已清理）**：
```
# 第一轮（agent-browser）—— 已删除（清理时移除）
.codebuddy/analysis/run-log-2026-08-08/   # 12 张截图 + 2 个 probe.js

# 第二轮（CDP，动画中间帧不完整）—— 已删除
.codebuddy/analysis/run-log-cdp-2026-08-08/

# 第三轮（CDP 完整长截图）—— 保留，视觉对照基准
.codebuddy/analysis/run-log-cdp-v2-2026-08-08/
├── 01-homepage.png         首页（hero 卡 + 地图 + Activity Log + 日历 + 月图）
├── 02-tracks-wall.png      轨迹墙（摘要 + SVG 缩略图网格 + 统计）
├── 03-heatmap.png          热力图（多年并列纵向周历 + 统计）
├── 04-running-life.png     奔跑人生（hero + 月份网格 + 图例）
└── 05-marathon-life.png    赛事记录（Hero + 年度分组卡片 + PB 徽章）
```
> 分析截图可随时用 CDP 重新抓取（见 §11「再次访问目标网站的流程」），不依赖本归档。

---

## 1. 目标网站现状摘要

### 1.1 技术栈（从产物反推）

| 层 | 选型 | 证据 |
|---|---|---|
| 框架 | React 18 + Vite | `<div id="root">`、SPA 路由 |
| 样式 | Tailwind CSS | `bg-zinc-900`、`max-w-7xl`、`grid-cols-3` 等原子类 |
| 图表 | Recharts | `class="recharts-bar-rectangle"` 月度柱状图 |
| 地图 | Mapbox GL JS | `<button>Mapbox logo</button>` 控件 |
| 动画 | **自研 + IntersectionObserver**（非 framer-motion） | 入场内联 `opacity: 0; transform: translateY(20/40px) translateZ(0px)`；`index-*.js` bundle 无任何 framer/motion 字符串；后台 tab 动画被浏览器节能冻结证实依赖 IO 运行时触发 |
| 路由 | React Router（history） | 5 条 `<a href="/routes">`，`data-discover` 标识 |
| 字体 | Inter | `getComputedStyle(body).fontFamily = 'Inter, system-ui, ...'` |
| 图标 | lucide-react | `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">` |

### 1.2 路由结构

```
/             首页        Hero 卡 + Activity Log + 地图 + 日历 + 月图
/routes       轨迹墙      左侧摘要 + 右侧缩略图网格（每年）
/heatmap      热力图      多年并列纵向周历 + 统计
/running_life 奔跑人生    Hero + 人生月份网格 + 图例
/mls          赛事记录    Hero + 年度分组 + 赛事卡片
```

### 1.3 设计语言（关键 token）

| 维度 | 目标网站值 | 本项目现状 | 借鉴建议 |
|---|---|---|---|
| 主色（强调） | `#E31937`（跑步红） | `--color-accent` 动态：all→purple / Run→orange / Ride→blue | 不直接套用，但可让 `--color-accent` 默认值更接近"橙红"，并允许单运动专属强调色 |
| 背景 | `bg-black`（纯黑）+ `zinc-900` 卡片 | `#0d1117` 深灰 + `#161b22` 卡片（亮/暗双模式） | 保留双模式，但暗黑模式下用纯黑 (`#000`)+ `zinc-900` 更接近目标网站 |
| 卡片边框 | `border-zinc-800` | `border-[var(--color-border)]` (#30363d) | 把深色主题下边框调暗到 `zinc-800` (`#27272a`) |
| 字体 | Inter | 系统默认 sans + mono 数字 | 引入 Inter（含 system-ui 回退）作为首选英文字体；中文回退到思源黑/PingFang |
| 圆角 | `rounded-2xl` | `rounded-xl` | 把卡片圆角从 `xl` 提到 `2xl` |
| 间距 | 8px grid（`gap-4/gap-6/gap-8`） | 4px grid | 沿用 8px（`gap-6`/`gap-8`）做主间距 |

### 1.4 各页面核心组件清单

| 页面 | 组件 | 借鉴价值 |
|---|---|---|
| 首页 | 4 张 hero 卡（Total / Yearly Goal / Monthly Goal / Marathon Events + Latest Finish） | ★★★ 把"马拉松数+最近一场赛事"做成 hero 第 4 卡 |
| 首页 | Mapbox + Activity Log 行点选联动（点击行 → 地图自动 fitBounds） | ★★★ 这是目标网站最优雅的交互，本项目 `selectedActivity` 已经共享，**只需在 `RouteMap` 里补 `flyTo` 行为即可** |
| 首页 | 日历组件：`MM/YYYY · total km` + 左右翻月 + Calendar/Route 视图切换 + 复制 URL | ★★★ 当前 `CalendarWidget` 仅展示，无切换/复制/联动 |
| 首页 | 月度距离柱状图（Recharts，单色 `#3f3f46`） | ★★ 当前 `MonthlyChart` 已用 Recharts，但配色更花；可改为单色或跟随 `--color-accent` |
| 轨迹墙 | SVG 缩略图网格（`viewBox 0 0 100`，stroke 3，stroke-linecap round），特殊距离高亮（>20km 黄 / >40km 红） | ★★★ 本项目已有 `TracksPage` + `ActivityList`，但 polyline 是 React 元素（开销大）；目标网站是纯 SVG path，预渲染可显著降本 |
| 轨迹墙 | "ZITONE'S RUN 2026" 角标 + 底部 Statistics + Special Tracks 图例 | ★★ 复用 `HeroStats` 的汇总数据，加图例条 |
| 热力图 | 多年并列纵向周历（每年一张大图，X=周，Y=周一到周日，月份分隔），左右圆形按钮切换更早年份 | ★★★ **本项目当前热力图是 GitHub 横版（53 列 × 7 行），目标网站是按年纵向（7 行 × N 列）**。本项目的 `ContributionHeatmap` 可以新增"年历模式"（与现有 GitHub 模式并存，由用户切换） |
| 奔跑人生 | Hero + 大月份网格（约 33×30 格，每格 = 一个月） + 图例（<100km / 100-200 / 200-300 / >300） | ★★ 新增页面 `/life-months`，复用 `useFilteredActivities` 计算每月总量；视觉冲击力大，可作为「人生总览」使用 |
| 赛事记录 | Hero（"奔跑 MARATHON LIFE" 双层排版） + 按年度分组 + 2 列卡片 + 红 PB 徽章 | ★★ 本项目 `PersonalBest` 是单卡式，扩展为「赛事库」需要新增数据源（赛事非普通活动，需识别 race 类型或独立录入） |

---

## 2. 本项目现状 vs 目标网站

### 2.1 当前架构（不破坏，只增强）

```
App.tsx
├─ LocaleProvider（中文/英文）
├─ GitHubAuthProvider
├─ Header（运动筛选 / 主题 / 语言 / 路由 tabs）
├─ 首页（home）
│   ├─ StatsCards（6 张卡：总距离 / 总次数 / 总时间 / 最长 / 最佳配速 / 连续天数）
│   ├─ ContributionHeatmap（GitHub 风格，单年显示）
│   ├─ ActivityLog（分页表格 + 行点选 → selectedActivity）
│   ├─ ProfileCard（全部数据，不受 filter 影响）
│   ├─ ChinaMap（高德省份）
│   ├─ RouteMap（Mapbox + selectedActivity 联动，已有）
│   ├─ PersonalBest（5K/10K/半马/全马）
│   └─ CalendarWidget（月度日历）
├─ /tracks（TracksPage，懒加载，ActivityList 风格）
└─ /life（LifePage，懒加载，"奔跑人生" 初步）
```

**已有可复用资产：**
- `selectedActivity` 已在 `App.tsx` 状态层共享 → **只需在 `RouteMap` 加 `flyTo` 行为**即可实现目标网站的「点行缩放地图」
- `useFilteredActivities` 已支持 `filter + year` → 月度距离、年度统计、年历热力图可直接复用
- `HeatmapPage` 已经是独立路由 → 新增的「年历模式」可作为 `HeatmapPage` 的子模式
- `LifePage` 已经存在 → 「奔跑人生」页面可直接落地
- `--color-accent` + `<html data-filter>` 已驱动全局强调色 → 借鉴的组件只读这个 CSS 变量即可跟随主题

### 2.2 待新增/改造点

| # | 改造 | 优先级 | 关联文件 |
|---|---|---|---|
| 1 | `RouteMap` 接入 `flyTo`：监听 `selectedActivity` 变化 → `map.flyTo({ center, zoom: 13 })` + 自动 fit polyline | P0 | `src/components/RouteMap.tsx` |
| 2 | 首页 hero 第 4 张卡：马拉松数 + 最近一场赛事预览（缩略路线 + 赛事名 + 日期 + 完赛时间） | P0 | `src/components/StatsCards.tsx`（或新增 `MarathonCard.tsx`） |
| 3 | 日历组件升级：左右翻月 + "Calendar / Route" 视图切换 + 复制 URL + 联动 `selectedActivity` | P1 | `src/components/CalendarWidget.tsx` |
| 4 | `ContributionHeatmap` 新增「年历模式」：纵向 7 行 × N 列（每年），多年度并列 | P1 | `src/components/ContributionHeatmap.tsx`、`HeatmapPage.tsx` |
| 5 | 新增 `TrackThumb.tsx`：纯 SVG `<path>` 渲染 polyline（不要走 Mapbox），支持 `stroke`/`stroke-width` prop；远距离用红色、中距离用黄色、其余灰色 | P0 | `src/components/TrackThumb.tsx`（新文件） |
| 6 | `TracksPage` 用 `TrackThumb` 重写缩略图列表（替换现有 React 渲染的 polyline） | P1 | `src/components/TracksPage.tsx` |
| 7 | 新增 `/life-months`：「奔跑人生」页面，月份网格 + 图例 | P2 | `src/components/LifeMonthsPage.tsx`（懒加载） |
| 8 | 新增赛事记录入口 `/mls`：按年度分组的赛事卡片 + PB 徽章；先复用 `PersonalBest` 数据，后续可独立数据源 | P2 | `src/components/MarathonLifePage.tsx`（懒加载） |
| 9 | 设计 token 微调：暗黑模式背景 `#000`、卡片 `zinc-900`、边框 `zinc-800`、圆角 `2xl`；新增 Inter 字体 | P1 | `src/index.css`、`index.html` |
| 10 | 入场动画：从「无动画」改为 framer-motion 风格的 fade+slide（`opacity 0→1 + translateY(20px)→0`），通过 CSS keyframes 注入避免新增依赖 | P2 | `src/components/*` 通用 `<FadeSlide>` 包装 |

---

## 3. 详细落地设计

### 3.1 `RouteMap` 接入 flyTo（P0）

**当前问题：** 本项目 `RouteMap` 已经接收 `selectedActivity` prop，但只是高亮选中活动的 polyline，**不会自动缩放/居中**。目标网站在点 Activity Log 行后，地图会立即缩放到该路线。

**实现要点：**
```ts
// src/components/RouteMap.tsx
import { useEffect, useRef } from 'react'
const mapRef = useRef<mapboxgl.Map | null>(null)

useEffect(() => {
  if (!selectedActivity?.summary_polyline || !mapRef.current) return
  const coords = decode(selectedActivity.summary_polyline)
  if (coords.length < 2) return
  const bounds = coords.reduce(
    (b, [lng, lat]) => b.extend([lng, lat]),
    new mapboxgl.LngLatBounds(coords[0], coords[0])
  )
  mapRef.current.fitBounds(bounds, {
    padding: 60,
    duration: 800,        // 平滑过渡
    maxZoom: 15,
  })
}, [selectedActivity?.id])  // 仅 ID 变化触发，避免每次 render
```

**注意点：**
- `summary_polyline` 长度 < 2 时（跑步机/无 GPS）跳过，避免 `fitBounds` 报错
- 单点 GPS 异常（长度 ≤ 20 字符）也跳过（沿用 CLAUDE.md 中 PersonalBest 的过滤规则）
- `duration: 800ms` 与现有 filter 切换的 300ms 风格保持一致

### 3.2 首页 hero 第 4 张卡：Marathon Card（P0）

**目标网站样例：**
- 左侧：巨型 `0` 数字 + `MARATHON EVENTS · IN 2026`
- 右侧：`LATEST FINISH` 红标 + 赛事名 + 日期

**本项目实现：**
- 数据：复用 `PersonalBest` 已识别的马拉松（distance 41–44km）/ 半马（20–22.5km），过滤当年 + 全年
- 文案：
  - `N` `场赛事`
  - `今年马拉松` + `IN 2026`（沿用目标网站 ALL CAPS 标签风）
  - `最近一场`：赛事名 + 日期
- 不引入新依赖，复用 `StatsCards` 的卡片样式 + `Activity` 数据形状

**位置：** 第 4 张卡并入 `StatsCards`，网格从 `grid-cols-3`（md）扩展为 `md:grid-cols-4`（小屏 `grid-cols-1`）。需要确认 `StatsCards` 是否当前为 6 卡还是 4 卡（README 提到 6：总距离/总次数/总时间/最长/最佳配速/连续天数），**需要做取舍**：

**方案 A（推荐）：** 把 6 卡拆为 2 行 × 3 卡，第 4 个位置留给 Marathon Card（马拉松数 + 最近赛事）
**方案 B：** 在 `StatsCards` 下方插入独立 `MarathonCard`，与 hero 排成一排

### 3.3 日历组件升级（P1）

**当前 `CalendarWidget`** 仅展示某月活动（按日期数字标记），无翻月、无视图切换、无复制链接。

**借鉴功能：**
1. 标题 `MM/YYYY · total km` + 左右翻月按钮
2. `Calendar View / Route View` 切换按钮（Route 模式 = 当月所有活动叠加到一张 Mapbox mini-map）
3. 复制 URL 按钮（红色 icon，复制带 query 的深链：`?date=2026-06-16`）
4. 点击某天 → 联动 `selectedActivity`（如果当天有活动）

**实现要点：**
- 状态提升到 `App.tsx` 或在 `CalendarWidget` 内独立管理（路由同步选 `selectedDate`）
- 当前 CalendarWidget 已经是独立组件（19 个组件之一），可直接重写
- 视图切换：`Mapbox` 复用主页面 `RouteMap` 还是用独立的 mini-map？**建议独立 mini-map**（避免主图跟随日历变化导致上下文丢失）

### 3.4 `ContributionHeatmap` 新增「年历模式」（P1）

**目标网站年历模式：**
- 每年的格子按 **纵向 7 行（周一到周日）× N 列（52~53 周）** 排列
- **多年并列**：每张年历横向铺开，可滚动切换
- 月份标签：仅在每张图左侧标注 `Jan/Feb/Mar/...`（**不画月份分隔线**）
- 星期表头：图顶部 `S M T W T F S`（首字母）
- **配色 3 级**：`<2km` zinc-800（极弱） / `2~5km` sky-800 / `5~10km` sky-600 / `≥10km` yellow-600
- **空格** = `bg-transparent`（不是隐形，是完全透明——与 zinc-800 暗卡背景有微弱对比）

**本项目实现：**
- 当前 `ContributionHeatmap.tsx` 是 GitHub 横版（`buildYearGrid` 7×53），**保留作为 `compact` 模式**
- 新增 `mode="yearly"` 参数启用年历模式：7 行 × N 列 + 多年并列 + 左右切换按钮
- 数据：当前已用 `useFilteredActivities` 拿到全部活动，新模式按年 group 即可
- 配色：本项目当前是按运动类型上色（跑步橙/骑行蓝/...），可改为 **距离强度** 作为新选项（与运动类型互斥，由用户在 heatmap header 切换「按类型」/「按强度」）

**实现要点：**
```tsx
// ContributionHeatmap.tsx 新增 props
type Mode = 'compact' | 'yearly'
type ColorBy = 'sport' | 'distance'

<ContributionHeatmap
  activities={sportFiltered}
  displayYear={heatmapDisplayYear}
  setDisplayYear={handleHeatmapSelect}
  filter={filter}
  mode={heatmapMode}              // 新增
  colorBy={colorBy}               // 新增
  onSelectActivity={setSelectedActivity}
/>
```

- 与现有 `HeatmapPage.tsx`（全年度热力图）共存：`HeatmapPage` 默认 `mode='yearly'`，首页内联 `mode='compact'`
- 顶部增加 tab/segmented control：「紧凑 / 年历」+「按运动 / 按距离」

### 3.5 `TrackThumb.tsx`：纯 SVG 缩略图（P0）

**当前 `TracksPage` / `ActivityList` 的 polyline**：用 React 元素（`<Map>` + `<Source>` + `<Layer>`）渲染每个活动的轨迹，开销极大。

**借鉴目标网站实现：** 每个活动渲染为单一 `<svg viewBox="0 0 100 100">` + 一根 `<path>`：
```tsx
type ThumbProps = {
  polyline: string
  highlight?: 'normal' | 'long' | 'marathon'  // 决定 stroke color
  size?: number
}

const STROKE_COLOR = {
  normal:   '#94a3b8',  // slate-400
  long:     '#EAB308',  // yellow-500 (>20km)
  marathon: '#E31937',  // red-600 (>40km)
}

export function TrackThumb({ polyline, highlight = 'normal', size = 80 }: ThumbProps) {
  const path = useMemo(() => polylineToSvgPath(polyline), [polyline])
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="aspect-square group">
      <path
        d={path}
        fill="none"
        stroke={STROKE_COLOR[highlight]}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-300 group-hover:stroke-white group-hover:stroke-[4px] group-hover:drop-shadow-[0_0_2px_rgba(255,255,255,0.5)]"
      />
    </svg>
  )
}

function polylineToSvgPath(polyline: string): string {
  const pts = decode(polyline)  // [[lng,lat], ...]
  if (pts.length < 2) return ''
  // 用 100x100 viewBox 归一化
  const lngs = pts.map(p => p[0]), lats = pts.map(p => p[1])
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const scaleX = 90 / (maxLng - minLng || 1)
  const scaleY = 90 / (maxLat - minLat || 1)
  return pts.map(([lng, lat]) => {
    const x = 5 + (lng - minLng) * scaleX
    const y = 5 + (95 - (lat - minLat) * scaleY)  // Y 反转
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' L ')
}
```

**边界处理：**
- `pts.length < 2` → 返回空 path（不渲染）
- polyline null/undefined → 不渲染
- 经度/纬度跨度为 0（垂直/水平线）→ 用 1 防 0 除
- 不画 fill，不画 grid，纯 path

### 3.6 `TracksPage` 重写（P1）

- 用 `TrackThumb` 替换现有 React 地图缩略图（性能提升 10~100x）
- 顶部 `ZITONE'S RUN 2026` 角标（沿用目标网站，但改为动态：跑步者名 + 运动类型 + 年份）
- 左侧 Total Summary 卡（沿用 `StatsCards` 的部分数据：今年距离/次数/时间/配速/HR）
- 左侧下角：年份切换（按钮组，沿用目标网站 `bg-zinc-800` 圆角胶囊）
- 底部：Statistics + Special Tracks 图例

### 3.7 `/life-months` 奔跑人生页面（P2）

**目标网站设计：**
- 整页沉浸式：hero（RUNNING.LIFE 大字 + `584/1008 months · 57.9%`）
- 大网格（约 33 列 × 31 行 = ~1023 格，每格 = 一个月）
- 当前用户只有 6 年数据，下半部分空格 → 视觉震撼「人生还没跑完」

**本项目实现：**
- 数据：每格 = `(year_offset * 12 + month_offset + 1)`，从用户出生年月到当前年月
- 颜色（按月累计距离）：
  - `< 100km` sky-800
  - `100-200km` yellow-600
  - `200-300km` orange-600
  - `> 300km` red-600
- 生日可在 `config.yml` 新增 `birth: 1995-01` 字段（无则默认 25 年前）
- 路由：`/life/months`（不替换现有 `/life`，而是子路径）
- 可选：与现有 `LifePage` 共用路由：`/life` → `LifePage`（保留现有），`/life/months` → 新页面

### 3.8 赛事记录 `/mls`（P2）

**先做最小可用版：**
- 数据：复用 `PersonalBest` 识别的全马/半马（仅基于 `distance`）
- Hero：仿目标网站「奔跑 MARATHON LIFE」双层排版
- 按年度分组：每组 2 列卡片网格
- 卡片字段：日期 / 赛事名（取 `name` 字段，本项目 `name` 通常为空，可显示「未命名」） / 距离 / 时间（= `moving_time`）
- PB 徽章：红色 chip，右上角
- 后续：可新增 `is_race: boolean` 数据字段 + 独立录入入口

### 3.9 设计 token 微调（P1）

**`src/index.css` 调整：**
```css
:root {
  /* Light mode（保留，仅微调） */
  --color-bg: #f6f8fa;
  --color-card: #ffffff;
  --color-border: #d0d7de;
  --color-text: #1f2328;
  --color-muted: #656d76;

  /* 字体新增 */
  --font-sans: 'Inter', system-ui, -apple-system, 'PingFang SC',
               'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

.dark {
  /* Dark mode 借鉴目标网站 */
  --color-bg: #000000;            /* 纯黑（原 #0d1117 → #000） */
  --color-card: #18181b;          /* zinc-900 */
  --color-border: #27272a;        /* zinc-800 */
  --color-text: rgba(255, 255, 255, 0.87);
  --color-muted: #71717a;         /* zinc-500 */
  --color-accent: #f97316;        /* 默认橙（原 #a855f7 → #f97316） */
}
```

**`index.html` 调整：**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
  rel="stylesheet"
/>
```

**注意：** Inter / JetBrains Mono 通过 Google Fonts 加载，国内访问可能慢，建议在 `vercel.json` 配 `cache-control` 或使用 `<link rel="dns-prefetch">`。

### 3.10 入场动画（P2，已按 CDP 实测修正实现方式）

> **2026-08-08 修正**：此前推断目标网站用 framer-motion 是**错的**。通过 CDP 实测（下载 `index-*.js` bundle 全文搜索 + DOM 探测）确认实现方式为 **IntersectionObserver + 运行时内联 style**，非 framer-motion、非 CSS animation。

**目标网站实测事实（CDP probe）：**
1. **无 framer-motion**：`index-*.js`（约 1MB）全文搜索 `framer|useInView|motion|whileInView|staggerChildren` 均为 0 匹配；`window.__framer` 不存在。
2. **无 CSS transition/animation**：动画元素 computed `transitionDuration: 0s`、`animationName: none`。
3. **初始态 = JS 内联**：`opacity: 0; transform: translateY(Npx) translateZ(0px)`，N 取值——区块级 `20px`/`40px`，Activity Log 表格行（`<tr>`）`10px`。
4. **触发 = IntersectionObserver 进入视口**：后台 tab 元素恒 `opacity:0`（`doneFinal:0`，28 个元素全部隐藏），滚动/`window.focus()` 均不触发 → 证实只有元素真正进入视口才触发。
5. **没有整页遮罩元素**：`position:fixed` 元素数 0。"从上到下出现"的观感来自**区块从上到下依次浮现**（顶部 hero 卡先出现，越往下越晚），并非真实遮罩。

**精确动画参数（2026-08-08，从 bundle 源码提取，`Ar` = motion/framer-motion 混淆别名）：**
| 层级 | 参数 |
|---|---|
| 区块级（hero 卡/热力图/ActivityLog 等） | `initial{opacity:0,y:40}`→`whileInView{opacity:1,y:0}`，`viewport{once,amount:0.1}`，**`transition{duration:0.8,ease:"easeOut",delay:n}`**，n 来自 className `delay-100/200/300`=0.1/0.2/0.3s |
| 表格行（`Ar.tr`） | `initial{opacity:0,y:10}`→`animate{opacity:1,y:0}`，`transition{delay:b*0.05}`（b=行索引，每行错落 0.05s，时长用默认） |
| Header | `initial{opacity:0,y:20}`→animate，`transition{delay:0.1/0.2,duration:0.5}` |

> **ease 关键**：目标网站 `ease:"easeOut"` = framer-motion 预设 `[0,0,0.58,1]`（CSS ease-out）。不要用 `cubic-bezier(0.16,1,0.3,1)`（easeOutExpo，冲得更快，会导致上浮过快）。

**本项目落地实现（`src/components/Reveal.tsx`）：**

```tsx
const EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)'

export function Reveal({ y = 40, delay = 0, duration = 800, active = true, className, children }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.opacity = '1'; el.style.transform = 'none'; setRevealed(true); return
    }
    el.style.transition = 'none'
    el.style.opacity = '0'
    el.style.transform = `translateY(${y}px) translateZ(0)`
    if (typeof IntersectionObserver === 'undefined') { el.style.opacity = '1'; el.style.transform = 'none'; setRevealed(true); return }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { setRevealed(true); io.unobserve(entry.target) } })
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [active, y])
  useEffect(() => {
    if (!revealed) return
    const el = ref.current; if (!el) return
    el.style.transition = `opacity ${duration}ms ${EASE_OUT} ${delay}ms, transform ${duration}ms ${EASE_OUT} ${delay}ms`
    const raf = requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0) translateZ(0)' })
    return () => cancelAnimationFrame(raf)
  }, [revealed, duration, delay])
  return <div ref={ref} className={className} data-revealed={revealed ? '1' : '0'}>{children}</div>
}
```

**App.tsx 首页用法**（区块错落，y 对齐目标网站 20/40）：
```tsx
<Reveal y={20}><StatsCards ... /></Reveal>
<Reveal y={40}><ContributionHeatmap ... /></Reveal>
<Reveal y={40}><ActivityLog ... /></Reveal>
{/* 右列同理，每区块包一层 <Reveal y={40}> */}
```

**无障碍**：`prefers-reduced-motion: reduce` 时跳过动画直接显示（Reveal 内处理）。

**关键实现细节：**
- **先设 transition 再改值**：触发后必须先在无值变化时设置 transition，再在下一帧（rAF）改 `opacity/transform` 终值，否则不会产生平滑过渡（同一 render 周期批量应用会跳变）。
- 初始态要显式 `transition: none`，避免元素刚挂载时闪烁。
- 表格行级（`<tr>`）错落（y=10）可选做，本次首页只做了区块级，效果已贴近目标网站。

---

## 4. 配色与排版规范（收敛为本项目自己的设计系统）

> 直接照搬目标网站 `#E31937` 不合适（本项目 `--color-accent` 是动态的）。下面给出**适配版**：

### 4.1 强调色映射

| `--color-accent` | 取值 | 借鉴目标网站 |
|---|---|---|
| `all` | `#a855f7` purple | — |
| `Run` | `#f97316` orange | （目标网站用 red，本项目偏橙红） |
| `Ride` | `#3b82f6` blue | — |
| `Hike` | `#22c55e` green | — |
| `Gym` | `#ec4899` pink | — |

### 4.2 热力图距离色阶（与运动类型色互斥）

| 距离 | Tailwind class | 说明 |
|---|---|---|
| 无活动 | `bg-transparent` | 与卡片底色融为一体（不是 zinc-800） |
| `< 2 km` | `bg-zinc-700/60` | 极弱（替代原 sky-800） |
| `2 ~ 5 km` | `bg-accent/30`（默认橙，alpha 30%） | 弱 |
| `5 ~ 10 km` | `bg-accent/60` | 中 |
| `≥ 10 km` | `bg-accent` | 强 |

**变化点：** 不固定颜色，而是跟随 `--color-accent`（运动类型色），保持项目原有"按类型上色"的设计资产。

### 4.3 字体使用

| 内容 | 字体 | 理由 |
|---|---|---|
| 数字（hero、表格） | `var(--font-mono)` | 等宽对齐 |
| 中文标题 | `var(--font-sans)` (Inter fallback 思源黑) | 现代感 |
| 英文 Hero（如 ZITONE'S RUN） | Inter 800 / 900 weight uppercase | 借鉴目标网站 |
| 表格文字 | Inter 400 | 易读 |

### 4.4 间距与圆角（8px grid + 2xl 圆角）

| token | 值 | 用途 |
|---|---|---|
| `gap-6` | 24px | 卡片间距（紧凑） |
| `gap-8` | 32px | 区块间距（宽松） |
| `rounded-2xl` | 16px | 卡片 |
| `rounded-xl` | 12px | 缩略图 / 小卡 |

---

## 5. 实施路线（建议顺序）

| 阶段 | 内容 | 预估工作量 |
|---|---|---|
| **M1：基础设施** | 设计 token（§3.9）+ Inter/JetBrains Mono 字体 + 全局 `FadeSlide` 组件 | 0.5 d |
| **M2：核心联动** | `RouteMap` flyTo（§3.1）+ 首页 Marathon Card（§3.2） | 0.5 d |
| **M3：轨迹缩略图** | `TrackThumb`（§3.5）+ `TracksPage` 重写（§3.6） | 1 d |
| **M4：热力图年历模式** | `ContributionHeatmap` 新增 `mode="yearly"`（§3.4） + 顶部切换 tab | 1 d |
| **M5：日历升级** | `CalendarWidget` 翻月/视图切换/复制 URL（§3.3） | 0.5 d |
| **M6：奔跑人生 v2** | `/life/months` 页面（§3.7） | 0.5 d |
| **M7：赛事记录页** | `/mls` 页面（§3.8） | 0.5 d |
| **M8：打磨** | 入场动画（§3.10）+ 截图回归 + GitHub Pages 验证 | 0.5 d |

**总计：** ~5 d（M1+M2+M3+M4 是核心）。

---

## 6. 兼容性 / 风险

| 风险 | 应对 |
|---|---|
| Inter 字体国内访问慢 | 提供 `index.html` 的 `<link rel="dns-prefetch">`；可选自托管（`src/assets/fonts/`） |
| 切换背景色到纯黑影响浅色主题 | 浅色模式 token 不变，仅 `.dark` 下调整 |
| `RouteMap.flyTo` 抖动 | 用 `useEffect` 依赖 `selectedActivity?.id` 而非整个对象；并加 `duration: 800` 平滑过渡 |
| TrackThumb SVG 数量大（370 个活动）卡顿 | 网格用 CSS `grid` 横向铺开 + 浏览器原生滚动；不一次性渲染到 canvas；hover 单独高亮（不重渲染） |
| `/mls` 依赖赛事数据但本项目没有 is_race 字段 | M7 阶段先用 `PersonalBest` 的距离规则粗筛（41–44km 全马、20–22.5km 半马）做最小可用版 |
| 热力图年历模式占用屏幕宽度 | 默认展示最近 3 年（与目标网站一致），其余年份通过左右按钮切换 |
| 入场动画对 prefers-reduced-motion 用户不友好 | `@media (prefers-reduced-motion: reduce) { .fade-slide { animation: none } }` |

---

## 7. 验证清单

实施完成后逐项验收：

- [ ] `pnpm dev` 启动正常，无 console 报错
- [ ] 首页 `RouteMap` 在点 Activity Log 行后 800ms 内缩放到该路线
- [ ] 首页第 4 张 hero 卡显示当年马拉松数 + 最近一场赛事
- [ ] `ContributionHeatmap` 顶部可切换「紧凑 / 年历」+「按运动 / 按距离」
- [ ] 年历模式下支持左右按钮切换不同年份
- [ ] `TracksPage` 用 `TrackThumb` 渲染 370+ 活动，首屏 < 1s
- [ ] `TrackThumb` hover 时 stroke 变白 + 加粗 + drop-shadow
- [ ] `CalendarWidget` 支持翻月 + Calendar/Route 视图切换 + 复制 URL
- [ ] `/life/months` 网格正确渲染用户出生至今的所有月份
- [ ] `/mls` 至少展示 2025 年 4 场赛事卡片 + PB 徽章
- [ ] Inter / JetBrains Mono 字体加载成功（Network 面板确认无 404）
- [ ] 暗黑模式背景为纯黑 `#000`、卡片 `zinc-900`
- [ ] `prefers-reduced-motion` 用户无入场动画
- [ ] 浅色 / 深色 / 中英双语切换无样式错乱
- [ ] GitHub Pages 部署后实际效果与本地一致（`pnpm build && pnpm preview`）

---

## 8. 不在本次范围

- 引入 Mapbox 替代 react-map-gl（已在用）
- 接入 i18n 之外的翻译平台
- 重新设计数据 schema（`is_race` 字段等）—— 留待 M7 之后单独 issue
- 完整 PWA / 离线缓存
- 引入 framer-motion 等新运行时依赖（CSS keyframes 足够）

---

## 9. 参考资料

- 目标网站：https://run.731558.xyz:6881 （直接参考）
- running_page 灵感来源：https://github.com/yihong0618/running_page/issues/12#issuecomment-3689275071
- Mapbox GL JS flyTo：https://docs.mapbox.com/mapbox-gl-js/api/map/#map#flyto
- Mapbox fitBounds：https://docs.mapbox.com/mapbox-gl-js/api/map/#map#fitbounds
- Inter 字体：https://rsms.me/inter/
- Tailwind CSS zinc/sky/yellow 色板：https://tailwindcss.com/docs/customizing-colors

---

## 10. 基于已收集资料的定位修改能力（重要）

> **结论：本文档 + 已沉淀的 memory，已足够支撑「针对目标网站 UI 的提问」直接定位到本项目代码并修改，绝大多数场景无需再次访问目标网站。** 下文说明可用的信息层与适用边界。

### 10.1 已沉淀的信息资产（定位依据）

| 信息 | 存放位置 | 用途 |
|---|---|---|
| 目标网站设计语言（配色 token、字体、圆角、间距、动画） | 本文档 §1.3 / §4 | 给改动提供设计基准 |
| 各页面组件清单与借鉴价值 | 本文档 §1.4 | 判断"这个 UI 长什么样、对应本项目哪个组件" |
| 本项目现状 vs 目标网站的差距 | 本文档 §2 | 明确要改哪个文件、哪个 prop |
| 逐项落地设计（含代码示例） | 本文档 §3 | 直接照着改 |
| 目标网站视觉/交互关键事实 | `memory/`（长期记忆 + 2026-08-08 日文件） | 跨会话快速召回，不用重翻文档 |
| 本项目架构约定 | `CLAUDE.md` + `README.md` | 保证改动符合项目既有模式 |

### 10.2 支持哪些提问场景（可直接定位修改）

- 「目标网站某个卡片/页面的**样式**（颜色/圆角/字体/间距）是怎样的」 → 看 §1.3 / §4 的 token 表，直接套用到本项目对应组件。
- 「目标网站的 **X 交互**（点行联动地图、日历翻月、轨迹墙缩略图）怎么实现的」 → 看 §3 对应的落地设计 + 代码示例，改本项目对应组件。
- 「我要在本项目做出和目标网站**类似的 Y 效果**」 → 查 §1.4 判断借鉴价值 + §3 的实现路径 + §5 的阶段归属。
- 「这个改动要不要动数据 schema / 同步脚本」 → §2.2 的待新增/改造点标注了 P 级别和关联文件，§8 明确不在范围内的（如 `is_race` 字段）会提醒。

### 10.3 边界（这些情况需要重新访问目标网站）

文档能覆盖"**已经观察到的**设计"，但存在以下盲区，遇到时需用 §11 的 CDP 流程重新抓取：

- **运行时状态**：hover / focus / 点击后的动态效果、弹窗、下拉、拖拽等**交互中间态**（文档只记录了静态样式和部分 hover 规则）。
- **响应式断点**：目标网站在窄屏/平板下的布局变化（文档主要基于桌面视口分析）。
- **细节数值**：精确的字号 px、间距 px、边框透明度等（文档给了 token，但具体像素值需实测）。
- **数据形态**：目标网站的图片、字体文件等静态资源 URL（文档只记录了来源，未存资源本体）。
- **新增/改版**：目标网站后来更新了 UI，文档已过时。

> 判断标准：**改的是"我已知的设计"→ 直接改；改的是"我需要确认的细节/动态效果"→ 先 CDP 抓一下再改。**

---

## 11. 再次访问目标网站的流程（复用本机 Chrome）

后续若有需要重新查看目标网页的需求，**只需在 Chrome 里打开远程调试开关即可复用 CDP 能力**，无需任何安装。完整步骤如下：

### 11.1 前置（只需做一次 / 浏览器重启后重做）

1. 在你**想要被接管的 Chrome 窗口**地址栏输入：`chrome://inspect/#remote-debugging`
2. 勾选 **"Allow remote debugging for this browser instance"**
3. 保持该窗口打开（**关闭窗口 = 调试开关失效**，需重新勾选）
4. 确认调试端口为 **9222**（skill 的 check-deps 会自动探测）

### 11.2 建立连接（每次分析前执行）

```bash
# 定位 skill 目录（目录名含全角括号，PowerShell 需用通配匹配）
$d = Get-ChildItem "C:\Users\Administrator\.codebuddy\skills" -Directory -Force | Where-Object { $_.Name -like "*Web Access*" }
# 前置检查 + 自动启动 CDP Proxy（localhost:3456）
node "$($d.FullName)\scripts\check-deps.mjs"
```

预期输出 `proxy: ready (Chrome)` 即连接成功。

### 11.3 核心 API（curl 调 localhost:3456，PowerShell 用 `curl.exe`）

```bash
curl.exe http://localhost:3456/targets                              # 列出用户已开 tab
curl.exe -X POST --data-raw '<URL>' http://localhost:3456/new       # 新建后台 tab → targetId
curl.exe "http://localhost:3456/info?target=<ID>"                   # 页面状态
curl.exe -X POST "http://localhost:3456/eval?target=<ID>" -d '<JS>' # 执行 JS 读取/操控页面
curl.exe "http://localhost:3456/screenshot?target=<ID>&file=<路径>&full=1" # 截图；full=1=整页长截图（captureBeyondViewport）
curl.exe -X POST "http://localhost:3456/click?target=<ID>" -d '<css选择器>'  # GUI 点击
curl.exe "http://localhost:3456/close?target=<ID>"                  # 关闭自己创建的 tab
```

> **重要：整页截图需要 `full=1`**。默认 `/screenshot` 只截当前可视区域。`full=1` 是 2026-08-08 给 `cdp-proxy.mjs` 新增的参数（备份 `cdp-proxy.mjs.bak`），修改后需重启 Proxy 生效。

**抓取完整长截图的可靠流程（避免动画中间帧空白）：**
1. `POST /navigate` 到目标页面，`sleep 1200ms`
2. 注入禁用动画 CSS（关键，否则 framer-motion 的 `opacity:0→1` 会让截图半透明）：
   ```js
   (function(){var s=document.createElement('style');s.id='__killAnim__';
   s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;animation-duration:0s!important;transition-duration:0s!important;opacity:1!important;transform:none!important;translate:none!important}';
   document.head.appendChild(s);return 'anim disabled'})()
   ```
3. `sleep 600ms`（等 Mapbox 等异步渲染完成）
4. `/screenshot?full=1` 整页截图
5. 用 Node 读 PNG IHDR 校验尺寸（`buf.readUInt32BE(16/20)`），纯空白图通常 <5KB 且高度=视口，可作为异常信号。

### 11.4 操作规范（遵循 skill 的最小侵入原则）

- **不操作**用户已有的 tab，只操作自己用 `/new` 新建的后台 tab。
- 完成分析后**用 `/close` 关闭自己创建的 tab**，保留用户原有 tab。
- **不要停掉 CDP Proxy**（长驻进程），重启后需在浏览器重新授权 CDP 连接。
- PowerShell 传 CSS 选择器时，含引号的写法（如 `[href="/mls"]`）会转义失败，改用子串匹配 `[href*=mls]`。
- 复杂 JS 先写到 `.js` 文件，用 `Get-Content -Raw -Encoding UTF8` 注入 `-d`，避免内联转义问题。

### 11.5 抓取完成后

- 新截图存到 `.codebuddy/analysis/run-log-cdp-v2-2026-08-08/`（完整长截图，当前视觉对照基准）。
- 若发现新的设计事实（新配色、新交互、站点改版），**回写本文档对应章节**，保持文档"自足定位"的能力。