# COROS 轨迹同步重构计划（基于 `activity/detail/query`）

> 状态：已落代码（`run_page/coros_api_sync.py`），字段单位经 332 条活动实测定稿；`elapsed_time`/`type`/`average_speed` 逻辑最新结论见 §2.4、§4。
> 背景：原同步链路依赖下载 FIT 二进制并解析；现发现网站渲染地图的接口 `activity/detail/query` 直接以 JSON 返回完整轨迹与统计字段，可大幅简化并增强同步逻辑。

## 1. 关键发现

### 1.1 目标接口

```
POST https://teamcnapi.coros.com/activity/detail/query
  ?screenW=1088&screenH=1440&labelId=<label_id>&sportType=<sport_type>
  Header: accesstoken: <token>      # 与现有 login() 拿到的 token 同一套
  Body:   空 (content-length: 0)
```

- 这是**之前从未调用过的第 4 个端点**（现有代码只用 `account/login`、`activity/query`、`activity/detail/download`）。
- 鉴权复用现有 `Coros.login()` 的 `accesstoken` + Cookie（httpx 自动管理登录态），无需新增登录逻辑。

### 1.2 实测轨迹数据（labelId=478689944217354255，跑步 6.35km，sportType=100）

| 指标 | 数值 | 结论 |
|---|---|---|
| 有效点数 | 2492（列表 2597 条中 105 条坐标为 0，已滤除） | — |
| 总时长 | 12:55:56 → 13:43:09 UTC = 2833 秒 | — |
| 采样率 | 2492 / 2833 ≈ **0.88 Hz** | 即手表 1Hz 原始轨迹 |
| 平均间距 | **2.6 m** | 地图非常平滑，与典型 FIT 同级 |
| 最小间距 | 0.35 m | 原地/停顿，正常 |
| 最大间距 | 51.7 m | 偶发 GPS 丢星（城市遮挡） |
| 坐标范围 | 30.651~30.684, 104.060~104.094 | 成都真实坐标 ✅ |

**结论**：`frequencyList` 即手表 ~1Hz 原始轨迹，可放心替代 FIT 画地图。坐标编码为 `÷1e7`（整数 → 精度亚厘米，真实精度受 PACE 2 单频 GPS 限制约 ±3–5m，与数据源无关）。

### 1.3 时间戳单位：1/10 秒（decisecond）

```
178325615600 / 1000 = 1975 (❌ 早于 epoch，排除毫秒)
178325615600 / 100   = 2026-07-05 12:55:56 UTC (✅)
```
- `timestamp ÷ 100 = Unix 秒`
- `run_id = timestamp ÷ 100 × 1000 = frequencyList[0].timestamp × 10 = 1783256156000`，与 FIT 路径 `startTime_sec × 1000` **完全一致** → 不会建重复行。

### 1.4 响应结构（与轨迹/统计相关）

- `data.frequencyList[]`：逐点轨迹，字段 `gpsLat, gpsLon, heart, distance, speed, timestamp, altitude(部分缺)`。
- `data.summary`：**数据金矿**，含 `name, distance, calories, totalTime, workoutTime, trainingLoad, avgHr, maxHr, avgPace, avgSpeed, maxSpeed, avgCadence, avgStepLen, avgPower, np, elevGain, totalDescent, startTimestamp, endTimestamp, timezone` 等。
- `data.pauseList[]`：每次暂停的 `startTimestamp/endTimestamp/duration` → 可精确算 `moving_time`。
- `data.lapList[].lapItemList[]`：每圈元数据（含 `startGpsLat/lng`、`endGpsLat/lng`、`lapDistance`），非轨迹。
- `data.deviceList[]`：设备信息（如 "COROS PACE 2"）。

### 1.5 对原有结论的修正

| 原认为「必须靠 FIT」 | 现结论 |
|---|---|
| `summary_polyline` | ✅ API `frequencyList` 给 |
| `start_lat` / `start_lon` | ✅ API 给 |
| `location_country` | ✅ 由 API 坐标交现有 `backfill` 反查 |
| `moving_time` | ✅ 可由 `pauseList` + 时间戳算 |
| `name` / 各类统计 / 设备 | ✅ `summary` 全有，且更全 |
| 仅 FIT 独有 | 仅**逐点海拔**（frequencyList 无逐点 altitude，只有 `summary.elevGain` 总爬升）→ 海拔剖面图建议保留 FIT |

