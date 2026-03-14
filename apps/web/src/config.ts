/** Build-time configuration. The only backend address the browser knows is the gateway's. */
export const config = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api').replace(/\/$/, ''),
  devLoginEnabled: import.meta.env.VITE_DEV_LOGIN_ENABLED === 'true',
};
