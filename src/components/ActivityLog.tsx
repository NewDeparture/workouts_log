import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { Activity, SportFilter } from '../types'
import { formatPace, formatSwimPace } from '../hooks/useActivities'
import { useLocale } from '../hooks/useLocale'
import { typeIcon, typeLabel, typeColor, isGymType } from '../sportMeta'

interface ActivityLogProps {
  activities: Activity[]
  years: number[]
  year: number | null
  setYear: (y: number | null) => void
  selectedActivity?: Activity | null
  onSelectActivity?: (a: Activity | null) => void
  filter?: SportFilter
}

const PAGE_SIZE = 16

type DistanceFilter = 'all' | '5' | '10' | '20' | '40'



function parseTimeSecs(t: string): number {
  if (!t) return 0
  const timePart = t.includes(' ') ? t.split(' ')[1] : t
  const parts = timePart.split('.')[0].split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}


// 配速拆分为「数值 + 单位」两部分，便于将单位弱化处理（参照距离字段的显示方式）
function paceParts(type: Activity['type'], speed: number): { value: string; unit: string } {
  if (type === 'Run') return { value: formatPace(speed), unit: '' }
  if (type === 'Swim') {
    const s = formatSwimPace(speed) // 形如 2'00"/100m
    const i = s.indexOf('"')
    return i >= 0 ? { value: s.slice(0, i + 1), unit: s.slice(i + 1) } : { value: s, unit: '' }
  }
  // 配速数值始终显示 3 位数字：整数部分 1 位 → 小数 2 位；整数部分 2 位 → 小数 1 位
  const kmh = speed * 3.6
  return { value: kmh >= 10 ? kmh.toFixed(1) : kmh.toFixed(2), unit: 'km/h' }
}

// 根据 start_date_local 的小时数划分五个时段
function timePeriod(startLocal: string, locale: 'zh' | 'en'): string {
  const hour = parseInt(startLocal.slice(11, 13), 10)
  if (hour >= 5 && hour < 8) return locale === 'zh' ? '清晨' : 'Early Morning'
  if (hour >= 8 && hour < 12) return locale === 'zh' ? '上午' : 'Morning'
  if (hour >= 12 && hour < 17) return locale === 'zh' ? '下午' : 'Afternoon'
  if (hour >= 17 && hour < 20) return locale === 'zh' ? '傍晚' : 'Evening'
  return locale === 'zh' ? '深夜' : 'Late Night'
}

// 名称：优先使用原始 name；缺失时按「时段 + 运动类型」组合命名
function activityName(a: Activity, locale: 'zh' | 'en'): string {
  if (a.name && a.name.trim()) return a.name
  const period = timePeriod(a.start_date_local, locale)
  const type = typeLabel(a.type, locale)
  return locale === 'zh' ? `${period}${type}` : `${period} ${type}`
}

// 运动类型胶囊：文字超出时，在胶囊内部左右循环滚动（marquee），始终固定宽度；未超出则静态显示
function TypePill({ type, locale }: { type: Activity['type']; locale: 'zh' | 'en' }) {
  const windowRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const label = typeLabel(type, locale)
  useEffect(() => {
    const el = windowRef.current
    if (!el) return
    setOverflow(Math.max(0, el.scrollWidth - el.clientWidth))
  }, [label])
  // 短标签（中文 ≤3 字）永不启用滚动：单个 emoji 的渲染宽度在不同系统上可能让短文本
  // 产生亚像素溢出（如「🧗登山」），被误判为需滚动后内层会挂上 marquee 类；鼠标悬停时
  // 该层触发 transform 动画、被提升为合成层，文字抗锯齿由子像素退化为灰度，看起来
  // 「更细、字体不一样」。以标签长度兜底可让所有短类型无论 emoji 宽度都保持静态一致。
  const scrolling = label.length > 3 && overflow > 4
  // 滚动速度恒定（约 14px/s），过短的文本也保证最低时长
  const duration = Math.max(2.5, overflow / 14)
  return (
    <span
      className="type-marquee-pill inline-flex align-middle text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: typeColor(type) + '22', color: typeColor(type) }}
    >
      <span ref={windowRef} className="inline-block max-w-[9ch] overflow-hidden whitespace-nowrap">
        <span
          className={`inline-block whitespace-nowrap${scrolling ? ' type-marquee-content' : ''}`}
          style={
            scrolling
              ? ({
                  '--marquee-distance': `-${overflow}px`,
                  '--marquee-duration': `${duration}s`,
                } as CSSProperties)
              : undefined
          }
        >
          {typeIcon(type)}{label}
        </span>
      </span>
    </span>
  )
}

