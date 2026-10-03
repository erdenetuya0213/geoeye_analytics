import { Circle, Droplets, MonitorCog, Palette, Rocket, SunMedium } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export const themes = [
  { id: 'theme-core-console', label: 'Core console', icon: MonitorCog },
  { id: 'theme-core-wet', label: 'Wet core', icon: Droplets },
  { id: 'theme-core-oxide', label: 'Astro', icon: Rocket },
  { id: 'theme-void', label: 'Dark modern', icon: Circle },
  { id: 'theme-solarized', label: 'High visibility', icon: SunMedium },
] as const

export type ThemeId = (typeof themes)[number]['id']

interface ThemeSwitcherProps {
  onChange: (theme: ThemeId) => void
  theme: ThemeId
}

export function ThemeSwitcher({ onChange, theme }: ThemeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node) === false) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="theme-switcher" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Choose interface theme"
        className={`icon-button theme-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="Interface theme"
        type="button"
      >
        <Palette size={18} />
      </button>
      {open ? (
        <div aria-label="Interface themes" className="theme-menu" role="menu">
          {themes.map((item) => {
            const Icon = item.icon
            const active = item.id === theme
            return (
              <button
                aria-label={item.label}
                aria-pressed={active}
                className={active ? 'is-active' : ''}
                key={item.id}
                onClick={() => {
                  onChange(item.id)
                  setOpen(false)
                }}
                role="menuitem"
                title={item.label}
                type="button"
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
