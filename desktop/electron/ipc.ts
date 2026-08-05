/**
 * Typed IPC handlers.
 *
 * Every channel maps to exactly one backend operation. Arguments are validated
 * here before they reach Python, and Python validates them again. There is no
 * channel that runs a command, reads a file, or takes a URL path from the
 * renderer.
 */

import { IPC_CHANNELS } from '../shared/contract';
import type { ApiEnvelope, PythonBackend } from './backend';
import { isAllowedExternal } from './security';

const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_QUERY_LENGTH = 200;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = 512 * 1024;

function invalid(message: string): ApiEnvelope<never> {
  return { success: false, data: null, error: { code: 'INVALID_INPUT', message } };
}

export function readRepo(value: unknown): string | null {
  return typeof value === 'string' && REPO_PATTERN.test(value.trim()) ? value.trim() : null;
}

export function readPrNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10_000_000) {
    return null;
  }
  return value;
}

export function readText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return Buffer.byteLength(value, 'utf8') <= maxBytes ? value : null;
}

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

/**
 * Register every approved channel. Returns the channel names so tests can
 * confirm nothing extra is registered.
 */
export function registerIpcHandlers(
  ipcMain: IpcRegistrar,
  backend: PythonBackend,
  shell: ShellLike,
): string[] {
  const registered: string[] = [];

  const handle = (channel: string, listener: (...args: unknown[]) => Promise<ApiEnvelope<unknown>>) => {
    registered.push(channel);
    ipcMain.handle(channel, (_event, ...args) => listener(...args));
  };

  handle(IPC_CHANNELS.authStatus, () => backend.request('GET', '/api/auth/status'));

  handle(IPC_CHANNELS.authLogin, () => backend.request('POST', '/api/auth/login', {}));

  handle(IPC_CHANNELS.reposList, () => backend.request('GET', '/api/repos'));

  handle(IPC_CHANNELS.reposSearch, async (query) => {
    const text = readText(query, MAX_QUERY_LENGTH * 4);
    if (text === null || text.length > MAX_QUERY_LENGTH) {
      return invalid('The search query is not valid.');
    }
    return backend.request('POST', '/api/repos/search', { query: text });
  });

  handle(IPC_CHANNELS.pullsList, async (repo) => {
    const value = readRepo(repo);
    if (!value) {
      return invalid('Repository must look like owner/repo.');
    }
    return backend.request('POST', '/api/pulls', { repo: value });
  });

  handle(IPC_CHANNELS.pullsLoad, async (repo, number) => {
    const repoValue = readRepo(repo);
    const numberValue = readPrNumber(number);
    if (!repoValue) {
      return invalid('Repository must look like owner/repo.');
    }
    if (numberValue === null) {
      return invalid('Pull Request number must be a positive integer.');
    }
    return backend.request('POST', '/api/pulls/load', { repo: repoValue, number: numberValue });
  });

  handle(IPC_CHANNELS.providersList, () => backend.request('GET', '/api/providers'));

  handle(IPC_CHANNELS.reviewGenerate, async (input) => {
    if (typeof input !== 'object' || input === null) {
      return invalid('The review request is not valid.');
    }
    const { provider, diff } = input as { provider?: unknown; diff?: unknown };
    const providerValue = readText(provider, 40);
    const diffValue = readText(diff, MAX_DIFF_BYTES);
    if (!providerValue) {
      return invalid('Select an AI provider first.');
    }
    if (diffValue === null) {
      return invalid('The diff is missing or larger than 4 MB.');
    }
    return backend.request('POST', '/api/review/generate', {
      provider: providerValue,
      diff: diffValue,
    });
  });

  handle(IPC_CHANNELS.reviewPost, async (input) => {
    if (typeof input !== 'object' || input === null) {
      return invalid('The post request is not valid.');
    }
    const { repo, number, body, confirm } = input as {
      repo?: unknown;
      number?: unknown;
      body?: unknown;
      confirm?: unknown;
    };
    const repoValue = readRepo(repo);
    const numberValue = readPrNumber(number);
    const bodyValue = readText(body, MAX_BODY_BYTES);
    if (!repoValue || numberValue === null) {
      return invalid('Select a repository and a Pull Request first.');
    }
    if (!bodyValue || !bodyValue.trim()) {
      return invalid('The review body is empty.');
    }
    if (confirm !== true) {
      return invalid('Posting a review needs an explicit confirmation.');
    }
    return backend.request('POST', '/api/review/post', {
      repo: repoValue,
      number: numberValue,
      body: bodyValue,
      confirm: true,
    });
  });

  handle(IPC_CHANNELS.mcpStatus, () => backend.request('GET', '/api/mcp/status'));

  handle(IPC_CHANNELS.mcpSetup, () => backend.request('POST', '/api/mcp/setup', { confirm: true }));

  handle(IPC_CHANNELS.systemHealth, () => backend.request('GET', '/api/system/health'));

  handle(IPC_CHANNELS.systemOpenExternal, async (url) => {
    if (typeof url !== 'string' || !isAllowedExternal(url)) {
      return invalid('That link is not on the approved list.');
    }
    await shell.openExternal(url);
    return { success: true, data: { opened: true }, error: null };
  });

  // Synchronous product state for the renderer. Not an ApiEnvelope: the
  // preload needs the raw BackendState so a missed push event cannot leave
  // the UI on "starting" forever.
  registered.push(IPC_CHANNELS.systemBackendState);
  ipcMain.handle(IPC_CHANNELS.systemBackendState, () => backend.getState());

  return registered;
}
