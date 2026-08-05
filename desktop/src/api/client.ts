/**
 * Thin wrapper over the preload bridge.
 *
 * It turns the `{success, data, error}` envelope into a discriminated result
 * so components never check three fields by hand.
 */

import type { ApiError, ApiResult } from '../types';

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const UNKNOWN: ApiError = {
  code: 'UNKNOWN',
  message: 'The desktop bridge returned an unexpected result.',
};

export async function call<T>(operation: () => Promise<ApiResult<T>>): Promise<Outcome<T>> {
  let envelope: ApiResult<T>;
  try {
    envelope = await operation();
  } catch {
    return { ok: false, error: { code: 'BRIDGE_ERROR', message: 'The desktop bridge is not available.' } };
  }
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, error: UNKNOWN };
  }
  if (envelope.success && envelope.data !== null) {
    return { ok: true, value: envelope.data };
  }
  return { ok: false, error: envelope.error ?? UNKNOWN };
}

/** The bridge, or a clear failure if the preload did not load. */
export function bridge() {
  return window.prReviewer;
}
