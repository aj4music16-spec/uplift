/**
 * The database speaks snake_case, the app camelCase. Keys are converted
 * recursively in both directions; values are never touched.
 */
function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function snakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function convert(value: unknown, keyFn: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => convert(item, keyFn));
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[keyFn(key)] = convert(inner, keyFn);
    return out;
  }
  return value;
}

export function camelize<T = unknown>(value: unknown): T {
  return convert(value, camelKey) as T;
}

export function snakeize<T = unknown>(value: unknown): T {
  return convert(value, snakeKey) as T;
}
