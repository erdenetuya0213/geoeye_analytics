/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATAPOOL_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
