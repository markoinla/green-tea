import { useTheme } from '@renderer/hooks/useTheme'
import { useSettings } from '@renderer/hooks/useSettings'
import { FONT_OPTIONS, LIGHT_BG_PRESETS, DARK_BG_PRESETS, getFontStack } from './constants'

export function AppearanceTab() {
  const { theme, updateTheme } = useTheme()
  const { settings } = useSettings()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Appearance</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Customize fonts, colors, and backgrounds.
        </p>
      </div>

      {/* Font Sizes */}
      <div className="space-y-3">
        <FontSizeSlider
          label="Editor font size"
          value={theme.editorFontSize || '14'}
          min={10}
          max={24}
          onChange={(v) => {
            updateTheme({ editorFontSize: v })
            document.documentElement.style.setProperty('--editor-font-size', `${v}px`)
          }}
        />
        <FontSizeSlider
          label="UI font size"
          value={theme.uiFontSize || '14'}
          min={11}
          max={18}
          onChange={(v) => {
            updateTheme({ uiFontSize: v })
            document.documentElement.style.fontSize = `${parseInt(v, 10) / 0.875}px`
          }}
        />
        <FontSizeSlider
          label="Code font size"
          value={theme.codeFontSize || '13'}
          min={10}
          max={20}
          onChange={(v) => {
            updateTheme({ codeFontSize: v })
            document.documentElement.style.setProperty('--code-font-size', `${v}px`)
          }}
        />
      </div>

      {/* Fonts — side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Body font</label>
          <select
            className="mt-1 w-full h-8 rounded-md border border-border bg-background text-foreground text-sm px-2"
            value={theme.editorBodyFont || 'inter'}
            onChange={(e) => {
              updateTheme({ editorBodyFont: e.target.value })
              document.documentElement.style.setProperty(
                '--editor-body-font',
                getFontStack(e.target.value)
              )
            }}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Heading font</label>
          <select
            className="mt-1 w-full h-8 rounded-md border border-border bg-background text-foreground text-sm px-2"
            value={theme.editorHeadingFont || 'inter'}
            onChange={(e) => {
              updateTheme({ editorHeadingFont: e.target.value })
              document.documentElement.style.setProperty(
                '--editor-heading-font',
                getFontStack(e.target.value)
              )
            }}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Backgrounds — side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Light background</label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              type="color"
              className="h-7 w-7 rounded-md border border-border cursor-pointer bg-transparent p-0.5"
              value={theme.lightBackground || '#ffffff'}
              onChange={(e) => {
                updateTheme({ lightBackground: e.target.value })
                if (settings.theme === 'light') {
                  document.documentElement.style.setProperty('--background', e.target.value)
                }
              }}
            />
            {LIGHT_BG_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                className={`h-6 w-6 rounded-full border-2 transition-colors ${
                  theme.lightBackground === preset.value
                    ? 'border-foreground'
                    : 'border-border hover:border-foreground/40'
                }`}
                style={{ backgroundColor: preset.value }}
                onClick={() => {
                  updateTheme({ lightBackground: preset.value })
                  if (settings.theme === 'light') {
                    document.documentElement.style.setProperty('--background', preset.value)
                  }
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Dark background</label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              type="color"
              className="h-7 w-7 rounded-md border border-border cursor-pointer bg-transparent p-0.5"
              value={theme.darkBackground || '#3b3f3c'}
              onChange={(e) => {
                updateTheme({ darkBackground: e.target.value })
                if (settings.theme === 'dark') {
                  document.documentElement.style.setProperty('--background', e.target.value)
                }
              }}
            />
            {DARK_BG_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                className={`h-6 w-6 rounded-full border-2 transition-colors ${
                  theme.darkBackground === preset.value
                    ? 'border-foreground'
                    : 'border-border hover:border-foreground/40'
                }`}
                style={{ backgroundColor: preset.value }}
                onClick={() => {
                  updateTheme({ darkBackground: preset.value })
                  if (settings.theme === 'dark') {
                    document.documentElement.style.setProperty('--background', preset.value)
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FontSizeSlider({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: string
  min: number
  max: number
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs font-medium text-muted-foreground w-28 shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        className="flex-1 accent-accent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{value}px</span>
    </div>
  )
}
