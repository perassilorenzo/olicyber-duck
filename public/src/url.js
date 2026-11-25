/** Validazione URL condivisa tra frontend e importatori: solo HTTPS assoluti. */

export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function hasUnsafeUrl(value) {
  return typeof value === 'string' && value.trim() !== '' && safeHttpsUrl(value) === null;
}
