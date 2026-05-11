# PopStreet Admin — UI 重构方案

> Target: 把 `popstreet-web` 后台改造成现代、简洁、数据可视化驱动、易维护的浅色风格 admin。
>
> 业务关键事实：building 低频（基础资料），unit 高频（每日抓取的折扣 listing）。设计必须围绕"每日盯盘 + 偶尔维护资料库"两种场景同时优化。

---

## 1. 设计原则

1. **数据先行 (Data first)**：管理员的核心动作是"今天有什么新折扣"。Dashboard 是真正的工作台，不是欢迎页。
2. **浅色 + 高密度但不拥挤**：以 `slate-50` 为底色，白色卡片 + 1px 边 + 12px 圆角。信息密集场景（unit 表格）用更紧凑行高，但保留呼吸感。
3. **状态语言统一**：available / pending / unavailable / rented / archived 五个 listing 状态，全站使用同一套徽章样式。
4. **频率分层**：高频对象（unit listing）用"流式"卡片 / 表格 + 时间戳呼吸效果；低频对象（building）用 master-detail 编辑器。
5. **可维护**：迁移到 Tailwind + shadcn/ui，去掉 1125 行 globals.css 的"大泥球"，组件化、token 化。

---

## 2. 技术栈选型

| 维度 | 当前 | 新方案 |
| --- | --- | --- |
| 样式 | 单文件 1125 行 CSS | Tailwind CSS v3 + CSS variables for tokens |
| 组件库 | 手写 | shadcn/ui（按需复制源码到 `components/ui/`，零运行时依赖） |
| 图标 | lucide-react ✅ | 继续 lucide-react |
| 图表 | 无 | **Recharts** (轻量、React 友好、与 shadcn/ui chart 组件对接) |
| 地图 | Leaflet ✅ | 继续 Leaflet，但用 `react-leaflet` 包一层并支持 cluster + heatmap |
| 表格 | 手写 | **TanStack Table v8**（headless，配合 shadcn `<Table>`），支持排序、过滤、虚拟滚动 |
| 表单 | 手写 useState | **react-hook-form + zod**（建筑信息这种字段多的场景必备） |
| 通知 | `setMessage` 字符串 | **sonner**（shadcn 推荐的 toast） |
| 日期 | 手写 format.ts | **date-fns** |

### 为什么不选 Ant Design / Mantine

- shadcn/ui 是 "复制源码 + Tailwind"，没有运行时锁定，主题自由度最高，符合"易维护"。
- AntD 重、定制成本高，且默认风格与你想要的"现代简洁"有差距。
- Recharts + TanStack Table 是 React 生态最稳定的组合，长期维护风险低。

---

## 3. 设计 Token

```css
/* tailwind.config.ts 里通过 theme.extend.colors 暴露 */
:root {
  /* Surfaces */
  --bg:           hsl(210 20% 98%);   /* slate-50 */
  --surface:      hsl(0 0% 100%);     /* white */
  --surface-2:   hsl(210 17% 96%);    /* slate-100 */
  --border:       hsl(214 15% 91%);   /* slate-200 */
  --border-soft:  hsl(214 20% 95%);   /* slate-100 */

  /* Text */
  --fg:           hsl(222 25% 14%);   /* slate-900 */
  --fg-muted:     hsl(215 14% 45%);   /* slate-500 */
  --fg-subtle:    hsl(215 14% 60%);   /* slate-400 */

  /* Brand — orange (高对比、抓眼球，与 NYC 出租市场的 "deal/折扣" 心智匹配) */
  --brand:        hsl(20 90% 48%);    /* orange-600  #ea580c */
  --brand-strong: hsl(15 79% 40%);    /* orange-700  #c2410c */
  --brand-soft:   hsl(33 100% 96%);   /* orange-50   #fff7ed */
  --brand-mid:    hsl(25 95% 53%);    /* orange-500  #f97316 */

  /* Accent — sky (区分于 brand，用于链接、信息) */
  --accent:       hsl(199 89% 48%);   /* sky-500 */
  --accent-soft:  hsl(204 94% 94%);   /* sky-100 */

  /* 重要：保留 emerald 作为 "active/success" 状态色 (badge / 增长箭头) — */
  /* brand 橙是装饰/品牌；emerald 是状态语义。两者不混用。 */

  /* Status */
  --success: hsl(142 71% 45%);  --success-soft: hsl(143 64% 95%);
  --warn:    hsl(38 92% 50%);   --warn-soft:    hsl(48 100% 96%);
  --danger:  hsl(0 84% 60%);    --danger-soft:  hsl(0 86% 97%);

  /* Effects */
  --radius: 12px;
  --shadow-sm: 0 1px 2px rgb(15 23 42 / 4%);
  --shadow-md: 0 4px 12px -2px rgb(15 23 42 / 6%);
  --shadow-lg: 0 12px 32px -8px rgb(15 23 42 / 12%);
}
```

