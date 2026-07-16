import type { Context } from 'hono';
import { sanitizeAccountId } from '../services/playwright.ts';
import { getDefaultAccountId } from '../account/store.ts';

export function accountFromRequest(c: Context, body?: Record<string, any>): string {
  const header =
    c.req.header('x-kimi-account') ||
    c.req.header('x-account-id') ||
    c.req.header('x-account');
  if (header?.trim()) return sanitizeAccountId(header);

  const fromBody =
    body?.metadata?.account ||
    body?.metadata?.kimi_account ||
    body?.user;
  if (fromBody && String(fromBody).trim()) return sanitizeAccountId(String(fromBody));

  if (process.env.KIMI_ACCOUNT?.trim()) {
    return sanitizeAccountId(process.env.KIMI_ACCOUNT);
  }
  try {
    return sanitizeAccountId(getDefaultAccountId());
  } catch {
    return 'default';
  }
}
