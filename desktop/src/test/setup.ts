/** Test environment shims. No test may reach the network or a real Electron API. */

import { vi } from 'vitest';

if (!('clipboard' in navigator)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}

// A renderer must never see Node. Assert it and keep it that way.
Reflect.deleteProperty(globalThis as Record<string, unknown>, 'require');
Reflect.deleteProperty(globalThis as Record<string, unknown>, 'module');
