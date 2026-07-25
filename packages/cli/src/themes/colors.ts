/**
 * OpenStar 主题系统
 * 支持 dark/light/系统模式切换
 */

export type ThemeMode = 'dark' | 'light' | 'system'

export interface ThemeColors {
  primary: string
  secondary: string
  success: string
  warning: string
  error: string
  info: string
  background: string
  backgroundSecondary: string
  foreground: string
  foregroundMuted: string
  border: string
  prompt: string
}

export interface Theme {
  name: string
  mode: ThemeMode
  colors: ThemeColors
  displayName: string
  description: string
}

// 内置主题

/** Deep theme -暗色主题 */
export const deepTheme: Theme = {
  name: 'deep',
  mode: 'dark',
  displayName: 'Deep (暗色)',
  description: '深色主题，高对比度，适合夜间使用',
  colors: {
    primary: '\x1b[35m', // magenta
    secondary: '\x1b[36m', // cyan
    success: '\x1b[32m', // green
    warning: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
    info: '\x1b[34m', // blue
    background: '\x1b[48;2;30;30;40m', // Deep dark gray
    backgroundSecondary: '\x1b[48;2;40;40;50m',
    foreground: '\x1b[38;2;220;220;240m', // Light gray
    foregroundMuted: '\x1b[38;2;160;160;180m',
    border: '\x1b[38;2;80;80;100m',
    prompt: '\x1b[35m◆\x1b[0m '
  }
}

/** Dawn theme -浅色主题 */
export const dawnTheme: Theme = {
  name: 'dawn',
  mode: 'light',
  displayName: 'Dawn (浅色)',
  description: '浅色主题，舒适阅读体验',
  colors: {
    primary: '\x1b[34m', // blue
    secondary: '\x1b[36m', // cyan
    success: '\x1b[32m', // green
    warning: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
    info: '\x1b[34m', // blue
    background: '\x1b[48;2;240;242;245m', // Very light gray
    backgroundSecondary: '\x1b[48;2;230;232;235m',
    foreground: '\x1b[38;2;50;50;60m', // Dark gray
    foregroundMuted: '\x1b[38;2;120;120;130m',
    border: '\x1b[38;2;180;180;190m',
    prompt: '\x1b[34m◇\x1b[0m '
  }
}

/** Solarized theme - 高级主题 */
export const solarizedTheme: Theme = {
  name: 'solarized',
  mode: 'dark',
  displayName: 'Solarized',
  description: '经典色温主题，视觉舒适',
  colors: {
    primary: '\x1b[36m', // cyan
    secondary: '\x1b[33m', // yellow
    success: '\x1b[32m', // green
    warning: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
    info: '\x1b[34m', // blue
    background: '\x1b[48;2;0;43;54m', // Solarized dark
    backgroundSecondary: '\x1b[48;2;7;54;66m',
    foreground: '\x1b[38;2;131;148;150m', // Base0
    foregroundMuted: '\x1b[38;2;88;110;117m',
    border: '\x1b[38;2;101;123;131m',
    prompt: '\x1b[36m◆\x1b[0m '
  }
}

/** 模糊匹配主题 */
export function getThemeByName(name: string): Theme | undefined {
  const themes = [deepTheme, dawnTheme, solarizedTheme]
  const lowerName = name.toLowerCase()

  const found = themes.find(t => t.name === lowerName || t.displayName.toLowerCase().includes(lowerName))
  if (found) return found

  return themes.find(t => t.mode === 'dark') // 默认返回暗色
}

/** 根据系统设置选择主题 */
export function getSystemPreferredTheme(): { theme: Theme; mode: ThemeMode } {
  const systemDark =
    process.platform === 'darwin' && process.env.OS_THEME === 'dark' ||
    process.platform === 'win32' && process.env.HighContrast === '1'

  if (systemDark) {
    return { theme: deepTheme, mode: 'system' }
  }
  return { theme: dawnTheme, mode: 'system' }
}

/** 颜色文本格式化工具 */
export function colorize(text: string, colorCode: string): string {
  return `${colorCode}${text}\x1b[0m`
}

// 导出所有主题
export const themes = {
  deep: deepTheme,
  dawn: dawnTheme,
  solarized: solarizedTheme
}

export const availableThemes = [deepTheme, dawnTheme, solarizedTheme]
