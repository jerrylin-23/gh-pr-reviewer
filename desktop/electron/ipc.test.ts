import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../shared/contract';
import type { PythonBackend } from './backend';
import { readPrNumber, readRepo, readText, registerIpcHandlers } from './ipc';

function harness() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
  };
  const request = vi.fn().mockResolvedValue({ success: true, data: {}, error: null });
  const getState = vi.fn().mockReturnValue({ status: 'ready', port: 51234 });
  const backend = { request, getState } as unknown as PythonBackend;
  const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
  const channels = registerIpcHandlers(ipcMain, backend, shell);

  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!(null, ...args);
  return { channels, invoke, request, getState, shell };
}

describe('input readers', () => {
  it('accepts a well-formed repository only', () => {
    expect(readRepo('octocat/hello')).toBe('octocat/hello');
    expect(readRepo(' octocat/hello ')).toBe('octocat/hello');
    expect(readRepo('octocat')).toBeNull();
    expect(readRepo('octocat/hello/extra')).toBeNull();
    expect(readRepo('../../etc/passwd')).toBeNull();
    expect(readRepo('octocat/hello;rm -rf /')).toBeNull();
    expect(readRepo(42)).toBeNull();
  });

  it('accepts a positive integer Pull Request number only', () => {
    expect(readPrNumber(7)).toBe(7);
    expect(readPrNumber(0)).toBeNull();
    expect(readPrNumber(-1)).toBeNull();
    expect(readPrNumber(1.5)).toBeNull();
    expect(readPrNumber('7')).toBeNull();
    expect(readPrNumber(20_000_000)).toBeNull();
  });

  it('enforces the text size limit', () => {
    expect(readText('abc', 10)).toBe('abc');
    expect(readText('abcdefghijk', 10)).toBeNull();
    expect(readText(5, 10)).toBeNull();
  });
});

describe('registered channels', () => {
  it('registers exactly the approved set', () => {
    const { channels } = harness();
    expect(new Set(channels)).toEqual(new Set(Object.values(IPC_CHANNELS)));
  });

  it('has no channel that runs a command or reads a file', () => {
    const { channels } = harness();
    for (const channel of channels) {
      expect(channel).not.toMatch(/exec|command|shell|spawn|file|read|write|path/i);
    }
  });
});

describe('channel validation', () => {
  it('rejects a bad repository before it reaches Python', async () => {
    const { invoke, request } = harness();
    const result = await invoke(IPC_CHANNELS.pullsList, 'not-a-repo');
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a bad Pull Request number', async () => {
    const { invoke, request } = harness();
    const result = await invoke(IPC_CHANNELS.pullsLoad, 'octocat/hello', -2);
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('forwards a valid load request', async () => {
    const { invoke, request } = harness();
    await invoke(IPC_CHANNELS.pullsLoad, 'octocat/hello', 7);
    expect(request).toHaveBeenCalledWith('POST', '/api/pulls/load', {
      repo: 'octocat/hello',
      number: 7,
    });
  });

  it('refuses to post without an explicit confirmation', async () => {
    const { invoke, request } = harness();
    const result = await invoke(IPC_CHANNELS.reviewPost, {
      repo: 'octocat/hello',
      number: 7,
      body: 'looks good',
    });
    expect(result).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('forwards a confirmed post', async () => {
    const { invoke, request } = harness();
    await invoke(IPC_CHANNELS.reviewPost, {
      repo: 'octocat/hello',
      number: 7,
      body: 'looks good',
      confirm: true,
    });
    expect(request).toHaveBeenCalledWith('POST', '/api/review/post', {
      repo: 'octocat/hello',
      number: 7,
      body: 'looks good',
      confirm: true,
    });
  });

  it('rejects an empty review request', async () => {
    const { invoke, request } = harness();
    expect(await invoke(IPC_CHANNELS.reviewGenerate, null)).toMatchObject({ success: false });
    expect(await invoke(IPC_CHANNELS.reviewGenerate, { provider: '', diff: 'x' })).toMatchObject({
      success: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('opens only approved external links', async () => {
    const { invoke, shell } = harness();
    expect(await invoke(IPC_CHANNELS.systemOpenExternal, 'https://evil.example.com')).toMatchObject({
      success: false,
    });
    expect(shell.openExternal).not.toHaveBeenCalled();

    expect(await invoke(IPC_CHANNELS.systemOpenExternal, 'https://github.com/octocat')).toMatchObject({
      success: true,
    });
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/octocat');
  });

  it('returns the live backend state without wrapping it in an envelope', () => {
    const { invoke, getState } = harness();
    expect(invoke(IPC_CHANNELS.systemBackendState)).toEqual({
      status: 'ready',
      port: 51234,
    });
    expect(getState).toHaveBeenCalled();
  });
});
