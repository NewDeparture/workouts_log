// 所有运动类型的统一元数据：图标(emoji)、中英文标签、主题色。
// 覆盖 config.TYPE_DICT 输出的规范类型，未知类型回退到图钉图标。

export interface SportMeta {
  icon: string
  zh: string
  en: string
  color: string
}

export const SPORT_META: Record<string, SportMeta> = {
  Run:            { icon: '🏃', zh: '跑步',     en: 'Run',          color: '#f97316' },
  'Trail Run':    { icon: '🏔️', zh: '越野跑',   en: 'Trail Run',    color: '#ea580c' },
  Ride:           { icon: '🚴', zh: '骑行',     en: 'Ride',         color: '#3b82f6' },
  VirtualRide:    { icon: '🚴', zh: '虚拟骑行', en: 'Virtual Ride', color: '#2563eb' },
  'Indoor Ride':  { icon: '🚴', zh: '室内骑行', en: 'Indoor Ride',  color: '#1d4ed8' },
  Hike:           { icon: '🥾', zh: '徒步',     en: 'Hike',         color: '#22c55e' },
  Swim:           { icon: '🏊', zh: '游泳',     en: 'Swim',         color: '#06b6d4' },
  Rowing:         { icon: '🚣', zh: '划船',     en: 'Rowing',       color: '#0891b2' },
  RoadTrip:       { icon: '🚗', zh: '驾车',     en: 'Road Trip',    color: '#64748b' },
  Kayaking:       { icon: '🛶', zh: '皮划艇',   en: 'Kayaking',     color: '#0ea5e9' },
  Snowboard:      { icon: '🏂', zh: '单板滑雪', en: 'Snowboard',    color: '#0ea5e9' },
  Ski:            { icon: '⛷️', zh: '滑雪',     en: 'Ski',          color: '#0284c7' },
  WeightTraining: { icon: '🏋️', zh: '力量训练', en: 'Weight Training', color: '#f97316' },
  Workout:        { icon: '💪', zh: '综合训练', en: 'Workout',      color: '#c026d3' },
  StairStepper:   { icon: '🪜', zh: '楼梯机',   en: 'Stair Stepper', color: '#3b82f6' },
  WaterSport:     { icon: '🌊', zh: '水上运动', en: 'Water Sport',  color: '#06b6d4' },
  Flight:         { icon: '✈️', zh: '飞行',     en: 'Flight',       color: '#94a3b8' },
  // 热力图中把其余类型归并为 "Training" 显示组
  Training:       { icon: '🏋️', zh: '训练',     en: 'Training',     color: '#db2777' },
}

// ---- 运动大类：RUN / RIDE / HIKE 各自包含其全部子类型，其余一切类型均归入 GYM ----
export type SportCategory = 'run' | 'ride' | 'hike' | 'gym'

export const SPORT_CATEGORY: Record<string, SportCategory> = {
  // 跑步：户外跑、运动场跑、跑步机、越野跑、山地跑等
  Run: 'run',
  'Trail Run': 'run',
  'Treadmill Run': 'run',
  'treadmill_running': 'run',
  'Indoor Run': 'run',
  'Mountain Run': 'run',
  // 骑行：公路、室内、虚拟、山地、电助力等
  Ride: 'ride',
  'Indoor Ride': 'ride',
  'VirtualRide': 'ride',
  'EBikeRide': 'ride',
  'Mountain Bike': 'ride',
  // 徒步：走路、健走、徒步、登山等
  Hike: 'hike',
  'Power Walk': 'hike',
  'power_walking': 'hike',
  'Mountaineering': 'hike',
  'mountaineering': 'hike',
}

export function categoryOf(type: string): SportCategory {
  return SPORT_CATEGORY[type] ?? 'gym'
}

export const isRunType = (t: string) => categoryOf(t) === 'run'
export const isRideType = (t: string) => categoryOf(t) === 'ride'
export const isHikeType = (t: string) => categoryOf(t) === 'hike'
export const isGymType = (t: string) => categoryOf(t) === 'gym'

const DEFAULT_ICON = '📌'
const DEFAULT_COLOR = '#6b7280'

export function typeIcon(type: string): string {
  return SPORT_META[type]?.icon ?? DEFAULT_ICON
}

export function typeLabel(type: string, locale: 'zh' | 'en'): string {
  const meta = SPORT_META[type]
  if (meta) return locale === 'zh' ? meta.zh : meta.en
  return type
}

export function typeColor(type: string): string {
  return SPORT_META[type]?.color ?? DEFAULT_COLOR
}
