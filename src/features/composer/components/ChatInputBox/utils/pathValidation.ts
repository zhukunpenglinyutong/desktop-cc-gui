/**
 * Validate a file path to prevent path traversal attacks.
 * Returns the sanitized path, or null if the path is suspicious.
 */
export function validateFilePath(filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) return null;
  if (trimmed.length > 4096) return null;

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/\\/g, '/');

  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return null;
  }

  const parts = normalized.split('/');
  const sanitizedParts: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    sanitizedParts.push(part);
  }

  const sanitized = sanitizedParts.join('/');
  if (!sanitized) return null;

  const sensitivePatterns = [
    '/etc/passwd', '/etc/shadow', '/proc/', '/sys/',
    '/.ssh/', '/.env', '/.aws/', '/.gnupg/',
  ];
  const lower = `/${sanitized.toLowerCase()}`;
  if (sensitivePatterns.some(p => lower.includes(p))) {
    return null;
  }

  return sanitized;
}
