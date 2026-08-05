/**
 * Development launcher.
 *
 * Starts the Vite dev server, builds the Electron main and preload bundles,
 * then launches Electron pointed at the dev server. Ctrl-C stops both.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), root });
await server.listen();

const address = server.httpServer?.address();
if (!address || typeof address === 'string') {
  throw new Error('The Vite dev server did not report a port.');
}
const devServerUrl = `http://127.0.0.1:${address.port}`;
console.log(`renderer: ${devServerUrl}`);

await build({ configFile: path.join(root, 'vite.main.config.ts'), root, logLevel: 'warn' });
await build({ configFile: path.join(root, 'vite.preload.config.ts'), root, logLevel: 'warn' });

const electronBinary = (await import('electron')).default;
const child = spawn(electronBinary, [root], {
  stdio: 'inherit',
  env: { ...process.env, PR_REVIEWER_DEV_SERVER: devServerUrl, NODE_ENV: 'development' },
});

const stop = async (code) => {
  await server.close();
  process.exit(code ?? 0);
};

child.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => {
  child.kill('SIGTERM');
});
