/**
 * Navigation and window guards for the renderer.
 *
 * The renderer may only load the local frontend. Everything else is either
 * blocked or handed to the system browser.
 */

export const ALLOWED_EXTERNAL_PROTOCOLS = ['https:'] as const;

/** Hosts the renderer is allowed to open in the system browser. */
export const ALLOWED_EXTERNAL_HOSTS = [
  'github.com',
  'www.github.com',
  'cli.github.com',
  'docs.anthropic.com',
] as const;

export interface NavigationPolicy {
  /** The dev server origin, e.g. `http://127.0.0.1:5173`. Empty when packaged. */
  devServerOrigin: string;
}

/** True when the renderer may navigate the main frame to `url` itself. */
export function isAllowedNavigation(url: string, policy: NavigationPolicy): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === 'file:') {
    return true;
  }

  if (policy.devServerOrigin && parsed.origin === policy.devServerOrigin) {
    return true;
  }

  return false;
}

/** True when `url` may be handed to the user's system browser. */
export function isAllowedExternal(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.includes(parsed.protocol as 'https:')) {
    return false;
  }

  return (ALLOWED_EXTERNAL_HOSTS as readonly string[]).includes(parsed.hostname);
}

export interface WebContentsLike {
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void;
  on(
    event: 'will-attach-webview',
    listener: (event: { preventDefault(): void }, params: unknown) => void,
  ): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

export interface ShellLike {
  openExternal(url: string): Promise<void>;
}

/**
 * Block main-frame navigation away from the frontend, deny every new window,
 * and route approved links to the system browser.
 */
export function attachWindowGuards(
  contents: WebContentsLike,
  policy: NavigationPolicy,
  shell: ShellLike,
): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, policy)) {
      event.preventDefault();
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}
