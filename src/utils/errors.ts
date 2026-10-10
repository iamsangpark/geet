/**
 * errors.ts
 * Error type carrying a clean, user-facing message in `.gitMessage`.
 * The top-level handler in index.ts prints `err.gitMessage || err.message`.
 */

export class GeetError extends Error {
  gitMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'GeetError';
    this.gitMessage = message;
  }
}

/** Reads `.code` (e.g. 'ENOENT') off an unknown caught value. */
export function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

/** Best-effort message from an unknown caught value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The clean user-facing message for a caught value: `.gitMessage` if set, else `.message`. */
export function userMessage(err: unknown): string {
  if (err instanceof GeetError) return err.gitMessage || err.message;
  const gitMessage = (err as { gitMessage?: unknown } | null)?.gitMessage;
  return (typeof gitMessage === 'string' && gitMessage) || errorMessage(err);
}
