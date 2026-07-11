import { useMemo, useState, useEffect, type CSSProperties } from 'react'
import { useLocale } from '../hooks/useLocale'
import type { Activity } from '../types'
import { isRunType } from '../sportMeta'
import { BIRTHDAY_MONTH } from '../config'

interface LifePageProps {
  activities: Activity[]
}

// ── 84 年 = 1008 个月，24 列（2 年）× 42 行
const LIFETIME_MONTHS = 1008
const COLS = 24
const ROWS = LIFETIME_MONTHS / COLS // 42 行

const BUCKETS = [
  { max: 20, color: '#6b8cae', label: '<20km' },
  { max: 50, color: '#facc15', label: '20-50km' },
  { max: 100, color: '#f97316', label: '50-100km' },
  { min: 100, color: '#ef4444', label: '>100km' },
]

function getMonthColor(km: number): string {
  if (km <= 0) return ''
  if (km < 20) return BUCKETS[0].color
  if (km < 50) return BUCKETS[1].color
  if (km < 100) return BUCKETS[2].color
  return BUCKETS[3].color
}

/** 解析 YYYY-MM 出生年月 */
function parseBirthday(raw: string) {
  const m = raw.match(/^(\d{4})-(\d{2})$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) - 1 }
  return { year: 1996, month: 0 }
}

export function LifePage({ activities }: LifePageProps) {
  const { locale } = useLocale()
  const birth = parseBirthday(BIRTHDAY_MONTH)

  const [reveal, setReveal] = useState(false)
  const [showOverlays, setShowOverlays] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReveal(true), 50)
    return () => clearTimeout(t)
  }, [])

  const { months, lived } = useMemo(() => {
    // 按月聚合跑步距离（仅 Run / Trail Run）
    const monthly = new Map<string, number>()
    for (const a of activities) {
      if (!isRunType(a.type)) continue
      const d = new Date(a.start_date_local)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      monthly.set(key, (monthly.get(key) ?? 0) + a.distance)
    }

    const now = new Date()
    const cur = new Date(birth.year, birth.month, 1)
    const months: Array<{
      key: string
      year: number
      month: number
      km: number
      color: string | null
      isPast: boolean
      isFuture: boolean
    }> = []
    let lived = 0

    for (let i = 0; i < LIFETIME_MONTHS; i++) {
      const y = cur.getFullYear()
      const m = cur.getMonth() + 1
      const key = `${y}-${String(m).padStart(2, '0')}`
      const distance = monthly.get(key) ?? 0
      const km = distance / 1000
      const isPast = cur <= now
      const isFuture = cur > now

      if (isPast) {
        lived++
      }

      months.push({
        key,
        year: y,
        month: m,
        km,
        color: distance > 0 ? getMonthColor(km) : null,
        isPast,
        isFuture,
      })

      cur.setMonth(cur.getMonth() + 1)
    }

    return {
      months,
      lived,
    }
  }, [activities, birth])

  return (
    <main
      className="h-[calc(100vh-4rem)] w-full relative overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg)',
        backgroundImage: [
          'radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--color-accent) 22%, transparent), transparent 55%)',
          'radial-gradient(120% 120% at 100% 100%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 55%)',
          'radial-gradient(150% 100% at 50% 0%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 45%)',
        ].join(','),
        backgroundAttachment: 'fixed',
      }}
    >
      {/* 热力图主体：撑满全部空间 */}
      <section className="absolute inset-0 flex items-center justify-center px-2 md:px-6">
        <div
          className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-2 md:p-3 flex items-center justify-center relative overflow-hidden"
          style={{
            height: '94%',
            maxWidth: '100%',
            aspectRatio: `${COLS} / ${ROWS}`,
          }}
        >
        <div
          className="grid w-full h-full"
          style={{
            gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridTemplateRows: `repeat(${ROWS}, 1fr)`,
            gap: '0',
          }}
        >
          {months.map((m) => {
            const colored = m.color && !m.isFuture
            const cellBg: CSSProperties | undefined = m.color && !m.isFuture ? { backgroundColor: m.color } : undefined
            const cellCls = [
              'w-1/2 aspect-square rounded-sm hover:ring-2 hover:ring-white/50 hover:z-10',
              !colored
                ? m.isFuture
                  ? 'bg-black/[0.04] dark:bg-white/[0.03]'
                  : 'bg-black/[0.08] dark:bg-white/[0.07]'
                : '',
            ].filter(Boolean).join(' ')

            const tip =
              m.isPast
                ? `${m.year}.${String(m.month).padStart(2, '0')}: ${
                    m.km > 0 ? m.km.toFixed(1) + ' km' : locale === 'zh' ? '无记录' : 'no data'
                  }`
                : `${m.year}.${String(m.month).padStart(2, '0')}`

            return (
              <div
                key={m.key}
                className="flex items-center justify-center cursor-pointer"
                title={tip}
              >
                <div
                  className={cellCls}
                  style={cellBg}
                />
              </div>
            )
          })}
        </div>
        {/* 遮罩动画：从上到下揭示热力图 */}
        <div
          className="absolute inset-0 z-20 pointer-events-none rounded-xl"
          style={{
            background: 'linear-gradient(to bottom, var(--color-card) 88%, transparent 100%)',
            animation: reveal ? 'revealDown 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards' : 'none',
          }}
          onAnimationEnd={() => setShowOverlays(true)}
        />
        </div>
      </section>

      {/* 标题区：半透明悬浮容器 */}
      <header
        className={`absolute top-[6.5rem] md:top-[7.5rem] left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-all duration-700 ease-out ${
          showOverlays ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
      >
        <div className="px-5 py-2.5 md:px-8 md:py-3.5 text-center">
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter select-none leading-none" style={{ color: 'var(--color-text)' }}>
            WORKOUT<span style={{ color: '#ef4444' }}>.LIFE</span>
          </h1>
          <p className="mt-1 text-sm md:text-xl tracking-widest" style={{ color: 'var(--color-muted)' }}>
            {lived}/{LIFETIME_MONTHS} {locale === 'zh' ? '个月' : 'months'}<span className="mx-4 md:mx-8">·</span>{(lived / LIFETIME_MONTHS * 100).toFixed(1)}%
          </p>
        </div>
      </header>

      {/* 图例：半透明悬浮容器 */}
      <footer
        className={`absolute bottom-12 md:bottom-16 left-1/2 -translate-x-1/2 z-10 pointer-events-none transition-all duration-700 ease-out ${
          showOverlays ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <div className="bg-[var(--color-card)]/10 border border-[var(--color-border)]/15 rounded-xl px-4 py-2 md:px-6 md:py-2.5 shadow-lg">
          <div className="flex flex-wrap items-center justify-center gap-3 md:gap-5 text-sm md:text-base" style={{ color: 'var(--color-muted)' }}>
            {BUCKETS.map((b) => (
              <div key={b.label} className="flex items-center gap-1.5">
                <span
                  className="w-5 h-5 rounded-sm inline-block"
                  style={{ backgroundColor: b.color }}
                />
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </footer>
      <style>{`
        @keyframes revealDown {
          0%   { transform: translateY(0); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </main>
  )
}
