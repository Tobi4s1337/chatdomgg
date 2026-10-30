import { z } from 'zod';

/** Stable failure codes. Messages are bounded so a hostile or broken source cannot flood logs or the ledger. */
export type AtlasErrorCode =
  | 'config'
  | 'source-http'
  | 'source-schema'
  | 'source-incoherent'
  | 'inventory-missing'
  | 'inventory-empty'
  | 'inventory-invalid'
  | 'store'
  | 'check';

export const MAX_ERROR_MESSAGE = 600;
export const MAX_ERROR_DETAILS = 5;

export class AtlasError extends Error {
  readonly code: AtlasErrorCode;
  readonly details: readonly string[];

  constructor(code: AtlasErrorCode, message: string, details: readonly string[] = []) {
    super(bound(message, MAX_ERROR_MESSAGE));
    this.name = 'AtlasError';
    this.code = code;
    this.details = details.slice(0, MAX_ERROR_DETAILS).map((detail) => bound(detail, 200));
  }
}

export function bound(text: string, max: number): string {
  // Strip control characters before truncating; source text is never trusted for a terminal.
  let clean = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    clean += (code < 32 && code !== 9 && code !== 10) || code === 127 ? '?' : char;
  }
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** At most a few issue paths; never echoes the received values themselves. */
export function zodDetails(error: z.ZodError): string[] {
  const details = error.issues.slice(0, MAX_ERROR_DETAILS).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  if (error.issues.length > MAX_ERROR_DETAILS) details.push(`… ${error.issues.length - MAX_ERROR_DETAILS} more issues`);
  return details;
}

export function asAtlasError(error: unknown, fallback: AtlasErrorCode): AtlasError {
  if (error instanceof AtlasError) return error;
  if (error instanceof z.ZodError) return new AtlasError(fallback, 'Input failed validation.', zodDetails(error));
  return new AtlasError(fallback, error instanceof Error ? error.message : String(error));
}
