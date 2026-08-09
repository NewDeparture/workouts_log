import { useEffect, useRef, useState, useMemo, memo } from 'react'
import { toPng } from 'html-to-image'
import * as polyline from '@mapbox/polyline'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Activity } from '../types'
import { getAvailableYears, formatDistance, parseMovingTime, formatPace } from '../hooks/useActivities'
import { useLocale } from '../hooks/useLocale'
import { BrandingBar } from './BrandingBar'
import { Reveal } from './Reveal'
import { categoryOf } from '../sportMeta'
import { buildTrackPathCache } from '../trackPaths'

const MAPBOX_TOKEN = 'pk.eyJ1IjoiYmVuLTI5IiwiYSI6ImNrZ3Q4Ym9mMDBqMGYyeXFvODV2dWl6YzQifQ.gSKoWF-fMjhzU67TuDezJQ'

// 与首页一致的四类运动分类（全部/跑步/骑行/徒步/健身）
type SportCat = 'run' | 'ride' | 'hike' | 'gym'

interface TracksPageProps {
  activities: Activity[]
  dark: boolean
  onBack: () => void
  onSelectActivity?: (a: Activity | null) => void
}

const TrackThumb = memo(function TrackThumb({ path, color, selected, onClick, title }: {
  path: string; color: string; selected: boolean; onClick: () => void; title: string
}) {
  // 自适应：svg 撑满所在网格列（aspect-square 保证正方形），坐标系统一为 100（与 polylineToPathD 一致）
  if (!path) return null
  return (
    <div
      className={`cursor-pointer group relative aspect-square rounded transition-all ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]' : ''}`}
      onClick={onClick}
      title={title}
    >
      <svg viewBox="0 0 100 100" className={`w-full h-full transition-opacity ${selected ? 'opacity-100' : 'group-hover:opacity-100 opacity-60'}`}>
        <path d={path} fill="none" stroke={color}
          strokeWidth={selected ? '2' : '1.5'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
})

function TrackMap({ activity, activities, dark }: {
  activity: Activity | null; activities: Activity[]; dark?: boolean
}) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const mapReady = useRef(false)
  const activityRef = useRef(activity)
  const activitiesRef = useRef(activities)
  const style = dark !== false ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'

  activityRef.current = activity
  activitiesRef.current = activities

  // Stable callback ref — always reads latest data from refs
  const updateRoutes = useRef(() => {
    const m = map.current
    if (!m || !mapReady.current) return
    const act = activityRef.current
    const acts = activitiesRef.current
    ;['selected', 'all-routes'].forEach(id => {
      if (m.getLayer(id)) m.removeLayer(id)
      if (m.getSource(id)) m.removeSource(id)
    })
    if (act?.summary_polyline) {
      const coords = polyline.decode(act.summary_polyline).map(([lat, lng]) => [lng, lat])
      m.addSource('selected', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } })
      m.addLayer({ id: 'selected', type: 'line', source: 'selected', paint: { 'line-color': getColor(act), 'line-width': 3, 'line-opacity': 0.9 } })
      const bounds = new mapboxgl.LngLatBounds()
      coords.forEach(c => bounds.extend(c as [number, number]))
      m.fitBounds(bounds, { padding: 50, maxZoom: 14 })
      return
    }
    const features = acts.filter(a => a.summary_polyline).map(a => ({
      type: 'Feature' as const,
      properties: { type: a.type },
      geometry: { type: 'LineString' as const, coordinates: polyline.decode(a.summary_polyline!).map(([lat, lng]) => [lng, lat]) },
    }))
    if (!features.length) return
    m.addSource('all-routes', { type: 'geojson', data: { type: 'FeatureCollection', features } })
    m.addLayer({ id: 'all-routes', type: 'line', source: 'all-routes', paint: {
      'line-color': ['match', ['get', 'type'], 'Run', '#f97316', 'Ride', '#3b82f6', 'Hike', '#22c55e', 'Walking', '#22c55e', 'Mountaineering', '#22c55e', '#a855f7'],
      'line-width': 1.2, 'line-opacity': 0.5,
    }})
    const allCoords = features.flatMap(f => f.geometry.coordinates as [number, number][])
    if (!allCoords.length) return
    const lngs = allCoords.map(c => c[0]).sort((a, b) => a - b)
    const lats = allCoords.map(c => c[1]).sort((a, b) => a - b)
    const t = Math.floor(lngs.length * 0.1)
    m.fitBounds(new mapboxgl.LngLatBounds([lngs[t], lats[t]], [lngs[lngs.length - 1 - t], lats[lats.length - 1 - t]]), { padding: 30, maxZoom: 13 })
  })

  // Init map once
  useEffect(() => {
    if (!mapContainer.current) return
    if (map.current) {
      // 切换主题：setStyle 会清空自定义图层，待新样式加载完成后重绘路线
      map.current.setStyle(style)
      map.current.once('style.load', () => {
        mapReady.current = true
        updateRoutes.current()
      })
      return
    }
    mapboxgl.accessToken = MAPBOX_TOKEN
    mapReady.current = false
    map.current = new mapboxgl.Map({ container: mapContainer.current, style, center: [108, 35], zoom: 3 })
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current.on('style.load', () => {
      mapReady.current = true
      updateRoutes.current()
    })
    return () => { map.current?.remove(); map.current = null; mapReady.current = false }
  }, [dark])

  // Re-render routes when selection or data changes
  useEffect(() => {
    if (mapReady.current) updateRoutes.current()
  }, [activity, activities])

  return <div ref={mapContainer} className="w-full h-full" />
}

