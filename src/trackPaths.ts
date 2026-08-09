import * as polyline from '@mapbox/polyline'
import type { Activity } from './types'

/**
 * 轨迹 SVG path 预计算模块（对齐 RUN.LOG 的 route_svg_path 方案）。
 *
 * 目标网站的数据由服务端预生成 `route_svg_path`（每条轨迹一个 SVG path 字符串），
 * 前端渲染时直接读字符串，不实时解码 polyline，因此切换筛选时极快。
 *
 * 本项目数据只有 `summary_polyline`（polyline 编码），故在数据加载时**一次性**解码
 * 并归一化到 100×100 viewBox 的 SVG path d，存进缓存 Map，渲染时 O(1) 读取。
 * 缓存仅在活动数据变化时重建，切换年份/运动类型不触发重算。
 */

export type TrackPathCache = Map<number, string>

// 抽稀上限：轨迹缩略图尺寸很小，保留主要形状即可。
// 原实现会保留全部坐标点（可达数千点，path 字符串 3 万字符），
// 数百个这样的大 path 导致滚动/渲染卡顿。目标网站服务端预生成的
// route_svg_path 按轨迹长度动态抽稀（短轨迹不抽、长轨迹压缩到几百点），
// 此处用固定上限 + 短轨迹保真的均匀抽稀对齐其精简度。
const MAX_POINTS = 250

/**
 * 均匀抽稀：把坐标点均匀采样到最多 MAX_POINTS 个（保留首尾与主要形状）。
 */
function decimate(coords: [number, number][]): [number, number][] {
  if (coords.length <= MAX_POINTS) return coords
  const step = (coords.length - 1) / (MAX_POINTS - 1)
  const sampled: [number, number][] = []
  for (let i = 0; i < MAX_POINTS; i++) {
    sampled.push(coords[Math.min(coords.length - 1, Math.round(i * step))])
  }
  return sampled
}

/** 把 summary_polyline 解码、抽稀并归一化到 size×size 坐标系，返回 SVG path d 字符串（如 "M x,y L x,y ..."） */
export function polylineToPathD(summaryPolyline: string, size = 100): string {
  try {
    const coords = decimate(polyline.decode(summaryPolyline))
    if (coords.length < 2) return ''
    // 计算包围盒，等比缩放并居中（保留 padding）
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const [lat, lng] of coords) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    const latRange = maxLat - minLat || 0.001
    const lngRange = maxLng - minLng || 0.001
    // 留白 padding：目标网站轨迹 path 在缩略图框内只占据约 60%，四周留白明显（不拥挤）
    const pad = size * 0.2
    const scale = Math.min((size - pad * 2) / lngRange, (size - pad * 2) / latRange)
    const offsetX = (size - lngRange * scale) / 2
    const offsetY = (size - latRange * scale) / 2

    const project = (lat: number, lng: number): [number, number] => {
      const x = (lng - minLng) * scale + offsetX
      const y = size - ((lat - minLat) * scale + offsetY)
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
    }

    const [x0, y0] = project(coords[0][0], coords[0][1])
    let d = `M ${x0},${y0}`
    for (let i = 1; i < coords.length; i++) {
      const [x, y] = project(coords[i][0], coords[i][1])
      d += ` L ${x},${y}`
    }
    return d
  } catch {
    return ''
  }
}

/** 一次性预计算所有活动的轨迹 path 缓存（仅活动数据变化时调用） */
export function buildTrackPathCache(activities: Activity[]): TrackPathCache {
  const cache: TrackPathCache = new Map()
  for (const a of activities) {
    if (!a.summary_polyline) continue
    const d = polylineToPathD(a.summary_polyline)
    if (d) cache.set(a.run_id, d)
  }
  return cache
}