## 2. 重构方案（第二步）

### 2.1 复用现有写入契约，零改 DB schema

`update_or_create_activity`（db.py）接收动态命名元组，仅需字段：
`id, type, name, distance, moving_time, elapsed_time, start_date, start_date_local, start_latlng(.lat/.lon), average_heartrate, average_speed, elevation_gain, map.summary_polyline, source, location_country`

→ 无需改 `Activity` 模型、无需改前端，仅从 `detail/query` JSON 构造满足该契约的命名元组即可。

### 2.2 新数据流

```
fetch_activity_ids_types()                 # 已有: [[label_id, sport_type], ...]
        │ (并发, 限流 10, 含 token 续期)
        ▼
fetch_activity_detail(label_id, sport_type)  # 新增: POST activity/detail/query
        │
        ▼
build_activity_namedtuple(detail)          # 新增: JSON → 命名元组(满足上述契约)
        │
        ▼
Generator.sync_from_coros_details(details)  # 新增: 循环 update_or_create + backfill 反查地名
```

### 2.3 涉及文件改动（已实现）

| 文件 | 改动 |
|---|---|
| `run_page/coros_api_sync.py` | ① `COROS_URL_DICT` 加 `DETAIL_QUERY_URL`；② `Coros` 加 `fetch_activity_detail()`（POST，含 401 续期）；③ 新增 `build_coros_activity_namedtuple()`（含 cm→m 距离换算、`average_speed=distance/moving_time` 统一 m/s、`elapsed_time` 优先 `totalTime`）；④ 新增 `download_and_generate_via_api()`（upsert + `backfill_location_country` + 导出 JSON）；⑤ CLI 加 `--api` 开关 |
| `run_page/generator/db.py` | 复用现有 `update_or_create_activity` 与 `backfill_location_country`，无需改动 |
| `run_page/utils.py` | 无需改动；API 路径复用 `Generator.load()` 导出 JSON，与 `make_activities_file` 输出格式一致 |

> **实现取舍（相对原计划微调）**：原定「默认走新路径」改为 **`--api` 显式开关、默认仍走 FIT 路径**。理由：不破坏现有同步行为（尤其方案 A 会丢失逐点海拔剖面），待 `--api` 稳定后再翻默认。

### 2.4 字段映射（detail → 命名元组）

| 目标字段 | 来源 | 处理 | 验证 |
|---|---|---|---|
| `id` (run_id) | `summary.startTimestamp` | ×10 → int | ✅ 与 FIT 同 id（尾数差因秒级截断） |
| `name` | `summary.name` | 直接（网站自定义名 ✅；FIT 侧恒为空，属净增强） | ✅ |
| `type` | `summary.sportType` | 经 `COROS_SPORT_TYPE_DICT`（已覆盖跑步/骑行/游泳/雪上/水上/攀岩等 40+ 类型，产出 `config.TYPE_DICT` 合法键）→ 由 `generator/db.py` 统一归一化为展示名；未知类型打 warning 并回退 `training` | ✅ 见 §4.1（已修复旧白名单会把 trail_running/climbing/… 打回 training 的 bug） |
| `distance` | `summary.distance` | **÷100（COROS 返回厘米 cm → 米 m）** | ✅ 实测 742910→7429.1m，与 FIT 完全一致 |
| `moving_time` | `summary.workoutTime` | ÷100→秒→timedelta（A/B 等价，已与 FIT 一致） | ✅ 2821.84s |
| `elapsed_time` | `summary.totalTime`（优先） | ÷100→秒→timedelta；缺失时回退 `endTimestamp-startTimestamp`÷100 | ✅ 直接读官方总经过时间（含暂停），兜底相减 |
| `start_date` | `startTimestamp` | ÷100→UTC ISO | ✅ |
| `start_date_local` | `summary.timezone` 字段 | **优先用官方 `timezone`**：以「15 分钟」为单位编码 UTC 偏移（`32 → 32*15min = 480min = UTC+8`），`start_utc + timezone*15min`；该字段缺失时才回退坐标反查 | ✅ 实测全 332 条均带 `timezone=32`（=UTC+8），与 FIT 一致 |
| `start_latlng` | `frequencyList[0]` 解码 | `start_point(lat/1e7, lon/1e7)` | ✅ 与 FIT 一致 |
| `average_heartrate` | `summary.avgHr` | — | ✅ |
| `average_speed` | `distance(m) / moving_time(s)` | **统一为 m/s**；不直接用 `summary.avgSpeed`（其单位随运动类型变：跑步为 s/km、其余为 km/h×100），改由已知单位字段算出，对所有运动类型一致 | ✅ 实测跑步 2.45/2.63、骑行 5.61、徒步 0.481 m/s 均与 COROS 吻合 |
| `elevation_gain` | `summary.elevGain` | 直接（**米 m**，无需换算） | ✅ 2==2 |
| `map.summary_polyline` | `frequencyList` 全部点 | `polyline.encode([(lat,lon)])` | ✅ 2752 vs 2746 点，同源 |
| `source` | — | `"coros"` | ✅ |
| `location_country` | — | `""`，交现有 `backfill` 反查 | ✅ |