export function ActivityLog({ activities, years, year, setYear, selectedActivity, onSelectActivity, filter = 'all' }: ActivityLogProps) {
  const { t, locale } = useLocale()
  const [page, setPage] = useState(0)
  const [distFilter, setDistFilter] = useState<DistanceFilter>('all')
  const [gymTypeFilter, setGymTypeFilter] = useState<string>('all')

  const isGym = filter === 'Gym'
  // ELEVATION（爬升）列在所有、跑步、骑行、徒步分类下显示（健身分类无此字段）
  const showElevation = filter === 'all' || filter === 'Run' || filter === 'Ride' || filter === 'Hike'

  const distFiltered = activities.filter((a) => {
    if (isGym) return true
    const km = a.distance / 1000
    switch (distFilter) {
      case '5': return km >= 5
      case '10': return km >= 10
      case '20': return km >= 20
      case '40': return km >= 40
      default: return true
    }
  }).filter((a) => {
    if (!isGym || gymTypeFilter === 'all') return true
    return a.type === gymTypeFilter
  })

  const sorted = [...distFiltered].sort(
    (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
  )

  useEffect(() => {
    if (selectedActivity) {
      const idx = sorted.findIndex(a => a.run_id === selectedActivity.run_id)
      if (idx >= 0) {
        setPage(Math.floor(idx / PAGE_SIZE))
      } else {
        setDistFilter('all')
      }
    }
  }, [selectedActivity?.run_id])

  // 切换运动类型（filter）时把页码重置到第一页，避免停留在上一类型遗留的越界页码
  useEffect(() => {
    setPage(0)
  }, [filter])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const gymTypes = Array.from(new Set(activities.filter(a => isGymType(a.type)).map(a => a.type)))

  const logTitle = filter === 'Run'  ? (locale === 'zh' ? '跑步记录' : 'Run Log')
    : filter === 'Ride' ? (locale === 'zh' ? '骑行记录' : 'Ride Log')
    : filter === 'Gym'  ? (locale === 'zh' ? '健身记录' : 'Gym Log')
    : t('activityLog')

  // 当前运动类型名称，用于空状态文案
  const sportName = locale === 'zh'
    ? (filter === 'Run' ? '跑步' : filter === 'Ride' ? '骑行' : filter === 'Hike' ? '徒步' : filter === 'Gym' ? '健身' : '运动')
    : (filter === 'Run' ? 'running' : filter === 'Ride' ? 'riding' : filter === 'Hike' ? 'hiking' : filter === 'Gym' ? 'gym' : 'sport')

  // 选中年份但当前运动类型在该年无记录时，列表居中提示
  const emptyMessage = sorted.length === 0
    ? (year != null
        ? (locale === 'zh' ? `${year} 年暂无${sportName}记录哦` : `No ${sportName} records in ${year}`)
        : (locale === 'zh' ? `暂无${sportName}记录哦` : `No ${sportName} records yet`))
    : null

  const colCount = isGym ? 7 : (showElevation ? 8 : 7)

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">{logTitle}</h2>
        <span className="text-sm text-[var(--color-muted)]">
          {sorted.length > 0
            ? `${t('showing')} ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, sorted.length)} ${t('of')} ${sorted.length}`
            : (locale === 'zh' ? '暂无记录' : 'No records')}
        </span>
      </div>

      {/* Year tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setYear(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium uppercase transition-all ${year === null ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
        >
          {t('all')}
        </button>
        {years.map((y) => (
          <button key={y} onClick={() => { setYear(y); setPage(0) }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${year === y ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Gym: type filter / Normal: distance filter */}
      {isGym ? (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button onClick={() => { setGymTypeFilter('all'); setPage(0) }}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${gymTypeFilter === 'all' ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
          >
            {t('all')}
          </button>
          {gymTypes.map(gt => (
            <button key={gt} onClick={() => { setGymTypeFilter(gt === gymTypeFilter ? 'all' : gt); setPage(0) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${gymTypeFilter === gt ? 'text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
              style={gymTypeFilter === gt ? { backgroundColor: typeColor(gt) } : {}}
            >
              {typeLabel(gt, locale)}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-5">
          {([['all', t('all')], ['5', '5km+'], ['10', '10km+'], ['20', '20km+'], ['40', '40km+']] as [DistanceFilter, string][]).map(([val, label]) => (
            <button key={val} onClick={() => { setDistFilter(val); setPage(0) }}
              className={`px-3 py-1 rounded-full text-xs font-medium uppercase transition-all ${distFilter === val ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
              <tr className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className={`pb-3 font-medium text-left ${isGym ? 'w-[146px]' : 'w-[136px]'}`}>{t('date')}</th>
                <th className={`pb-3 font-medium text-left ${isGym ? 'w-[200px]' : ''}`}>{t('name')}</th>
                <th className={`pb-3 font-medium text-center ${isGym ? 'w-[128px]' : 'w-[110px]'}`}>{t('type')}</th>
                {isGym ? (
                  <>
                    <th className="pb-3 font-medium w-[128px] text-center">{t('distance')}</th>
                    <th className="pb-3 font-medium w-[128px] text-center">{t('duration')}</th>
                    <th className="pb-3 font-medium w-[72px] text-center">{t('calories')}</th>
                    <th className="pb-3 font-medium w-[72px] text-center">{t('hr')}</th>
                  </>
                ) : (
                  <>
                    <th className="pb-3 font-medium w-[96px] text-center">{t('distance')}</th>
                    <th className="pb-3 font-medium w-[104px] text-center">{t('duration')}</th>
                    {showElevation && <th className="pb-3 font-medium w-[96px] text-center">{t('elevation')}</th>}
                    <th className="pb-3 font-medium w-[88px] text-center">{filter === 'Run' ? t('pace') : t('speed')}</th>
                    <th className="pb-3 font-medium w-[60px] text-center">{t('hr')}</th>
                  </>
                )}
              </tr>
          </thead>
          <tbody>
            {pageData.length > 0 ? (
              pageData.map((a) => (
              <tr
                key={a.run_id}
                onClick={() => onSelectActivity?.(selectedActivity?.run_id === a.run_id ? null : a)}
                className={`border-b border-[var(--color-border)]/30 cursor-pointer transition-colors ${
                  selectedActivity?.run_id === a.run_id
                    ? 'bg-[var(--color-accent)]/10 border-l-2 border-l-[var(--color-accent)]'
                    : 'hover:bg-[var(--color-bg)]'
                }`}
              >
                <td className="py-3 text-[var(--color-muted)] text-left">{a.start_date_local.slice(0, 16).replace('T', ' ')}</td>
                <td className="py-3">{activityName(a, locale)}</td>
                <td className="py-3 text-center">
                  <TypePill type={a.type} locale={locale} />
                </td>
                {isGym ? (
                  <>
                    <td className="py-3 font-mono font-medium text-center">
                      {a.distance == null || a.distance === 0 ? (
                        <span className="text-[var(--color-muted)]">---</span>
                      ) : (() => {
                        const km = a.distance / 1000
                        const text = km >= 10 ? km.toFixed(1) : km.toFixed(2)
                        return <>{text}</>
                      })()}
                    </td>
                    <td className="py-3 font-mono font-medium text-center">
                      {Math.round(parseTimeSecs(a.moving_time) / 60)}
                      <span className="text-[var(--color-muted)] ml-1 font-normal text-xs">min</span>
                    </td>
                    <td className="py-3 font-mono font-medium text-center">
                      {a.calories != null ? (
                        Math.round(a.calories)
                      ) : (
                        <span className="text-[var(--color-muted)]">---</span>
                      )}
                    </td>
                    <td className="py-3 text-center">
                      {a.average_heartrate != null ? (
                        <span className="font-mono font-medium">{String(Math.round(a.average_heartrate)).padStart(3, '0')}</span>
                      ) : (
                        <span className="text-[var(--color-muted)]">---</span>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-3 font-mono font-medium text-center">
                      {a.distance == null || a.distance === 0 ? (
                        <span className="text-[var(--color-muted)]">---</span>
                      ) : (() => {
                        const km = a.distance / 1000
                        const text = km >= 10 ? km.toFixed(1) : km.toFixed(2)
                        return <>{text}</>
                      })()}
                    </td>
                    <td className="py-3 font-mono font-medium text-center">
                      {Math.round(parseTimeSecs(a.moving_time) / 60)}
                      <span className="text-[var(--color-muted)] ml-1 font-normal text-xs">min</span>
                    </td>
                    {showElevation && (
                      <td className="py-3 font-mono font-medium text-center">
                        {a.elevation_gain != null ? (
                          <>{Math.round(a.elevation_gain)}<span className="text-[var(--color-muted)] ml-1 font-normal text-xs">m</span></>
                        ) : (
                          <span className="text-[var(--color-muted)]">--</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 font-mono font-medium text-center">
                      {a.type === 'Training' || a.average_speed == null || a.average_speed === 0 ? (
                        <span className="text-[var(--color-muted)]">---</span>
                      ) : (() => {
                        const p = paceParts(a.type, a.average_speed)
                        const showPaceUnit = filter !== 'all'
                        return <>{p.value}{showPaceUnit && p.unit && <span className="text-[var(--color-muted)] ml-1 font-normal text-xs">{p.unit}</span>}</>
                      })()}
                    </td>
                    <td className="py-3 text-center">
                      {a.average_heartrate != null ? (
                        <span className="font-mono font-medium">{String(Math.round(a.average_heartrate)).padStart(3, '0')}</span>
                      ) : (
                        <span className="text-[var(--color-muted)]">---</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
              ))
            ) : (
              <tr>
                <td colSpan={colCount} className="py-20 text-center text-sm text-[var(--color-muted)]">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sorted.length > 0 && (
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-5">
          <button onClick={() => setPage(0)} disabled={page === 0}
            className="w-9 h-9 flex items-center justify-center text-2xl rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/40 disabled:opacity-30 transition-colors" title={locale === 'zh' ? '首页' : 'First'}>«</button>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
            className="w-9 h-9 flex items-center justify-center text-2xl rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/40 disabled:opacity-30 transition-colors" title={locale === 'zh' ? '上一页' : 'Prev'}>‹</button>
        </div>
        <span className="text-sm text-[var(--color-muted)]">{t('page')} {page + 1} {t('pageOf')} {totalPages} {t('pages')}</span>
        <div className="flex items-center gap-5">
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="w-9 h-9 flex items-center justify-center text-2xl rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/40 disabled:opacity-30 transition-colors" title={locale === 'zh' ? '下一页' : 'Next'}>›</button>
          <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
            className="w-9 h-9 flex items-center justify-center text-2xl rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)]/40 disabled:opacity-30 transition-colors" title={locale === 'zh' ? '末页' : 'Last'}>»</button>
        </div>
      </div>
      )}
    </div>
  )
}