字体：`Inter` (system fallback)，正文 14px，KPI 数字 28-32px，等宽数字使用 `tabular-nums`（OpenType `tnum`）。

间距尺度沿用 Tailwind 默认（4/8/12/16/24/32...），不另造体系。

---

## 4. 信息架构

### 4.1 顶级导航（Sidebar，浅色，可折叠到 icon-only）

```
┌──────────────────────────────────────────┐
│  PopStreet                  [折叠]       │
├──────────────────────────────────────────┤
│  ◎ Overview       ← Dashboard           │
│  ▤ Buildings      ← 低频，资料维护       │
│  ◉ Units & Deals  ← 高频，每日盯盘       │
│  ⌖ Map            ← 地理校对             │
│  ⟳ Data Sources   ← (新) 抓取健康监控    │
│  ─────────────                          │
│  ☉ Accounts       ← admin 才可见         │
└──────────────────────────────────────────┘
```

**新增 `Data Sources` 模块**：因为 unit 是每天通过 scraper 注入的，需要一个面板看：
- 各 source 昨日抓取量
- 抓取失败率 / 平均延迟
- `unit_listings.last_seen_at` 距今超过 N 天的 building，提醒可能 scraper 漏了

### 4.2 顶部 Topbar

- 左：当前模块面包屑（替换原来的"PopStreet Admin / Buildings, units, and availability"双行 brand）
- 中：全局搜索（cmd+K，跨 building / unit / address）
- 右：role pill、`<env-pill>` (dev/prod 提示，常被忽视但很重要)、avatar 菜单（sign out）

### 4.3 Dashboard 改造

**核心指标 → 趋势 → 地理 → 排行 → 细分** 五段式：

| 区块 | 内容 | 数据源 |
| --- | --- | --- |
| **KPI Strip** (5卡) | Active buildings · Active listings today · 🆕 New today · ❌ Off-market today · 💰 Median net rent | `buildings`, `unit_listings` |
| **Daily Trend** (折线/堆叠面积) | 过去 30 天每日 new listings vs went-unavailable，并叠加 active 总量参考线 | `unit_listings.listed_at` & `unavailable_at` |
| **Map Heatmap** | NY/NJ 地图，每个 building 一个 bubble，半径 = active listing 数，颜色 = 平均 free months | `buildings` + 聚合的 listings |
| **Top Deals** (排行) | 当前折扣力度 top 10：unit + building + free months + cash back + net rent + 折扣% | `unit_listings.status='available'` |
| **Neighborhood Breakdown** | 横向条形：按 neighborhood 聚合的 active count & median discount | join `buildings`/`neighborhoods`/`unit_listings` |

### 4.4 Buildings 模块（低频维护）

保留 master-detail 双栏（你的现有交互逻辑没问题），但：

- 左侧列表加密：表格化，列 = name · area · units · active · last update。支持排序。
- 右侧 inspector 三 tab：**基础信息** / **位置与地图** / **媒体（封面图、story 视频）**
- 顶部新增"快速操作"工具栏：批量归档、CSV 导入（你已经有 buildings_nyc.csv 这种数据源，应该在 UI 里支持上传）。

### 4.5 Units & Deals 模块（高频盯盘）

**这是最关键的视图**，应该是一个高密度 ops table：

