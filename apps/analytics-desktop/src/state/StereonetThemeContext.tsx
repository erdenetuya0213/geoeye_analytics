import { createContext, useContext, type ReactNode } from 'react'
import { DEFAULT_STEREONET_THEME, stereonetThemeById, type StereonetThemeId } from '../visualization/stereonetThemes.js'

const StereonetThemeContext = createContext<StereonetThemeId>(DEFAULT_STEREONET_THEME)

export function StereonetThemeProvider({ children, themeId }: { children: ReactNode; themeId: StereonetThemeId }) {
  return <StereonetThemeContext.Provider value={themeId}>{children}</StereonetThemeContext.Provider>
}

export function useStereonetTheme() {
  return stereonetThemeById(useContext(StereonetThemeContext))
}