### 2.5 与现有数据兼容

- run_id 一致（见 1.3）→ 旧 FIT 记录按同 run_id 命中并 upsert（顺带补上 `name`）。
- 其他同步源（garmin/keep/…）完全不受影响。

## 3. 待拍板的取舍：方案 A vs B

- **方案 A（纯 API 替代）**：彻底不下载 FIT。
  - 收益：更快、无二进制文件、白捡 `name`/`device`/`calorie`/`cadence` 等；
  - 代价：丢失**逐点海拔剖面**（前端海拔图退化为仅总爬升）。
- **方案 B（混合）**：仍下载 FIT 仅取海拔/高精度，同时用 `detail/query` 补 `name`+统计。
  - 收益：零数据损失；
  - 代价：API 调用翻倍、保留 FIT 解析依赖。

## 4. 单位核对（已通过交叉检查坐实）

用 `_test_api_vs_fit.py`（API 路径 vs FIT 解析链）抽「力量训练 402」与「跑步 100 含坐标」两条活动交叉验证，已钉死单位：

| 字段 | COROS 原始单位 | 转换 | 实测证据 |
|---|---|---|---|
| `distance` | 厘米 cm | ÷100 → m | 742910 → 7429.1 m（=FIT） |
| `average_speed` | 由 `distance/moving_time` 直接算 | 天然 m/s，不用 `avgSpeed` | 见下方「avgSpeed 单位坑」 |
| `elevGain` | 米 m | 无需换算 | 2 == 2 |
| `totalTime` / `workoutTime` | 1/10 秒（decisecond） | ÷100 → 秒 | totalTime→elapsed、workoutTime→moving |
| `timezone` | UTC 偏移，15 分钟/单位 | `start_utc + timezone*15min`（实测 `32`=480min=UTC+8） | 直接用官方字段，免坐标反查、室内/海外活动也准、自动处理历史 DST |

#### `summary.timezone` 编码（已采用）

诊断脚本 `diag_coros_tz.py` 实拉 10 条活动，确认 `summary.timezone` **全为 `32`**，即 COROS 以 **15 分钟为单位**编码 UTC 偏移：

```
offset(分钟) = timezone值 × 15      →  32 × 15 = 480 min = UTC+8
offset(秒)   = timezone值 × 900
start_date_local = start_utc + timedelta(minutes=timezone×15)
```

- 旧方案 `parse_datetime_to_local` 依赖 `tzfpy` 坐标反查 + `datetime.now().utcoffset()`，**脆弱且对历史 DST 活动偏差 1 小时**；
- 新方案直接用官方字段，**无外部依赖、无坐标要求（室内 402 也准确）、偏移即活动当时真实值**；
- 仅当 `timezone` 字段缺失时才回退坐标反查作为兜底。

> `startTimestamp` 单位 1/10 秒（`÷100`）此前已数学验证；本次实测 `start_date`/`start_date_local` 与 FIT 完全一致。

#### `summary.avgSpeed` 单位坑（已弃用该字段）

对 332 条活动做「不预设单位」的交叉验证（`diag_coros_speed.py`：用 `distance/workoutTime` 反推各候选单位）发现，`avgSpeed` 的单位**随运动类型变化**，不能一刀切：