- 默认按 `listed_at desc` 排序（最新进入市场的优先看）。
- 顶部过滤栏：search · building · bedroom · status · listed in (today/7d/30d) · has free months · has cash back · price range slider。
- 表格列：
  - **Unit**（building name + #unit_number，副行显示 bedroom/bath/sqft）
  - **Status** 徽章
  - **Deal** — 把 `free_months` `cash_back_cents` `lease_deal` 揉成一颗"deal chip"。例如：`+2mo · $1,500 back`
  - **Market → Net** — 双行显示市场价划线 + 净价 + 折扣百分比（color 取决于幅度）
  - **Listed** / **Last seen**（相对时间："2h ago"），`last_seen_at` 超过 3 天的高亮警告
  - **Source** badge
  - 行末"…" 弹出 quick actions（标记 unavailable、查看 source 链接、编辑）。
- 行点击 → 右侧抽屉 drawer 展开详情 + 历史价格曲线（micro chart）。

### 4.6 Map 编辑器（重点重做，见 mockup-04）

把原本的 2 列升级为 **3 列工作台**：左 = 建筑列表 / 中 = 大地图 / 右 = 编辑面板。

- **大地图**：Leaflet + CARTO Light 底图（沿用 `building-map.tsx` 现有的栈），所有有坐标的 building 都渲染为橙色 pill marker，可选择只显示圆点（高密度模式）。
- **选中态**：选中的 building 切换为放大的橙色 pill + 虚线 pulse 环（视觉锚点）。
- **拖拽编辑**：仅选中态可拖拽；拖拽后顶部出现"未保存"横幅，显示 Δlat/Δlng 和「Reset / Save」操作，避免误改直接落库（对应 `building-map.tsx` 里 `onCoordinateChange` 回调）。
- **坐标输入**：右侧面板的 Lat/Lng 输入框允许手动输入并实时反映在地图上。`mono tnum` 字体，强调精度。
- **坐标校验 (Validate coords)**：高亮 ① `latitude=0 / longitude=0` 的 building、② 在 NY/NJ 矩形 bounds 外的 building。列表顶部一键过滤"Issues"。
- **批量地理编码**：「Geocode missing」按钮，对缺少坐标的 building 调 Mapbox/Google Geocoding 批量补全（后端 RPC）。
- **Cluster**：超过当前视口 50 个 marker 时自动 `Leaflet.markercluster` 聚合。

### 4.7 Accounts

低频管理页，结构小改：表格化呈现，role/status 用统一徽章。新增"邀请新管理员"按钮（mailto 或 supabase invite，根据现有能力）。

---

## 5. 组件清单（shadcn/ui）

落地时按需 `npx shadcn-ui add ...` 复制：

- 基础：`Button` `Input` `Select` `Textarea` `Switch` `Checkbox` `Badge` `Card` `Separator` `Tabs` `Tooltip` `DropdownMenu` `Dialog` `Sheet` (drawer) `Toast`(sonner) `Skeleton`
- 数据：`Table` `Command` (cmd+K) `Calendar` `Popover` `DatePicker`
- 自定义（你这边新写）：
  - `<KpiCard>` — 统一 KPI 卡片
  - `<StatusBadge variant="available|pending|...">`
  - `<DealChip>` — free months + cash back 复合
  - `<RelativeTime value={iso}>` — 鼠标悬浮显示绝对时间
  - `<BuildingMap>` — 包装 Leaflet
  - `<TrendChart>` — 包装 Recharts，统一颜色 & 网格样式
  - `<DataTable>` — 包装 TanStack Table，统一空态、loading、分页

---

## 6. 迁移策略（避免一次性大爆炸）

分 4 个 PR，每个独立可上线：

**PR-1 / 设计系统打底（无视觉变化）**
- 装 Tailwind、初始化 `tailwind.config.ts`、shadcn init
- 把 1125 行 globals.css 中的 token 移到 CSS variables + Tailwind theme
- 旧 class 继续工作（保持兼容），不动业务组件

**PR-2 / Shell 重做**
- 重写 `admin-app.tsx` 的 topbar + sidebar + 布局
- 引入 `<Sheet>`、cmd+K 搜索骨架（暂不接业务）
- 引入 sonner 替换 `setMessage`

