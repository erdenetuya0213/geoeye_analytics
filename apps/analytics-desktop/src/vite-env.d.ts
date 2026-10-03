/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATAPOOL_ENDPOINT?: string
  /** 'true' offers the sample-data demo workspace in a production build. */
  readonly VITE_ENABLE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
