/**
 * 配置从根目录 config.yml 加载，由 Vite 在构建时转换。
 * 直接编辑 config.yml 即可，无需改动此文件。
 */
import rawConfig from '@config'
import type { Locale } from './i18n'

export interface GoalConfig {
  yearly: number
  monthly: number
  weekly: number
  /** 'distance' (km) | 'time' (minutes) */
  unit: 'distance' | 'time'
}

interface AppConfig {
  locale: Locale
  theme: 'light' | 'dark' | 'system'
  goals: Record<string, GoalConfig>
  birthdayMonth?: string
}

const config = rawConfig as AppConfig

export const DEFAULT_LOCALE: Locale = config.locale ?? 'zh'
export const DEFAULT_THEME: 'light' | 'dark' | 'system' = config.theme ?? 'system'
export const GOALS: Record<string, GoalConfig> = config.goals ?? {}
export const DEFAULT_GOAL: GoalConfig = GOALS.all ?? {
  yearly: 2000,
  monthly: 150,
  weekly: 35,
  unit: 'distance',
}
/** 出生年月 YYYY-MM，用于 RUNNING.LIFE 一生运动热力图 */
export const BIRTHDAY_MONTH: string = config.birthdayMonth ?? '1996-01'