**PR-3 / Dashboard 可视化**
- 装 recharts、写 `<TrendChart>` `<KpiCard>`
- 实现 4 个新图表（trend / map heatmap / top deals / neighborhood）
- 后端：可能需要新增 Supabase RPC 或 view 做时间序列聚合（30 天数据)

**PR-4 / Buildings & Units 重写**
- Units 表用 TanStack Table 重写（这是用户每天看的页面，价值最高）
- Buildings master-detail 套 shadcn `<Tabs>` + `<Sheet>` for 媒体编辑
- 拆掉 1634 行的 `building-manager.tsx` —— 拆为 `BuildingsList`、`BuildingEditor`、`UnitsTable`、`UnitEditorDrawer`、`MapWorkspace` 五个文件

**PR-5 / Data Sources 新模块**（可选，但强烈推荐）
- 给 scraper 一个监控面板

---

## 7. 文件结构建议（重构后）

```
src/
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx              ← <AdminShell />
│  └─ globals.css           ← 只保留 reset + tailwind 指令 + tokens
├─ components/
│  ├─ ui/                   ← shadcn copy-paste，不要手改
│  ├─ shell/
│  │  ├─ admin-shell.tsx
│  │  ├─ sidebar.tsx
│  │  └─ topbar.tsx
│  ├─ dashboard/
│  │  ├─ dashboard.tsx
│  │  ├─ kpi-strip.tsx
│  │  ├─ trend-chart.tsx
│  │  ├─ map-heatmap.tsx
│  │  ├─ top-deals.tsx
│  │  └─ neighborhood-breakdown.tsx
│  ├─ buildings/
│  │  ├─ buildings-page.tsx
│  │  ├─ buildings-list.tsx
│  │  ├─ building-editor.tsx
│  │  └─ building-media.tsx
│  ├─ units/
│  │  ├─ units-page.tsx
│  │  ├─ units-table.tsx
│  │  ├─ units-filter-bar.tsx
│  │  ├─ unit-drawer.tsx
│  │  └─ deal-chip.tsx
│  ├─ map/
│  │  └─ map-workspace.tsx
│  └─ accounts/
│     └─ accounts-page.tsx
├─ hooks/
│  ├─ use-buildings.ts
│  ├─ use-units.ts
│  └─ use-dashboard.ts       ← 把 supabase 查询从组件抽离
├─ lib/
│  ├─ supabase.ts
│  ├─ format.ts
│  ├─ types.ts
│  └─ permissions.ts         ← canManageAccounts / canEditInventory
```

每个组件文件控制在 ~200 行内，避免再出现 1634 行的"上帝组件"。

---

## 8. 性能与体验要点

- Supabase 查询：当前 dashboard 拉 `limit(500)` listings 在 RAM 算 stats，正确做法是用 view / RPC 在 DB 端聚合。
- 表格虚拟化：units 表格一旦超过 200 行就上 `@tanstack/react-virtual`。
- 乐观更新：标记 unavailable / 编辑 deal 这种高频操作，应该乐观 UI + 失败回滚 + toast，而不是 await 整个 round-trip。
- 加载态：所有数据区用 `<Skeleton>`，不要文字 "Loading…"。
- 暗黑模式：tokens 已经 hsl 化，未来要支持 dark 只需切换 CSS variable，不用改组件。

---

## 9. Supabase 数据接入清单

所有视图都通过 `supabase-js` 直读现有表，**不引入新表**。下表标注每个 mockup 区块对应的查询。涉及的类型来自 `src/lib/types.ts`：`Building`、`Unit`、`UnitListing`、`Neighborhood`、`AccountProfile`。

### Dashboard（mockup-01）

