import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { DesktopWorkspaceProvider } from './desktop/DesktopWorkspaceContext.js'
import { initializeDesktopRuntime } from './desktop/runtime.js'
import { GeoEyeSelectionProvider } from './state/SelectionContext.js'
import './styles.css'

async function start() {
  await initializeDesktopRuntime()
  const root = document.getElementById('root')
  if (root === null) throw new Error('Application root was not found')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <DesktopWorkspaceProvider>
          <GeoEyeSelectionProvider>
            <App />
          </GeoEyeSelectionProvider>
        </DesktopWorkspaceProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
