/**
 * Python backend process lifecycle and localhost HTTP client.
 *
 * Electron never runs arbitrary shell commands. It spawns exactly one known
 * Python module, reads the port from a single JSON ready line, and then talks
 * to 127.0.0.1 over HTTP with a per-launch token. The token is generated here
 * and handed to Python through the environment, so it is never written to a
 * log or to stdout.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';

/** The exact child shape `spawn` returns for our stdio configuration. */
type BackendChild = ChildProcessByStdio<null, Readable, Readable>;

export const TOKEN_HEADER = 'x-pr-reviewer-token';
export const START_TIMEOUT_MS = 30_000;
export const STOP_TIMEOUT_MS = 5_000;
export const REQUEST_TIMEOUT_MS = 360_000;

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

export interface ReadyLine {
  host: string;
  port: number;
}

export type BackendState =
  | { status: 'stopped' }
  | { status: 'starting' }
  | { status: 'ready'; port: number }
  | { status: 'failed'; code: string; message: string };

/** Parse one stdout line from the Python backend. Returns null for noise. */
export function parseReadyLine(line: string): ReadyLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { event?: unknown }).event === 'ready' &&
      typeof (parsed as { port?: unknown }).port === 'number' &&
      typeof (parsed as { host?: unknown }).host === 'string'
    ) {
      const { host, port } = parsed as ReadyLine;
      return { host, port };
    }
  } catch {
    return null;
  }
  return null;
}

/** Strip anything that looks like the API token before a line reaches a log. */
export function redact(line: string, token: string): string {
  if (!token) {
    return line;
  }
  return line.split(token).join('[redacted]');
}

export interface PythonLocation {
  /** Executable that runs the backend. */
  command: string;
  /** Arguments before `--port`. */
  args: string[];
  /** Working directory for the child process. */
  cwd: string;
}

export interface ResolveOptions {
  /** `app.getAppPath()`, used to find the repository in development. */
  appPath: string;
  /** `process.resourcesPath`, used to find a bundled backend when packaged. */
  resourcesPath: string;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  /** Injectable for tests. */
  exists?: (target: string) => boolean;
}

const FALLBACK_PYTHONS = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3',
];

const BACKEND_MODULE = ['gh_pr_reviewer', 'api_server.py'];
const MODULE_ARGS = ['-m', 'gh_pr_reviewer.api_server'];
const MAX_ANCESTORS = 4;

/** The console script `pip install` creates for the backend. */
const CONSOLE_SCRIPT = 'pr-reviewer-api';

/** The frozen backend binary a packaged app ships in `Resources/backend`. */
const FROZEN_BACKEND = 'pr-reviewer-api';

/** Directories a macOS GUI app must search, because it inherits no login PATH. */
const COMMON_BIN_DIRS = ['/.local/bin', '/bin', '/.npm-global/bin'];

