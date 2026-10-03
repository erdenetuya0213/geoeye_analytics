interface GeoIconProps {
  className?: string
  size?: number
  strokeWidth?: number
}

const iconDefaults = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
}

export function OverviewIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M3.5 12h4l2.2-5.5 4.1 11 2.2-5.5h4.5" />
      <path className="geo-icon-accent" d="M4 4.5h16v15H4z" />
    </svg>
  )
}

export function DataPoolIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <ellipse className="geo-icon-accent" cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
    </svg>
  )
}

export function DrillholeIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <ellipse className="geo-icon-accent" cx="12" cy="4.5" rx="4.2" ry="2" />
      <path d="M7.8 4.5v13.7L12 21l4.2-2.8V4.5" />
      <path d="M7.8 9.2h8.4M7.8 14.1h8.4M12 6.5v12.9" />
    </svg>
  )
}

export function DownholeCorrelationIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M3.5 3.5h4v17h-4zM10 3.5h4v17h-4zM16.5 3.5h4v17h-4z" />
      <path d="M3.5 8h4M10 10.2h4M16.5 7.2h4M3.5 15h4M10 13.4h4M16.5 16.2h4" />
      <path className="geo-icon-accent" d="m7.5 8 2.5 2.2m4 0 2.5-3M7.5 15l2.5-1.6m4 0 2.5 2.8" />
    </svg>
  )
}

export function CollarIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      <circle className="geo-icon-accent" cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export function LithologyIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M7 2.5h10v19H7zM7 7.3h10M7 13.8h10" />
      <path d="m8.5 5 2-1.2 2 1.2 2-1.2 1.5.9M8.5 11.7l2-2 2 2 2-2 1.5 1.5" />
      <path className="geo-icon-accent" d="m8.5 18.7 2-3 2 3 2-3 1.5 2.2" />
    </svg>
  )
}

export function SurveyIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M6 3.5c0 6.2 1.5 9.4 4.5 12 2 1.7 4.4 2.8 7.5 5" />
      <circle className="geo-icon-accent" cx="6" cy="3.5" r="1.8" />
      <circle cx="7" cy="9" r="1.2" /><circle cx="10.5" cy="15.5" r="1.2" /><circle cx="18" cy="20.5" r="1.2" />
      <path d="M3.5 21h17" />
    </svg>
  )
}

export function FieldLoggingIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M5 3h7v18H5zM8.5 3v18M5 8h7M5 14h7M15 5h5M15 9h3M15 13h5M15 17h3" />
      <path className="geo-icon-accent" d="M12 6.5h2.5M12 15.5h2.5" />
    </svg>
  )
}

export function XrfIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <circle className="geo-icon-accent" cx="8" cy="12" r="2" />
      <path d="M3 5h7l3 3v8l-3 3H3zM13 10h3l4-4M13 14h3l4 4" />
      <path d="m17.5 4.5 2 1.5-2 1.5m0 9 2 1.5-2 1.5" />
    </svg>
  )
}

export function SpectralIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <defs>
        <linearGradient id="spectral-cube-top" x1="0" x2="1"><stop offset="0" stopColor="#2684d4" /><stop offset=".52" stopColor="#58c96d" /><stop offset="1" stopColor="#f2cf3a" /></linearGradient>
        <linearGradient id="spectral-cube-front" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stopColor="#1974cf" /><stop offset=".55" stopColor="#31bd8a" /><stop offset="1" stopColor="#e5d13a" /></linearGradient>
        <linearGradient id="spectral-cube-side" x1="0" x2="1"><stop offset="0" stopColor="#2fb49a" /><stop offset=".55" stopColor="#f0c83b" /><stop offset="1" stopColor="#e74a3f" /></linearGradient>
      </defs>
      <path d="m4 7 8-4 8 4-8 4z" fill="url(#spectral-cube-top)" />
      <path d="m4 7 8 4v10l-8-4z" fill="url(#spectral-cube-front)" />
      <path d="m12 11 8-4v10l-8 4z" fill="url(#spectral-cube-side)" />
      <path d="m4 7 8-4 8 4v10l-8 4-8-4zm0 0 8 4 8-4M12 11v10" />
      <path d="m8 5 8 4M8 9v10m8-10v10M4 12l8 4 8-4" stroke="#17242b" strokeOpacity=".6" strokeWidth=".8" />
      <path className="geo-icon-accent" d="m4 15 8 4 8-4" strokeWidth="1" />
    </svg>
  )
}

export function SpatialIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M4 19.5V5m0 14.5h15" />
      <path className="geo-icon-accent" d="m4 5 2.2 2.2M4 5 1.8 7.2m17.2 12.3-2.2-2.2m2.2 2.2-2.2 2.2" />
      <path d="m8 16 3-6 3 3 4-6" />
    </svg>
  )
}

