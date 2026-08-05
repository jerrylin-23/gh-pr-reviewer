/**
 * The only bridge between the renderer and the main process.
 *
 * It exposes a fixed set of typed methods. It never exposes `ipcRenderer`,
 * `child_process`, `fs`, `require`, or a channel name the caller controls.
 */

import { contextBridge, ipcRenderer } from 'electron';

import {
  BACKEND_STATE_EVENT,
  IPC_CHANNELS,
  type BackendState,
  type PrReviewerApi,
} from '../shared/contract';

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** Build the exposed API. Exported so tests can check its shape. */
export function createApi(
  invoke: Invoke,
  subscribe: (listener: (state: BackendState) => void) => () => void,
  initialState: BackendState,
): PrReviewerApi {
  let latest = initialState;
  subscribe((state) => {
    latest = state;
  });

  const call = <T>(channel: string, ...args: unknown[]) => invoke(channel, ...args) as Promise<T>;

  return {
    auth: {
      status: () => call(IPC_CHANNELS.authStatus),
      login: () => call(IPC_CHANNELS.authLogin),
    },
    repos: {
      list: () => call(IPC_CHANNELS.reposList),
      search: (query: string) => call(IPC_CHANNELS.reposSearch, query),
    },
    pullRequests: {
      list: (repo: string) => call(IPC_CHANNELS.pullsList, repo),
      load: (repo: string, number: number) => call(IPC_CHANNELS.pullsLoad, repo, number),
    },
    providers: {
      list: () => call(IPC_CHANNELS.providersList),
    },
    review: {
      generate: (input) => call(IPC_CHANNELS.reviewGenerate, input),
      post: (input) => call(IPC_CHANNELS.reviewPost, input),
    },
    mcp: {
      status: () => call(IPC_CHANNELS.mcpStatus),
      setup: () => call(IPC_CHANNELS.mcpSetup),
    },
    system: {
      health: () => call(IPC_CHANNELS.systemHealth),
      openExternal: (url: string) => call(IPC_CHANNELS.systemOpenExternal, url),
      backendState: () => latest,
      refreshBackendState: async () => {
        const state = (await invoke(IPC_CHANNELS.systemBackendState)) as BackendState;
        if (state && typeof state === 'object' && 'status' in state) {
          latest = state;
        }
        return latest;
      },
      onBackendState: (listener) => subscribe(listener),
    },
  } as PrReviewerApi;
}

const api = createApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (listener) => {
    const wrapped = (_event: unknown, state: BackendState) => listener(state);
    ipcRenderer.on(BACKEND_STATE_EVENT, wrapped);
    return () => {
      ipcRenderer.removeListener(BACKEND_STATE_EVENT, wrapped);
    };
  },
  { status: 'starting' },
);

// Pull the real state as soon as the preload loads. A ready event that fired
// while the page was still loading must not leave the UI stuck on "starting".
void api.system.refreshBackendState().catch(() => {
  /* main may not be ready for invokes for a brief moment */
});

contextBridge.exposeInMainWorld('prReviewer', api);
