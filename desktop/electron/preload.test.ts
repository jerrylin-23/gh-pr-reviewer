import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS, type BackendState } from '../shared/contract';

const exposeInMainWorld = vi.fn();
const invoke = vi.fn().mockResolvedValue({ success: true, data: {}, error: null });
const on = vi.fn();
const removeListener = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args) },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    on: (...args: unknown[]) => on(...args),
    removeListener: (...args: unknown[]) => removeListener(...args),
  },
}));

const APPROVED_SHAPE: Record<string, string[]> = {
  auth: ['status', 'login'],
  repos: ['list', 'search'],
  pullRequests: ['list', 'load'],
  providers: ['list'],
  review: ['generate', 'post'],
  mcp: ['status', 'setup'],
  system: ['health', 'openExternal', 'backendState', 'refreshBackendState', 'onBackendState'],
};

describe('preload bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeInMainWorld.mockClear();
    invoke.mockClear();
  });

  it('exposes exactly one global with exactly the approved methods', async () => {
    await import('./preload');

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('prReviewer');

    expect(Object.keys(api).sort()).toEqual(Object.keys(APPROVED_SHAPE).sort());
    for (const [group, methods] of Object.entries(APPROVED_SHAPE)) {
      const value = api[group] as Record<string, unknown>;
      expect(Object.keys(value).sort()).toEqual([...methods].sort());
      for (const method of methods) {
        expect(typeof value[method]).toBe('function');
      }
    }
  });

  it('never exposes Node, Electron internals, or a raw channel call', async () => {
    await import('./preload');
    const [, api] = exposeInMainWorld.mock.calls[0] as [string, Record<string, unknown>];
    const serialized = Object.keys(api).join(',');

    for (const forbidden of ['require', 'process', 'fs', 'child_process', 'ipcRenderer', 'send', 'invoke']) {
      expect(serialized).not.toContain(forbidden);
      expect(api[forbidden]).toBeUndefined();
    }
  });

  it('maps each method to its own fixed channel', async () => {
    const { createApi } = await import('./preload');
    const calls: string[] = [];
    const api = createApi(
      async (channel) => {
        calls.push(channel);
        return { success: true, data: null, error: null };
      },
      () => () => {},
      { status: 'starting' },
    );

    await api.auth.status();
    await api.repos.search('ruff');
    await api.pullRequests.load('octocat/hello', 7);
    await api.review.generate({ provider: 'claude', diff: 'diff' });

    expect(calls).toEqual([
      IPC_CHANNELS.authStatus,
      IPC_CHANNELS.reposSearch,
      IPC_CHANNELS.pullsLoad,
      IPC_CHANNELS.reviewGenerate,
    ]);
  });

  it('tracks the backend state pushed from the main process', async () => {
    const { createApi } = await import('./preload');
    const pushes: ((state: BackendState) => void)[] = [];
    const api = createApi(
      async () => ({ success: true, data: null, error: null }),
      (listener) => {
        pushes.push(listener);
        return () => {};
      },
      { status: 'starting' },
    );

    expect(api.system.backendState()).toEqual({ status: 'starting' });
    for (const push of pushes) {
      push({ status: 'ready', port: 5000 });
    }
    expect(api.system.backendState()).toEqual({ status: 'ready', port: 5000 });
  });

  it('can pull the current backend state when a push was missed', async () => {
    const { createApi } = await import('./preload');
    const api = createApi(
      async (channel) => {
        if (channel === IPC_CHANNELS.systemBackendState) {
          return { status: 'ready', port: 6123 };
        }
        return { success: true, data: null, error: null };
      },
      () => () => {},
      { status: 'starting' },
    );

    expect(api.system.backendState()).toEqual({ status: 'starting' });
    await expect(api.system.refreshBackendState()).resolves.toEqual({ status: 'ready', port: 6123 });
    expect(api.system.backendState()).toEqual({ status: 'ready', port: 6123 });
  });
});
