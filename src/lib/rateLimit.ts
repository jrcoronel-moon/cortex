// In-memory rate limiter for single-process Node.js apps
// Tracks request timestamps per key and enforces window-based limits

const store = new Map<string, number[]>();
const cleanupInterval = 60000; // Clean up expired entries every 60s

// Auto-cleanup every minute to prevent memory leak
setInterval(() => {
  const keysToDelete: string[] = [];
  store.forEach((timestamps, key) => {
    if (timestamps.length === 0) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => store.delete(key));
}, cleanupInterval);

export function rateLimitCheck(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();

  if (!store.has(key)) {
    store.set(key, []);
  }

  const timestamps = store.get(key)!;

  // Remove timestamps outside the window
  const validTimestamps = timestamps.filter(t => now - t < windowMs);

  if (validTimestamps.length < maxRequests) {
    validTimestamps.push(now);
    store.set(key, validTimestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Rate limit exceeded
  const oldestTimestamp = validTimestamps[0];
  const retryAfterMs = windowMs - (now - oldestTimestamp);
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

  return { allowed: false, retryAfterSeconds };
}
