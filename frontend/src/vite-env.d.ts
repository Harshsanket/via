/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_SERVER_URL?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_ERROR_REPORTING_URL?: string
  readonly VITE_MAX_RECOVERY_ATTEMPTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
