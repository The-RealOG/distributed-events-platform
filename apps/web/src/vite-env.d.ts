interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_LOGIN_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
