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