function getColor(a: Activity): string {
  if (a.type === 'Run') { const km = a.distance / 1000; return km >= 40 ? '#ef4444' : km >= 20 ? '#f97316' : '#f97316' }
  if (a.type === 'Ride') return '#3b82f6'
  if (a.type === 'Hike' || a.type === 'Walking' || a.type === 'Mountaineering') return '#22c55e'
  return '#a855f7'
}

export function TracksPage({ activities, dark, onBack, onSelectActivity }: TracksPageProps) {
  const { locale } = useLocale()
  const allYears = getAvailableYears(activities)
  // 默认选择「全部」年份（null），展示所有轨迹；用户可点击具体年份筛选
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [sportFilter, setSportFilter] = useState<SportCat | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'distance'>('date')

  // 轨迹墙拥有专属青色主题：始终将 <html data-filter> 锁定为 'tracks'，
  // 使 --color-accent（含按钮色块与网页渐变背景）恒为青色，不随运动类型切换而改变。
  useEffect(() => {
    const html = document.documentElement
    const prev = html.dataset.filter
    html.dataset.filter = 'tracks'
    return () => { html.dataset.filter = prev }
  }, [])

  // Export
  const captureRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)

  // Year pagination — 轨迹墙单独使用 13 个上限（与 Heatmap 的 10 个独立）
  const MAX_YEARS = 13
  const [yearPage, setYearPage] = useState(0)
  const totalYearPages = Math.ceil(allYears.length / MAX_YEARS)
  const visibleYears = allYears.slice(yearPage * MAX_YEARS, yearPage * MAX_YEARS + MAX_YEARS)

  // Determine which sport categories exist
  const hasSport = (c: SportCat) => activities.some(a => categoryOf(a.type) === c)

  // Filtered base (year + sport category)
  const base = useMemo(() => activities.filter(a => {
    if (selectedYear !== null && new Date(a.start_date_local).getFullYear() !== selectedYear) return false
    if (sportFilter !== null && categoryOf(a.type) !== sportFilter) return false
    return true
  }), [activities, selectedYear, sportFilter])

  const withPolyline = useMemo(() => base.filter(a => a.summary_polyline && a.summary_polyline.length > 20), [base])

  // Stats for left panel
  const totalDist = base.reduce((s, a) => s + a.distance, 0)
  const totalTime = base.reduce((s, a) => s + parseMovingTime(a.moving_time), 0)
  const runs = base.filter(a => categoryOf(a.type) === 'run' && a.average_speed > 0)
  const avgPace = runs.length > 0 ? runs.reduce((s, a) => s + a.average_speed, 0) / runs.length : 0

  // 预计算所有轨迹的 SVG path（一次性，仅活动数据变化时重建）——对齐 RUN.LOG 的 route_svg_path
  const trackPathCache = useMemo(() => buildTrackPathCache(activities), [activities])

  // 全部轨迹（不聚类，保留所有；切换筛选时 path 已缓存，渲染仅 O(1) 读取）
  const tracks = useMemo(() => {
    return [...withPolyline].sort((a, b) =>
      sortBy === 'distance'
        ? b.distance - a.distance
        : new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
    )
  }, [withPolyline, sortBy])

  const handleSelectTrack = (a: Activity) => {
    setSelectedActivity(prev => prev?.run_id === a.run_id ? null : a)
    onSelectActivity?.(a)
  }

  const allSportTabs: { label: string; value: SportCat; color: string }[] = [
    { label: locale === 'zh' ? '跑步' : 'Run', value: 'run', color: '#f97316' },
    { label: locale === 'zh' ? '骑行' : 'Ride', value: 'ride', color: '#3b82f6' },
    { label: locale === 'zh' ? '徒步' : 'Hike', value: 'hike', color: '#22c55e' },
    { label: locale === 'zh' ? '健身' : 'Gym', value: 'gym', color: '#a855f7' },
  ]

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      {/* Top bar: back + title */}
      <Reveal y={20} delay={0}>
        <div className="flex items-center gap-4 mb-5">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            {locale === 'zh' ? '返回' : 'Back'}
          </button>
          <h1 className="text-lg font-bold shrink-0">{locale === 'zh' ? '轨迹墙' : 'Track Wall'}</h1>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5 items-start">
        {/* Left: stats + map */}
        <div className="flex flex-col gap-4">
          {/* Stats card */}
          <Reveal y={40} delay={100}>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
            <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider mb-3">
              {selectedYear ?? (locale === 'zh' ? '全部' : 'Total')}
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '活动' : 'Activities'}</p>
                <p className="text-2xl font-bold font-mono text-[var(--color-accent)]">{base.length}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '距离' : 'Distance'}</p>
                <p className="text-2xl font-bold font-mono">{formatDistance(totalDist)} <span className="text-sm font-normal text-[var(--color-muted)]">km</span></p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '时间' : 'Time'}</p>
                <p className="text-lg font-bold font-mono">{Math.floor(totalTime / 3600)}h {Math.floor((totalTime % 3600) / 60)}m</p>
              </div>
              {avgPace > 0 && (
                <div>
                  <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '均配速' : 'Avg Pace'}</p>
                  <p className="text-lg font-bold font-mono">{formatPace(avgPace)}</p>
                </div>
              )}
            </div>
          </div>
          </Reveal>

          {/* Activity detail — only when a single track is selected */}
          {selectedActivity && (
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '已选记录' : 'Selected'}</p>
                <button onClick={() => setSelectedActivity(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs font-semibold truncate mb-0.5">{selectedActivity.name}</p>
              <p className="text-[10px] text-[var(--color-muted)] mb-2">
                {new Date(selectedActivity.start_date_local).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                {' '}
                {new Date(selectedActivity.start_date_local).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '距离' : 'Distance'}</p>
                  <p className="text-base font-bold font-mono leading-tight">{(selectedActivity.distance / 1000).toFixed(2)} <span className="text-[10px] font-normal text-[var(--color-muted)]">km</span></p>
                </div>
                <div>
                  <p className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '时间' : 'Time'}</p>
                  <p className="text-base font-bold font-mono leading-tight">{(() => { const s = parseMovingTime(selectedActivity.moving_time); return `${Math.floor(s/3600) ? Math.floor(s/3600)+'h ' : ''}${Math.floor((s%3600)/60)}m` })()}</p>
                </div>
                {selectedActivity.average_speed > 0 && (
                  <div>
                    <p className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '配速' : 'Pace'}</p>
                    <p className="text-base font-bold font-mono leading-tight">{formatPace(selectedActivity.average_speed)} <span className="text-[10px] font-normal text-[var(--color-muted)]">/km</span></p>
                  </div>
                )}
                {selectedActivity.elevation_gain != null && selectedActivity.elevation_gain > 0 && (
                  <div>
                    <p className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '爬升' : 'Elev'}</p>
                    <p className="text-base font-bold font-mono leading-tight">{Math.round(selectedActivity.elevation_gain)} <span className="text-[10px] font-normal text-[var(--color-muted)]">m</span></p>
                  </div>
                )}
                {selectedActivity.average_heartrate != null && selectedActivity.average_heartrate > 0 && (
                  <div>
                    <p className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{locale === 'zh' ? '心率' : 'HR'}</p>
                    <p className="text-base font-bold font-mono leading-tight">{Math.round(selectedActivity.average_heartrate)} <span className="text-[10px] font-normal text-[var(--color-muted)]">bpm</span></p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Map */}
          <Reveal y={40} delay={200}>
            <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl overflow-hidden" style={{ height: 260 }}>
              <TrackMap activity={selectedActivity} activities={withPolyline} dark={dark} />
            </div>
          </Reveal>
        </div>

        {/* Right: track grid with year filter inside */}
        <div className="min-w-0">
          <Reveal y={40} delay={100}>
          <div ref={captureRef} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4">
          <style>{`
            .exporting,
            .exporting *,
            .exporting *::before,
            .exporting *::after {
              animation: none !important;
              transition: none !important;
            }
          `}</style>
          {/* Filter row 1: Year pills + export */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {totalYearPages > 1 && (
              <button onClick={() => setYearPage(p => Math.max(0, p - 1))} disabled={yearPage === 0}
                className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors px-1 text-base leading-none">
                ‹
              </button>
            )}
            <button onClick={() => setSelectedYear(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium uppercase transition-all border ${selectedYear === null ? 'bg-[var(--color-accent)] text-white border-transparent' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
              {locale === 'zh' ? '全部' : 'All'}
            </button>
            {visibleYears.map(yr => (
              <button key={yr} onClick={() => setSelectedYear(selectedYear === yr ? null : yr)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${selectedYear === yr ? 'bg-[var(--color-accent)] text-white border-transparent' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
                {yr}
              </button>
            ))}
            {totalYearPages > 1 && (
              <button onClick={() => setYearPage(p => Math.min(totalYearPages - 1, p + 1))} disabled={yearPage === totalYearPages - 1}
                className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors px-1 text-base leading-none">
                ›
              </button>
            )}
            <button
              onClick={async () => {
                if (!captureRef.current || exporting) return
                setExporting(true)
                try {
                  const el = captureRef.current
                  el.classList.add('exporting')
                  const prevOverflow = el.style.overflow
                  el.style.overflow = 'visible'
                  await new Promise(resolve => requestAnimationFrame(resolve))
                  const dataUrl = await toPng(el, { pixelRatio: 2, cacheBust: true })
                  el.classList.remove('exporting')
                  el.style.overflow = prevOverflow
                  const link = document.createElement('a')
                  const label = selectedYear ?? 'all'
                  link.download = `tracks-${label}.png`
                  link.href = dataUrl
                  link.click()
                } catch (err) {
                  console.error('Export failed:', err)
                } finally {
                  setExporting(false)
                }
              }}
              disabled={exporting}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-all ml-auto"
              title={locale === 'zh' ? '导出图片' : 'Export as image'}
            >
              {exporting ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
            </button>
          </div>

          {/* Filter row 2: Sport type filter */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4 pb-3 border-b border-[var(--color-border)]">
            {/* 占位箭头：与年份行的 ‹ 等宽，保证「ALL」横向对齐 */}
            {totalYearPages > 1 && <span className="px-1 text-base leading-none invisible">‹</span>}
            <button onClick={() => setSportFilter(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium uppercase transition-all border ${sportFilter === null ? 'bg-[var(--color-accent)] text-white border-transparent' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
              {locale === 'zh' ? '全部' : 'All'}
            </button>
            {allSportTabs.filter(t => hasSport(t.value)).map(({ label, value }) => (
              <button key={value} onClick={() => setSportFilter(sportFilter === value ? null : value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${sportFilter === value ? 'bg-[var(--color-accent)] text-white border-transparent' : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]'}`}>
                {label}
              </button>
            ))}
          </div>

          {tracks.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] py-8 text-center">{locale === 'zh' ? '暂无轨迹数据' : 'No tracks found'}</p>
          ) : (
            <div key={`${selectedYear}-${sportFilter}-${sortBy}`} className="grid-enter grid gap-x-2 gap-y-4"
              style={{ gridTemplateColumns: `repeat(${selectedYear === null ? 16 : 12}, minmax(0, 1fr))` }}>
              {tracks.map(a => {
                const path = trackPathCache.get(a.run_id)
                if (!path) return null
                return (
                  <TrackThumb
                    key={a.run_id}
                    path={path}
                    color={getColor(a)}
                    selected={selectedActivity?.run_id === a.run_id}
                    onClick={() => handleSelectTrack(a)}
                    title={`${a.name} — ${(a.distance / 1000).toFixed(1)} km`}
                  />
                )
              })}
            </div>
          )}

          {/* Branding bar (export only) */}
          <div className="mt-6"><BrandingBar /></div>

          {/* Legend + sort */}
          {tracks.length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center gap-4 text-xs text-[var(--color-muted)] flex-wrap">
              {sportFilter === null || sportFilter === 'run' ? <>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#f97316] rounded" />{locale === 'zh' ? '跑步' : 'Run'}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#ef4444] rounded" />{locale === 'zh' ? '跑步 >20km' : 'Run >20km'}</span>
              </> : null}
              {(sportFilter === null || sportFilter === 'ride') && hasSport('ride') && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#3b82f6] rounded" />{locale === 'zh' ? '骑行' : 'Ride'}</span>}
              {(sportFilter === null || sportFilter === 'hike') && hasSport('hike') && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#22c55e] rounded" />{locale === 'zh' ? '徒步' : 'Hike'}</span>}
              <div className="ml-auto flex items-center gap-1">
                <span>{tracks.length} {locale === 'zh' ? '条路线' : 'routes'}</span>
                <span className="mx-1.5 text-[var(--color-border)]">·</span>
                <button onClick={() => setSortBy('date')}
                  className={`transition-colors ${sortBy === 'date' ? 'text-[var(--color-text)] font-medium' : 'hover:text-[var(--color-text)]'}`}>
                  {locale === 'zh' ? '时间' : 'Date'}
                </button>
                <span className="text-[var(--color-border)]">/</span>
                <button onClick={() => setSortBy('distance')}
                  className={`transition-colors ${sortBy === 'distance' ? 'text-[var(--color-text)] font-medium' : 'hover:text-[var(--color-text)]'}`}>
                  {locale === 'zh' ? '距离' : 'Dist'}
                </button>
              </div>
            </div>
          )}
        </div>{/* end track grid card */}
        </Reveal>
        </div>{/* end right column */}
      </div>
    </div>
  )
}
