import { DATA_MUTATED_EVENT, type DataMutationDetail } from './data-invalidation';

const DEFAULT_BACKGROUND_REVALIDATION_MS = 60_000;

export function shouldRevalidateSession(
  hiddenAt: number,
  now = Date.now(),
  forced = false,
  minimumBackgroundMs = DEFAULT_BACKGROUND_REVALIDATION_MS,
): boolean {
  if (forced) return true;
  return hiddenAt > 0 && now - hiddenAt >= minimumBackgroundMs;
}
/** Project creation changes the server-resolved project scope even for an
 * existing workspace administrator. Refresh the session, never synthesize grants. */
export function subscribeProjectAccessChanges(onChange: () => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Partial<DataMutationDetail>>).detail;
    if (typeof detail?.method !== 'string' || detail.method.toUpperCase() !== 'POST' || typeof detail.target !== 'string') return;
    try {
      const url = new URL(detail.target, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.replace(/\/$/, '') === '/api/catalog/projects') onChange();
    } catch { /* A malformed notification must not invalidate a valid session. */ }
  };
  window.addEventListener(DATA_MUTATED_EVENT, listener);
  return () => window.removeEventListener(DATA_MUTATED_EVENT, listener);
}
