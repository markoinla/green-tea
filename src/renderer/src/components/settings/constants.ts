export const FONT_OPTIONS = [
  { label: 'Inter', value: 'inter', stack: "'Inter', sans-serif" },
  {
    label: 'System Default',
    value: 'system',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  { label: 'Georgia', value: 'georgia', stack: "Georgia, 'Times New Roman', serif" },
  { label: 'Palatino', value: 'palatino', stack: "'Palatino Linotype', Palatino, serif" },
  { label: 'Charter', value: 'charter', stack: 'Charter, Georgia, serif' },
  {
    label: 'Helvetica Neue',
    value: 'helvetica-neue',
    stack: "'Helvetica Neue', Helvetica, Arial, sans-serif"
  },
  { label: 'Avenir', value: 'avenir', stack: "Avenir, 'Avenir Next', sans-serif" },
  {
    label: 'Monospace',
    value: 'monospace',
    stack: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace"
  }
]

export const LIGHT_BG_PRESETS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Cream', value: '#faf8f5' },
  { label: 'Stone', value: '#f5f5f4' },
  { label: 'Mint', value: '#f0fdf4' },
  { label: 'Ice', value: '#eff6ff' }
]

export const DARK_BG_PRESETS = [
  { label: 'Default', value: '#3b3f3c' },
  { label: 'Pure dark', value: '#1a1a1a' },
  { label: 'Warm', value: '#2c2420' },
  { label: 'Navy', value: '#1e293b' },
  { label: 'Forest', value: '#1a2e1a' }
]

export function getFontStack(value: string): string {
  return FONT_OPTIONS.find((f) => f.value === value)?.stack ?? "'Inter', sans-serif"
}
