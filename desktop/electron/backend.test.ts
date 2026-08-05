import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { PythonBackend, parseReadyLine, redact, resolvePythonLocation } from './backend';

describe('parseReadyLine', () => {
  it('reads the ready line', () => {
    expect(parseReadyLine('{"event":"ready","host":"127.0.0.1","port":51234}')).toEqual({
      host: '127.0.0.1',
      port: 51234,
    });
  });

  it('ignores noise and other events', () => {
    expect(parseReadyLine('INFO: starting')).toBeNull();
    expect(parseReadyLine('{"event":"other","port":1,"host":"h"}')).toBeNull();
    expect(parseReadyLine('{broken')).toBeNull();
    expect(parseReadyLine('')).toBeNull();
  });
});

describe('redact', () => {
  it('removes the token from any logged line', () => {
    expect(redact('using token abc123 now', 'abc123')).toBe('using token [redacted] now');
    expect(redact('nothing to hide', '')).toBe('nothing to hide');
  });
});

describe('resolvePythonLocation', () => {
  const base = {
    appPath: '/repo/desktop',
    resourcesPath: '/Applications/PR.app/Contents/Resources',
    env: {} as NodeJS.ProcessEnv,
  };

  const engineAt = (root: string) => (target: string) =>
    target === `${root}/gh_pr_reviewer/api_server.py`;

  it('prefers the repository virtualenv in development', () => {
    const hasEngine = engineAt('/repo');
    const location = resolvePythonLocation({
      ...base,
      isPackaged: false,
      exists: (target) => hasEngine(target) || target === '/repo/.venv/bin/python',
    });
    expect(location).toEqual({
      command: '/repo/.venv/bin/python',
      args: ['-m', 'gh_pr_reviewer.api_server'],
      cwd: '/repo',
    });
  });

  it('finds the checkout even when the app sits deeper in it', () => {
    const hasEngine = engineAt('/repo');
    const location = resolvePythonLocation({
      ...base,
      appPath: '/repo/desktop/scripts',
      isPackaged: false,
      exists: (target) => hasEngine(target) || target === '/repo/.venv/bin/python',
    });
    expect(location?.cwd).toBe('/repo');
  });

  it('prefers the bundled backend when packaged', () => {
    const bundled = '/Applications/PR.app/Contents/Resources/backend';
    const hasEngine = engineAt(bundled);
    const location = resolvePythonLocation({
      ...base,
      isPackaged: true,
      exists: (target) => hasEngine(target) || target === `${bundled}/.venv/bin/python`,
    });
    expect(location?.cwd).toBe(bundled);
  });

  it('honours PR_REVIEWER_PYTHON', () => {
    const location = resolvePythonLocation({
      ...base,
      isPackaged: false,
      env: { PR_REVIEWER_PYTHON: '/opt/py/bin/python3' } as NodeJS.ProcessEnv,
      exists: (target) => target === '/opt/py/bin/python3',
    });
    expect(location?.command).toBe('/opt/py/bin/python3');
  });

  it('falls back to a system python when the package is present', () => {
    const location = resolvePythonLocation({
      ...base,
      isPackaged: false,
      exists: (target) =>
        target === '/repo/gh_pr_reviewer/api_server.py' || target === '/usr/bin/python3',
    });
    expect(location?.command).toBe('/usr/bin/python3');
  });

  it('never uses the packaged app.asar file as a working directory', () => {
    const location = resolvePythonLocation({
      ...base,
      appPath: '/Applications/PR Reviewer.app/Contents/Resources/app.asar',
      isPackaged: true,
      env: { PR_REVIEWER_PYTHON: '/opt/py/bin/python3' } as NodeJS.ProcessEnv,
      exists: (target) => target === '/opt/py/bin/python3',
    });
    expect(location?.cwd).toBe('/Applications/PR Reviewer.app/Contents/Resources');
  });

  it('uses an installed pr-reviewer-api script when there is no checkout', () => {
    const location = resolvePythonLocation({
      ...base,
      appPath: '/Applications/PR Reviewer.app/Contents/Resources/app.asar',
      isPackaged: true,
      env: { HOME: '/Users/dev', PATH: '/usr/bin' } as NodeJS.ProcessEnv,
      exists: (target) => target === '/Users/dev/.local/bin/pr-reviewer-api',
    });
    expect(location).toEqual({
      command: '/Users/dev/.local/bin/pr-reviewer-api',
      args: [],
      cwd: '/Users/dev/.local/bin',
    });
  });

  it('prefers a checkout virtualenv over an installed script', () => {
    const location = resolvePythonLocation({
      ...base,
      isPackaged: false,
      env: { HOME: '/Users/dev', PATH: '/usr/bin' } as NodeJS.ProcessEnv,
      exists: (target) =>
        target === '/repo/gh_pr_reviewer/api_server.py' ||
        target === '/repo/.venv/bin/python' ||
        target === '/Users/dev/.local/bin/pr-reviewer-api',
    });
    expect(location?.command).toBe('/repo/.venv/bin/python');
  });

  it('ignores a virtualenv that has no review engine next to it', () => {
    const location = resolvePythonLocation({
      ...base,
      isPackaged: false,
      exists: (target) => target === '/repo/desktop/.venv/bin/python',
    });
    expect(location).toBeNull();
  });

  it('returns null when nothing is found', () => {
    const location = resolvePythonLocation({ ...base, isPackaged: false, exists: () => false });
    expect(location).toBeNull();
  });
});

describe('PythonBackend lifecycle', () => {
  it('reports an actionable failure when the backend cannot be found', async () => {
    const states: unknown[] = [];
    const backend = new PythonBackend(null, undefined, (state) => states.push(state));
    const state = await backend.start();
    expect(state.status).toBe('failed');
    if (state.status === 'failed') {
      expect(state.code).toBe('BACKEND_NOT_FOUND');
      expect(state.message).toContain('pip install -e .');
    }
    expect(states.at(-1)).toEqual(state);
  });

  it('refuses requests before the backend is ready', async () => {
    const backend = new PythonBackend(null);
    const response = await backend.request('GET', '/health');
    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('BACKEND_NOT_READY');
  });

  it('stops cleanly when no child is running', async () => {
    const backend = new PythonBackend(null);
    await backend.stop();
    expect(backend.getState()).toEqual({ status: 'stopped' });
  });

  it('sends SIGTERM and escalates to SIGKILL after the timeout', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal: string) => void;
    };
    child.exitCode = null;
    const signals: string[] = [];
    child.kill = (signal: string) => {
      signals.push(signal);
    };

    const backend = new PythonBackend(null);
    (backend as unknown as { child: unknown }).child = child;

    const stopped = backend.stop();
    await vi.advanceTimersByTimeAsync(6000);
    await stopped;

    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(backend.getState()).toEqual({ status: 'stopped' });
    vi.useRealTimers();
  });

  it('resolves the stop promise as soon as the child exits', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      kill: (signal: string) => void;
    };
    child.exitCode = null;
    child.kill = () => {
      setTimeout(() => child.emit('exit', 0), 10);
    };

    const backend = new PythonBackend(null);
    (backend as unknown as { child: unknown }).child = child;

    const stopped = backend.stop();
    await vi.advanceTimersByTimeAsync(20);
    await stopped;

    expect(backend.getState()).toEqual({ status: 'stopped' });
    vi.useRealTimers();
  });
});
