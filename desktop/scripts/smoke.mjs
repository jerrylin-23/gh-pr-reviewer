/**
 * End-to-end smoke test.
 *
 * 1. Starts the Python backend directly and confirms the health endpoint.
 * 2. Starts Electron in development mode against the Vite dev server.
 * 3. Confirms the renderer loads and the preload API is present.
 * 4. Confirms a repository request reaches Python.
 * 5. Shuts both processes down.
 *
 * GitHub is mocked with a stub `gh` on PATH. No real account, repository, or
 * AI provider is used.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '..');

const steps = [];
let failures = 0;

function record(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── A stub `gh` so nothing touches real GitHub ────────────────────────────
const stubDir = mkdtempSync(path.join(tmpdir(), 'pr-reviewer-smoke-'));
const stubGh = path.join(stubDir, 'gh');
writeFileSync(
  stubGh,
  `#!/bin/sh
case "$1" in
  auth) echo "Logged in to github.com account smoke-tester"; exit 0 ;;
  api) echo "smoke-tester"; exit 0 ;;
  repo) echo '[{"nameWithOwner":"smoke/one"},{"nameWithOwner":"smoke/two"}]'; exit 0 ;;
  --version) echo "gh version 0.0.0-smoke"; exit 0 ;;
esac
exit 1
`,
);
chmodSync(stubGh, 0o755);

const stubEnv = { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}` };

const python = path.join(repoRoot, '.venv', 'bin', 'python');
if (!existsSync(python)) {
  console.error(`Missing ${python}. Run: python3 -m venv .venv && .venv/bin/pip install -e .`);
  process.exit(1);
}

// ── Step 1: the Python backend on its own ─────────────────────────────────
const token = randomBytes(32).toString('hex');

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers: { 'x-pr-reviewer-token': token } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const backend = spawn(python, ['-m', 'gh_pr_reviewer.api_server', '--port', '0'], {
  cwd: repoRoot,
  env: { ...stubEnv, PR_REVIEWER_API_TOKEN: token, PYTHONUNBUFFERED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('The backend did not report readiness.')), 20_000);
  let buffer = '';
  backend.stdout.setEncoding('utf8');
  backend.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (const line of buffer.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'ready') {
          clearTimeout(timer);
          resolve(parsed.port);
        }
      } catch {
        /* keep reading */
      }
    }
  });
  backend.on('exit', (code) => reject(new Error(`The backend exited with code ${code}.`)));
});

record('Python backend starts and reports a port', Number.isInteger(port) && port > 0, `port ${port}`);

const health = await get(port, '/health');
record('Health endpoint answers with a valid token', health.status === 200 && JSON.parse(health.body).success);

const noToken = await new Promise((resolve) => {
  const req = request({ host: '127.0.0.1', port, path: '/health', method: 'GET' }, (res) =>
    resolve(res.statusCode),
  );
  req.on('error', () => resolve(0));
  req.end();
});
record('Health endpoint rejects a missing token', noToken === 401, `status ${noToken}`);

const repos = await get(port, '/api/repos');
record(
  'Repository request reaches Python and uses the stub gh',
  repos.status === 200 && JSON.parse(repos.body).data.repos.includes('smoke/one'),
);

backend.kill('SIGTERM');
await new Promise((resolve) => backend.once('exit', resolve));
record('Python backend shuts down on SIGTERM', backend.exitCode !== null || backend.signalCode !== null);

// ── Step 2: Electron in development mode ──────────────────────────────────
const server = await createServer({
  configFile: path.join(root, 'vite.config.ts'),
  root,
  server: { port: 0, strictPort: false },
});
await server.listen();
const address = server.httpServer.address();
const devServerUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 5173}`;
record('Vite dev server starts', true, devServerUrl);

async function listApiServerPids() {
  return new Promise((resolve) => {
    const ps = spawn('/bin/sh', ['-c', 'pgrep -f "gh_pr_reviewer.api_server" || true']);
    let output = '';
    ps.stdout.on('data', (chunk) => {
      output += chunk;
    });
    ps.on('exit', () => resolve(new Set(output.trim().split('\n').filter(Boolean))));
  });
}

const pidsBeforeElectron = await listApiServerPids();

const electronBinary = (await import('electron')).default;
const electron = spawn(electronBinary, [path.join(here, 'smoke-main.mjs')], {
  cwd: root,
  env: { ...stubEnv, PR_REVIEWER_DEV_SERVER: devServerUrl, NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let electronOut = '';
electron.stdout.setEncoding('utf8');
electron.stdout.on('data', (chunk) => {
  electronOut += chunk;
});
electron.stderr.setEncoding('utf8');
electron.stderr.on('data', (chunk) => { if (process.env.SMOKE_DEBUG) process.stderr.write(chunk); });

const electronExit = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    electron.kill('SIGKILL');
    resolve(-1);
  }, 120_000);
  electron.on('exit', (code) => {
    clearTimeout(timer);
    resolve(code ?? -1);
  });
});

const resultLine = electronOut.split('\n').find((line) => line.startsWith('SMOKE_RESULT '));
const parsed = resultLine ? JSON.parse(resultLine.slice('SMOKE_RESULT '.length)) : null;

record('Electron main process starts and exits cleanly', electronExit === 0, `exit ${electronExit}`);
record('Renderer loads the React app', Boolean(parsed?.results.rendererLoaded));
record('Preload API is available and Node is not', Boolean(parsed?.results.preloadApi));
record('Electron reaches a ready Python backend', Boolean(parsed?.results.backendReady));
record(
  'Repository request from the renderer reaches Python',
  Boolean(parsed?.results.repos && JSON.parse(parsed.results.repos).data?.repos?.includes('smoke/one')),
);

await server.close();

// ── Step 3: no orphan Python process is left behind ───────────────────────
await new Promise((resolve) => setTimeout(resolve, 500));
const pidsAfter = await listApiServerPids();
const leaked = [...pidsAfter].filter((pid) => !pidsBeforeElectron.has(pid));
record(
  'No orphan Python backend is left running',
  leaked.length === 0,
  leaked.length === 0 ? '' : `${leaked.length} new process(es): ${leaked.join(', ')}`,
);

console.log(`\n${steps.length - failures}/${steps.length} smoke checks passed.`);
process.exit(failures === 0 ? 0 : 1);