export function ExploreIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M4 19V5m0 14h16" />
      <circle cx="8" cy="15" r="1.2" /><circle cx="11" cy="11" r="1.2" /><circle cx="15" cy="10" r="1.2" /><circle cx="18" cy="6" r="1.2" />
      <path className="geo-icon-accent" d="m7 16 12-11" />
    </svg>
  )
}

export function StructureIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5v17M5.7 6.2c3.5 2.4 9.1 2.4 12.6 0M5.7 17.8c3.5-2.4 9.1-2.4 12.6 0" />
      <circle className="geo-icon-accent" cx="15.8" cy="8.2" r="1.2" />
    </svg>
  )
}

export function GeotechIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="m3.5 18.5 4-13 5.3 8 3.1-5 4.6 10z" />
      <path className="geo-icon-accent" d="m7.8 8.2 3.5 2.8-1.5 2.7m5.1-3.6 2.8 3.1-2.1 2.5" />
    </svg>
  )
}

export function BlockModelIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="m12 3 8 4.2v9.5L12 21l-8-4.3V7.2zM4 7.2l8 4.3 8-4.3M12 21v-9.5" />
      <path className="geo-icon-accent" d="m8 5.1 8 4.3v9.4M4 12l8 4.3 8-4.3" />
    </svg>
  )
}

export function AssayIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M8 3.5h8M9.5 3.5v5L5.4 18a1.8 1.8 0 0 0 1.7 2.5h9.8a1.8 1.8 0 0 0 1.7-2.5l-4.1-9.5v-5" />
      <path className="geo-icon-accent" d="M7.6 15h8.8M9.2 12.2h5.6" />
    </svg>
  )
}

export function StrengthIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M4 3.5h16M7 3.5v4.2M17 3.5v4.2M4 20.5h16M7 20.5v-4.2M17 20.5v-4.2" />
      <path d="m9 7.7 3-2 3 2-1.7 2.1 1.7 2.1-3 4.4-3-4.4 1.7-2.1z" />
      <path className="geo-icon-accent" d="M5.5 7.7h13M5.5 16.3h13" />
    </svg>
  )
}

export function VariogramIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M4 19V5m0 14h16" />
      <path className="geo-icon-accent" d="M5.5 17.5c4-9 7.5-11 14-11" />
      <circle cx="7" cy="15" r="1" /><circle cx="10" cy="10.5" r="1" /><circle cx="14" cy="8" r="1" /><circle cx="18" cy="6.5" r="1" />
    </svg>
  )
}

export function SectionIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M3.5 18.5 8 8l4 4 3.2-7 5.3 13.5z" />
      <path className="geo-icon-accent" d="M4.8 15.5h14.4M6.2 12h11.6" />
    </svg>
  )
}

export function SurfaceIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 12c3-3 6 3 9 0s6 3 9 0M3 16c3-3 6 3 9 0s6 3 9 0" />
      <path className="geo-icon-accent" d="M12 4v16" />
    </svg>
  )
}

export function ExportModelIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M5 12v8h14v-8M12 16V3" />
      <path className="geo-icon-accent" d="m7.5 7.5 4.5-4.5 4.5 4.5" />
    </svg>
  )
}

export function DomainIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="m3.5 7 5-3 4 3 3.5-2 4.5 2.5v9L16 19l-4-2.5L8 19l-4.5-2.5z" />
      <path className="geo-icon-accent" d="M8.5 4v15M12.5 7v9.5M16 5v14" />
    </svg>
  )
}

export function GradeIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M4 19V5m0 14h16M7 17v-4m3 4V9m3 8v-6m3 6V6m3 11v-8" />
      <path className="geo-icon-accent" d="m6 12 4-4 3 2 4-6 3 2" />
    </svg>
  )
}

export function MultivariateIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="M6 6h12v12H6zM6 10h12M6 14h12M10 6v12M14 6v12" />
      <circle className="geo-icon-accent" cx="8" cy="8" r="1" /><circle className="geo-icon-accent" cx="12" cy="12" r="1" /><circle className="geo-icon-accent" cx="16" cy="16" r="1" />
    </svg>
  )
}

export function View3DIcon({ className, size = 20, strokeWidth = 1.6 }: GeoIconProps) {
  return (
    <svg {...iconDefaults} aria-hidden="true" className={className} height={size} stroke="currentColor" strokeWidth={strokeWidth} width={size}>
      <path d="m12 3.5 7 4v8l-7 5-7-5v-8zM5 7.5l7 4 7-4M12 20.5v-9" />
      <path className="geo-icon-accent" d="m8.5 5.5 7 4v8" />
    </svg>
  )
}