function findConsoleScript(env: NodeJS.ProcessEnv, exists: (target: string) => boolean): string | null {
  const home = env.HOME ?? '';
  const dirs = [
    ...(env.PATH ?? '').split(path.delimiter).filter(Boolean),
    ...(home ? COMMON_BIN_DIRS.map((suffix) => path.join(home, suffix)) : []),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, CONSOLE_SCRIPT);
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find the Python interpreter and the directory that holds the review engine.
 *
 * The lookup starts from the application location, never from the current
 * working directory. It walks up from `appPath` because the app may sit at any
 * depth inside the checkout. Search order:
 *
 * 1. `PR_REVIEWER_PYTHON` if the user set it.
 * 2. The frozen backend binary in `Resources/backend`, which needs no Python.
 * 3. A backend source copy next to the packaged app (`Resources/backend`).
 * 4. The repository checkout that contains this Electron app.
 * 5. A `pr-reviewer-api` console script from a `pip install`.
 * 6. A system `python3` next to a checkout.
 */
export function resolvePythonLocation(options: ResolveOptions): PythonLocation | null {
  const exists = options.exists ?? existsSync;

  const bundled = path.join(options.resourcesPath, 'backend');

  const ancestors: string[] = [];
  let current = options.appPath;
  for (let depth = 0; depth <= MAX_ANCESTORS; depth += 1) {
    ancestors.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const roots = options.isPackaged ? [bundled, ...ancestors] : [...ancestors, bundled];
  const engineRoots = roots.filter((root) => exists(path.join(root, ...BACKEND_MODULE)));

  // A packaged `appPath` is an `app.asar` file, so it is never a usable cwd.
  const appDir = options.appPath.endsWith('.asar') ? path.dirname(options.appPath) : options.appPath;

  const override = options.env.PR_REVIEWER_PYTHON;
  if (override && exists(override)) {
    return { command: override, args: MODULE_ARGS, cwd: engineRoots[0] ?? appDir };
  }

  // A packaged app ships a frozen backend, so it needs no Python on the host.
  const frozen = path.join(bundled, FROZEN_BACKEND);
  if (exists(frozen)) {
    return { command: frozen, args: [], cwd: bundled };
  }

  for (const root of engineRoots) {
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    if (exists(venvPython)) {
      return { command: venvPython, args: MODULE_ARGS, cwd: root };
    }
  }

  // An installed app has no checkout above it. A `pip install` of the engine
  // leaves a `pr-reviewer-api` script that runs the same module.
  const consoleScript = findConsoleScript(options.env, exists);
  if (consoleScript) {
    return { command: consoleScript, args: [], cwd: engineRoots[0] ?? path.dirname(consoleScript) };
  }

  for (const root of engineRoots) {
    for (const python of FALLBACK_PYTHONS) {
      if (exists(python)) {
        return { command: python, args: MODULE_ARGS, cwd: root };
      }
    }
  }

  return null;
}

export interface BackendLogger {
  info(message: string): void;
  error(message: string): void;
}

const noopLogger: BackendLogger = { info: () => {}, error: () => {} };

export class PythonBackend {
  private child: BackendChild | null = null;
  private readonly token = randomBytes(32).toString('hex');
  private port = 0;
  private state: BackendState = { status: 'stopped' };
  private stopping = false;

  constructor(
    private readonly location: PythonLocation | null,
    private readonly logger: BackendLogger = noopLogger,
    private readonly onStateChange: (state: BackendState) => void = () => {},
  ) {}

  getState(): BackendState {
    return this.state;
  }

  private setState(next: BackendState): void {
    this.state = next;
    this.onStateChange(next);
  }

  async start(): Promise<BackendState> {
    if (this.state.status === 'ready') {
      return this.state;
    }
    if (!this.location) {
      return this.fail(
        'BACKEND_NOT_FOUND',
        'Could not find the Python review backend. Install it with `pip install -e .` in the ' +
          'gh-pr-reviewer repository, or set PR_REVIEWER_PYTHON to a Python that has it installed.',
      );
    }

    this.setState({ status: 'starting' });

    let child: BackendChild;
    try {
      child = spawn(this.location.command, [...this.location.args, '--port', '0'], {
        cwd: this.location.cwd,
        env: {
          ...process.env,
          PR_REVIEWER_API_TOKEN: this.token,
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: this.location.cwd,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      return this.fail(
        'BACKEND_SPAWN_FAILED',
        `Could not start the Python backend: ${(error as Error).message}`,
      );
    }

    this.child = child;

    const ready = await this.waitForReady(child);
    if (!ready.ok) {
      return this.fail(ready.code, ready.message);
    }

    this.port = ready.port;
    const healthy = await this.checkHealth();
    if (!healthy) {
      return this.fail(
        'BACKEND_UNHEALTHY',
        'The Python backend started but did not answer its health check.',
      );
    }

    this.setState({ status: 'ready', port: this.port });
    return this.state;
  }

  private fail(code: string, message: string): BackendState {
    this.setState({ status: 'failed', code, message });
    return this.state;
  }

  private waitForReady(
    child: BackendChild,
  ): Promise<{ ok: true; port: number } | { ok: false; code: string; message: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let stdoutBuffer = '';
      let lastError = '';

      const finish = (result: { ok: true; port: number } | { ok: false; code: string; message: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          ok: false,
          code: 'BACKEND_START_TIMEOUT',
          message: `The Python backend did not report readiness within ${START_TIMEOUT_MS / 1000} seconds.`,
        });
      }, START_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let newline = stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = stdoutBuffer.slice(0, newline);
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          const parsed = parseReadyLine(line);
          if (parsed) {
            finish({ ok: true, port: parsed.port });
            return;
          }
          if (line.trim()) {
            this.logger.info(`backend: ${redact(line.trim(), this.token)}`);
          }
          newline = stdoutBuffer.indexOf('\n');
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        const text = redact(String(chunk).trim(), this.token);
        if (text) {
          lastError = text.split('\n').slice(-4).join('\n');
          this.logger.error(`backend: ${text}`);
        }
      });

      child.on('error', (error: Error) => {
        finish({
          ok: false,
          code: 'BACKEND_SPAWN_FAILED',
          message: `Could not start the Python backend: ${error.message}`,
        });
      });

      child.on('exit', (code) => {
        this.child = null;
        finish({
          ok: false,
          code: 'BACKEND_EXITED',
          message:
            `The Python backend exited with code ${code ?? 'unknown'}.` +
            (lastError ? `\n${lastError}` : ''),
        });
        if (settled && this.state.status === 'ready' && !this.stopping) {
          this.fail('BACKEND_EXITED', 'The Python backend stopped unexpectedly. Restart the app.');
        }
      });
    });
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const response = await this.request('GET', '/health');
      return response.success;
    } catch {
      return false;
    }
  }

  /** Send one typed request to the local backend. */
  request<T = unknown>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<ApiEnvelope<T>> {
    if (!this.port) {
      return Promise.resolve({
        success: false,
        data: null,
        error: { code: 'BACKEND_NOT_READY', message: 'The Python backend is not running.' },
      });
    }

    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');

    return new Promise((resolve) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: this.port,
          path: pathname,
          method,
          headers: {
            [TOKEN_HEADER]: this.token,
            ...(payload
              ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) }
              : {}),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try {
              resolve(JSON.parse(text) as ApiEnvelope<T>);
            } catch {
              resolve({
                success: false,
                data: null,
                error: { code: 'BAD_RESPONSE', message: 'The local backend returned an unreadable response.' },
              });
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          data: null,
          error: { code: 'BACKEND_TIMEOUT', message: 'The local backend did not answer in time.' },
        });
      });

      req.on('error', () => {
        resolve({
          success: false,
          data: null,
          error: { code: 'BACKEND_UNREACHABLE', message: 'The local backend is not reachable.' },
        });
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /** Terminate the child process. Escalates to SIGKILL after a bounded wait. */
  async stop(): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.port = 0;
    if (!child || child.exitCode !== null) {
      this.child = null;
      this.setState({ status: 'stopped' });
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* the process is already gone */
        }
        resolve();
      }, STOP_TIMEOUT_MS);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        child.kill('SIGTERM');
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });

    this.child = null;
    this.setState({ status: 'stopped' });
  }
}
