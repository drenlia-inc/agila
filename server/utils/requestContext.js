import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** Keep the impersonator id for activity written during this request. */
export function runWithImpersonator(impersonatorId, fn) {
  return storage.run({ impersonatorId: impersonatorId || null }, fn);
}

export function currentImpersonatorId() {
  const id = storage.getStore()?.impersonatorId;
  return typeof id === 'string' && id ? id : null;
}
