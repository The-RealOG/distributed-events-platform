import { Metrics } from '@dpp/observability';
import { installGracefulShutdown } from '@dpp/runtime';
import { buildApp, SERVICE_NAME, type AppState } from './app.js';
import { loadGatewayConfig } from './config.js';

const config = loadGatewayConfig();
const state: AppState = { ready: false };
const app = await buildApp(config, state, new Metrics(SERVICE_NAME));

installGracefulShutdown({
  log: app.log,
  timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
  onStart: () => {
    state.ready = false;
  },
  // app.close() stops accepting connections and waits for in-flight proxied requests.
  steps: [{ name: 'http', run: () => app.close() }],
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  state.ready = true;
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  process.exit(1);
}