| 运动 | sportType | avgSpeed 单位 | 实测 |
|---|---|---|---|
| 跑步 | 100 | 配速 s/km（基于 moving） | 408.46 → 2.45 m/s |
| 徒步 | 104 | 速度 km/h×100 | 173.0 → 0.481 m/s |
| 骑行 | 200 | 速度 km/h×100 | 2020 → 5.61 m/s |

旧代码一律 `1000/avgSpeed` 只对跑步正确，会把骑行/徒步等算错约 12 倍。**最终决定不再解析 `avgSpeed`**，改用 `distance(m)/moving_time(s)` 直接得 m/s：单位天然统一、对所有运动类型一致，且与全仓库其他同步源（garmin/keep/codoon/…）的 `average_speed`(m/s) 约定对齐。入库阶段（`generator/db.py`）对 `average_speed` 原样存储、**不做二次归一**，因此单位必须在取数阶段就统一。`maxSpeed` 同口径存在同样的坑；`avgPace` 跑步实测为 0，均不适合作统一来源。

### 4.1 `COROS_SPORT_TYPE_DICT` 数字映射（已实现）

产出的值均为 `config.TYPE_DICT` 的合法键，交由 `generator/db.py` 统一归一化为展示名；未知类型打 warning 并回退 `training`。

> ⚠️ **已修复的 bug**：旧版在字典之后还有一段白名单
> `if type_str not in ("running","cycling","swimming","walking","hiking","training"): type_str = "training"`，
> 会把 `trail_running`/`climbing`/`Pool Swim`/`Ski` 等全部打回 `training`，使字典修正失效。现已删除该白名单，直接信任字典产出。

| sportType | 映射 | 说明 |
|---|---|---|
| 100 / 101 / 103 | running | 户外跑 ✅实测 / 室内跑 / 田径场跑 |
| 102 | trail_running | 越野跑 |
| 104 | hiking | 徒步 ✅实测 |
| 105 | mountaineering | 登山 |
| 106 | climbing | 攀爬 |
| 200 / 202 / 203 / 205 / 299 | cycling | 户外/公路电助/砾石/山地电助/头盔骑行 ✅实测(200) |
| 201 | indoor_cycling | 室内骑行 |
| 204 | Mountain Bike | 山地骑行 |
| 300 | Pool Swim | 泳池游泳 |
| 301 | Open Water | 开放水域 |
| 400 / 401 / 402 | training | 健身有氧 / GPS 有氧 / 力量训练 ✅实测(402) |
| 500 / 502 / 503 / 10002 | Ski | 滑雪 / 越野滑雪 / 滑雪登山 / 旧版滑雪登山 |
| 501 | Snowboard | 单板 |
| 700 / 701 | rowing | 划船 / 室内划船 |
| 702 / 704 | kayaking | 白水 / 静水 |
| 705 / 706 | training | 风帆 / 速度冲浪 |
| 800 / 801 / 10003 | climbing | 室内攀岩 / 抱石 / 多段攀岩 |
| 900 | walking | 步行 |
| 901 / 902 / 98 | training | 跳绳 / 爬楼梯 / 自定义 |
| 10000 | triathlon | 铁人三项 |
| 10001 | multisport | 多项运动 |

> sportType 100/200/104/402 已经实测验证；其余为按语义补全。运行时遇到未覆盖的数字会打印 `[warn] unknown COROS sportType=...` 并回退 `training`（不会崩溃）。

## 5. 验证/落地方法

1. 实现后先小范围 dry-run（单条 `labelId`）打印构造出的命名元组字段，核对单位。
2. 确认 `summary_polyline` 在 geojson.io 渲染正确。
3. 全量跑前先 `--api` 开关灰度，对比新旧路径产出的 run_id 是否一致（无重复行）。
4. 若选方案 A，确认前端海拔图降级可接受。

## 6. 清理记录（本次）

已删除调试期产物：
- `run_page/_probe_detail_query.py`（探测脚本）
- `run_page/coros_export_track.py`（轨迹导出工具）
- `run_page/_check_fit.py`（FIT 检查脚本）
- `run_page/track_478689944217354255.csv`（导出数据）
- `run_page/track_478689944217354255.geojson`（导出数据）
