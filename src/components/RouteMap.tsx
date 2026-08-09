import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import * as polyline from '@mapbox/polyline'
import type { Activity } from '../types'
import { categoryColorOf } from '../sportMeta'

const MAPBOX_TOKEN =
  'pk.eyJ1IjoiYmVuLTI5IiwiYSI6ImNrZ3Q4Ym9mMDBqMGYyeXFvODV2dWl6YzQifQ.gSKoWF-fMjhzU67TuDezJQ'

interface RouteMapProps {
  activities: Activity[]
  selectedActivity?: Activity | null
  dark?: boolean
  onClearSelection?: () => void
}

export function RouteMap({ activities, selectedActivity, dark, onClearSelection }: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)

  const style = dark !== false
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11'

  useEffect(() => {
    if (!mapContainer.current) return

    if (map.current) {
      map.current.setStyle(style)
      return
    }

    mapboxgl.accessToken = MAPBOX_TOKEN
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style,
      center: [106.55, 29.56],
      zoom: 10,
    })

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current.addControl(new mapboxgl.FullscreenControl(), 'top-right')

    map.current.on('style.load', () => {
      updateRoutes()
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [dark])

  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      updateRoutes()
    } else {
      map.current?.once('style.load', () => updateRoutes())
    }
  }, [activities, selectedActivity])

  function updateRoutes() {
    if (!map.current) return

    // Remove existing source/layer
    if (map.current.getLayer('routes')) map.current.removeLayer('routes')
    if (map.current.getSource('routes')) map.current.removeSource('routes')
    if (map.current.getLayer('selected')) map.current.removeLayer('selected')
    if (map.current.getSource('selected')) map.current.removeSource('selected')

    // If a single activity is selected, show only that route highlighted
    if (selectedActivity?.summary_polyline) {
      const coords = polyline
        .decode(selectedActivity.summary_polyline)
        .map(([lat, lng]) => [lng, lat])

      map.current.addSource('selected', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      })

      map.current.addLayer({
        id: 'selected',
        type: 'line',
        source: 'selected',
        paint: {
          'line-color': categoryColorOf(selectedActivity.type),
          'line-width': 3,
          'line-opacity': 0.9,
        },
      })

      const bounds = new mapboxgl.LngLatBounds()
      for (const c of coords) bounds.extend(c as [number, number])
      map.current.fitBounds(bounds, { padding: 50, maxZoom: 14 })
      return
    }

    // Otherwise show all routes
    const features = activities
      .filter((a) => a.summary_polyline)
      .map((a) => {
        const coords = polyline
          .decode(a.summary_polyline!)
          .map(([lat, lng]) => [lng, lat])
        return {
          type: 'Feature' as const,
          properties: { type: a.type },
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        }
      })

    if (features.length === 0) return

    map.current.addSource('routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features,
      },
    })

    map.current.addLayer({
      id: 'routes',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': [
          'match',
          ['get', 'type'],
          'Run', '#f97316',
          'Trail Run', '#f97316',
          'Ride', '#3b82f6',
          'Hike', '#22c55e',
          'Walking', '#22c55e',
          'Mountaineering', '#22c55e',
          '#a855f7',
        ],
        'line-width': 1.5,
        'line-opacity': 0.6,
      },
    })

    // Fit bounds to majority of routes (ignore outliers).
    // 若当前 activities 跨多个年份（未筛选具体年份，即"全部"视图），聚焦最近一年避免范围过大；
    // 若集中在单一年份（用户已筛选具体年份，如 2024），则统计该年份全部记录，确保正确缩放。
    const years = new Set(
      activities
        .filter(a => a.start_date_local)
        .map(a => new Date(a.start_date_local).getFullYear())
    )
    const isSingleYear = years.size <= 1

    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const allCoords: [number, number][] = []
    for (const a of activities) {
      if (!a.summary_polyline) continue
      // 跨多年度时才限制为最近一年；已筛选具体年份则统计全部
      if (!isSingleYear && a.start_date_local && new Date(a.start_date_local) < oneYearAgo) continue
      const coords = polyline.decode(a.summary_polyline)
      if (coords.length > 0) {
        // decode 返回 [lat, lng]，LngLatBounds 需要 [lng, lat]
        const [lat, lng] = coords[0]
        allCoords.push([lng, lat])
      }
    }

    if (allCoords.length === 0) return

    // Sort by lng and lat, take the middle 80% to exclude outliers
    const trimPct = 0.1
    const trimCount = Math.floor(allCoords.length * trimPct)

    const lngs = allCoords.map(c => c[0]).sort((a, b) => a - b)
    const lats = allCoords.map(c => c[1]).sort((a, b) => a - b)

    const bounds = new mapboxgl.LngLatBounds(
      [lngs[trimCount], lats[trimCount]],
      [lngs[lngs.length - 1 - trimCount], lats[lats.length - 1 - trimCount]]
    )

    map.current.fitBounds(bounds, { padding: 30, maxZoom: 13 })
  }

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl overflow-hidden h-[280px] relative">
      {selectedActivity && (
        <button
          onClick={onClearSelection}
          className="absolute top-3 left-3 z-10 px-3 py-1.5 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg text-xs font-medium shadow-md hover:bg-[var(--color-bg)] transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Overview
        </button>
      )}
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  )
}
