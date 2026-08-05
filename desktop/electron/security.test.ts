import { describe, expect, it, vi } from 'vitest';

import { attachWindowGuards, isAllowedExternal, isAllowedNavigation } from './security';

const DEV = { devServerOrigin: 'http://127.0.0.1:5273' };
const PACKAGED = { devServerOrigin: '' };

describe('navigation policy', () => {
  it('allows the packaged frontend over file://', () => {
    expect(isAllowedNavigation('file:///Applications/PR.app/dist/index.html', PACKAGED)).toBe(true);
  });

  it('allows the dev server origin in development', () => {
    expect(isAllowedNavigation('http://127.0.0.1:5273/index.html', DEV)).toBe(true);
  });

  it('blocks the dev server when the app is packaged', () => {
    expect(isAllowedNavigation('http://127.0.0.1:5273/index.html', PACKAGED)).toBe(false);
  });

  it('blocks remote sites, other local ports, and junk', () => {
    expect(isAllowedNavigation('https://evil.example.com', DEV)).toBe(false);
    expect(isAllowedNavigation('http://127.0.0.1:9999/', DEV)).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', DEV)).toBe(false);
    expect(isAllowedNavigation('not-a-url', DEV)).toBe(false);
  });
});

describe('external link policy', () => {
  it('allows the approved https hosts', () => {
    expect(isAllowedExternal('https://github.com/octocat/hello/pull/7')).toBe(true);
    expect(isAllowedExternal('https://cli.github.com')).toBe(true);
  });

  it('rejects other hosts and other protocols', () => {
    expect(isAllowedExternal('https://evil.example.com')).toBe(false);
    expect(isAllowedExternal('http://github.com')).toBe(false);
    expect(isAllowedExternal('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternal('javascript:alert(1)')).toBe(false);
  });
});

describe('attachWindowGuards', () => {
  function fakeContents() {
    const handlers = new Map<string, (event: { preventDefault(): void }, arg: string) => void>();
    return {
      handlers,
      openHandler: null as null | ((details: { url: string }) => { action: 'deny' }),
      on(event: string, listener: (event: { preventDefault(): void }, arg: string) => void) {
        handlers.set(event, listener);
      },
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }) {
        this.openHandler = handler;
      },
    };
  }

  it('prevents navigation that the policy rejects', () => {
    const contents = fakeContents();
    const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    attachWindowGuards(contents as never, DEV, shell);

    const preventDefault = vi.fn();
    contents.handlers.get('will-navigate')?.({ preventDefault }, 'https://evil.example.com');
    expect(preventDefault).toHaveBeenCalledOnce();

    const allowed = vi.fn();
    contents.handlers.get('will-navigate')?.({ preventDefault: allowed }, 'http://127.0.0.1:5273/');
    expect(allowed).not.toHaveBeenCalled();
  });

  it('blocks webview attachment', () => {
    const contents = fakeContents();
    attachWindowGuards(contents as never, DEV, { openExternal: vi.fn() });
    const preventDefault = vi.fn();
    contents.handlers.get('will-attach-webview')?.({ preventDefault }, '');
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('denies every new window and sends approved links to the system browser', () => {
    const contents = fakeContents();
    const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    attachWindowGuards(contents as never, DEV, shell);

    expect(contents.openHandler?.({ url: 'https://github.com/octocat' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/octocat');

    shell.openExternal.mockClear();
    expect(contents.openHandler?.({ url: 'https://evil.example.com' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
});
