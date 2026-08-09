import { useEffect, useRef, useState, type ReactNode } from 'react'

type RevealProps = {
  /** 进入视口前的初始位移量（px），对应目标网站 translateY 的 20/40/10px */
  y?: number
  /** 错落延迟（ms），对应目标网站 delay-100/200/300（0.1/0.2/0.3s） */
  delay?: number
  /** 过渡时长（ms），目标网站为 800 */
  duration?: number
  /** 进入视口时是否触发；默认 true */
  active?: boolean
  /** 追加到外层容器的 class */
  className?: string
  children?: ReactNode
}

// 目标网站动画：transition { duration: 0.8, ease: "easeOut", delay: n }
// framer-motion 的 "easeOut" 预设 = [0, 0, 0.58, 1]（CSS ease-out），非 expo 曲线。
// 之前用 cubic-bezier(0.16,1,0.3,1)（easeOutExpo）导致上浮过快。
const EASE_OUT = 'cubic-bezier(0, 0, 0.58, 1)'

/**
 * 入场浮现动画（复刻 RUN.LOG 首页实现方式）。
 *
 * 目标网站（bundle 源码实测）的区块动画为：
 *   initial {opacity:0, y:40} → whileInView {opacity:1, y:0}
 *   viewport { once:true, amount:0.1 }
 *   transition { duration:0.8, ease:"easeOut", delay: n }   // n 来自 delay-100/200/300
 *
 * 本项目用 IntersectionObserver + 内联 style 等价实现：
 * 1. 初次渲染时设初始态 `opacity:0; translateY(Npx) translateZ(0)`；
 * 2. 进入视口后，先注入 transition（无值变化），再在下一帧把 opacity/transform 设为终态，
 *    由 CSS 过渡平滑浮现；delay 用于错落延迟。
 */
export function Reveal({ y = 40, delay = 0, duration = 800, active = true, className, children }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    // 无障碍：用户偏好减少动效时直接显示，不做入场动画
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.style.opacity = '1'
      el.style.transform = 'none'
      setRevealed(true)
      return
    }

    // 初始态（进入视口前）：opacity 0 + 向下偏移（无过渡）
    el.style.transition = 'none'
    el.style.opacity = '0'
    el.style.transform = `translateY(${y}px) translateZ(0)`

    if (typeof IntersectionObserver === 'undefined') {
      // 降级：不支持 IO 时直接显示
      el.style.opacity = '1'
      el.style.transform = 'none'
      setRevealed(true)
      return
    }

    // viewport { once:true, amount:0.1 }：进入 10% 视口触发，且只触发一次
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setRevealed(true)
            io.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [active, y])

  // 触发后：先确保 transition 就位（含 delay），下一帧再改终值，才能产生平滑过渡
  useEffect(() => {
    if (!revealed) return
    const el = ref.current
    if (!el) return
    el.style.transition = `opacity ${duration}ms ${EASE_OUT} ${delay}ms, transform ${duration}ms ${EASE_OUT} ${delay}ms`
    const raf = requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0) translateZ(0)'
    })
    return () => cancelAnimationFrame(raf)
  }, [revealed, duration, delay])

  return (
    <div ref={ref} className={className} data-revealed={revealed ? '1' : '0'}>
      {children}
    </div>
  )
}
