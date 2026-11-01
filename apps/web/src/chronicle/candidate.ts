/** Seek cancellation owns only preparation. Once promoted, the overlay owns the scene's lifetime. */
export function createCandidateLifetime(request: AbortSignal | undefined, owner: AbortSignal) {
  const controller = new AbortController();
  const requested = () => controller.abort(request?.reason);
  const closed = () => controller.abort(owner.reason);
  request?.addEventListener('abort', requested, { once: true });
  owner.addEventListener('abort', closed, { once: true });
  if (request?.aborted) requested();
  if (owner.aborted) closed();
  return {
    signal: controller.signal,
    promote() { request?.removeEventListener('abort', requested); },
    dispose() { request?.removeEventListener('abort', requested); owner.removeEventListener('abort', closed); controller.abort(); },
  };
}
