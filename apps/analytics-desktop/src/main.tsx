import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { GeoEyeSelectionProvider } from './state/SelectionContext.js'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Application root was not found')
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <GeoEyeSelectionProvider>
        <App />
      </GeoEyeSelectionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