| 区块 | 查询（建议） | 备注 |
| --- | --- | --- |
| `Active buildings` / `Total` | `buildings` count，`is_active=true` count | 沿用 `dashboard.tsx` 现有逻辑 |
| `Active deals` (today) | `unit_listings` where `status='available'` count | 现在 dashboard 里是 `limit(500)` 客户端筛 — 建议改 head count |
| `New today` | `unit_listings` where `listed_at::date = current_date` count | **新增** Supabase view / RPC |
| `Off-market today` | `unit_listings` where `unavailable_at::date = current_date` count | **新增** |
| `Median net rent` | `select percentile_cont(.5) within group (order by net_price_cents) from unit_listings where status='available'` | **新增 RPC** `dashboard_median_net_rent()` |
| `Daily activity` 折线/堆叠 | 按天 group：`new_count`, `off_count`, `active_running_total` | **新增 view** `mv_daily_activity_30d` (物化视图，每小时刷新) |
| `Geo distribution` 地图 | join `buildings` × `unit_listings(status='available')` group by building_id | **新增 view** `v_building_active_deals` |
| `Top deals` | `unit_listings` order by `(market - net)/market desc` limit 10，join `units`、`buildings` | 一次性 query |
| `Top neighborhoods` | `buildings join neighborhoods join unit_listings` group by neighborhood | **新增 view** `v_neighborhood_active_deals` |

### Buildings（mockup-02）

| 区块 | 查询 | 备注 |
| --- | --- | --- |
| 表格列表 | `buildings select *, neighborhoods(name, slug)` (已有) | 加排序 + 分页 |
| 表格 "Active deals" 列 | join `v_building_active_deals` | 复用上面的 view |
| Inspector 三 tabs | `buildings` 单条 + `units(building_id=...)` + `unit_listings` 子查询 | Tabs 切换时 lazy load |
| 地图预览 | 来自 `building.latitude/longitude` | 单点 marker |
| 标签编辑 | `buildings.description_labels: string[]` | 直接 update text[] |

### Units &amp; Deals（mockup-03）

| 区块 | 查询 | 备注 |
| --- | --- | --- |
| 表格 | `unit_listings select *, units!inner(*, buildings!inner(name, area, neighborhoods(name)))` | join 拉一次拿全 |
| 过滤栏 | bedroom = `units.bedroom_count`，status = `unit_listings.status`，"has free months" = `free_months &gt; 0`，"has cash back" = `cash_back_cents &gt; 0`，date = `listed_at &gt;= …` | server-side filter，避免拉全量 |
| Stale (&gt; 3d unseen) | `unit_listings` where `last_seen_at &lt; now() - interval '3 day' and status='available'` | 抓取健康度指标 |
| 价格历史曲线（右侧 drawer） | **新增表** `unit_listing_history` 或 `unit_listings` 每次 update 写入 `_audit` | 暂时可用 `listed_at + net_price_cents` 静态点 |
| Mark unavailable 操作 | `update unit_listings set status='unavailable', unavailable_at=now() where id=?` | 乐观 UI |

### Map editor（mockup-04）

| 区块 | 查询 | 备注 |
| --- | --- | --- |
| 全量 marker | `buildings select id, name, latitude, longitude, is_active, area, neighborhoods(name)` | 沿用 `building-map.tsx` 数据流 |
| Coord 输入 / 拖拽保存 | `update buildings set latitude=?, longitude=? where id=?` | 走 `building-manager.tsx` 现有 `handleBuildingUpdate` |
| "Issues" 过滤 | client-side：`latitude=0 OR latitude NOT BETWEEN 40 AND 41.5` 等 | NY/NJ 大致矩形：lat 40.0–41.6 / lng −74.6 ~ −73.5 |
| Geocode missing | 调外部 Geocoding API → 批量 update | 服务端 Edge Function |
| Cluster | `Leaflet.markercluster` 客户端，无 DB 改动 | |

### Accounts

沿用 `accounts-manager.tsx` 既有 `account_profiles` 表 + `claim_first_admin` RPC，仅视觉重做。

### 数据契约保护

迁移期间所有现有 type (`src/lib/types.ts`) **保持兼容**，新增字段只通过新建 view / 物化视图获取，不破坏 `Building` / `Unit` / `UnitListing` 的形状。

---

## 10. 下一步

如果方案确认，PR-1 → PR-5 顺序在 `popstreet-web/` 内分步落地，每个 PR 后 `npm run build` 通过再交付。

预览 mockup：

- `mockup-01-dashboard.html` — Overview
- `mockup-02-buildings.html` — Inventory
- `mockup-03-units.html` — Daily deals
- `mockup-04-map.html` — Map editor （重做版）
- `index.html` — 汇总入口
