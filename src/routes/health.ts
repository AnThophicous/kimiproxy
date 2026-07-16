import type { Context } from 'hono';
import { listAccounts, getProfilePath } from '../services/playwright.ts';
import { getDefaultAccountId, listStoredAccounts, storePath } from '../account/store.ts';
import { isAutoRecycleEnabled } from '../account/auto-recycle.ts';
import { poolSnapshot } from '../account/pool.ts';

export function health(c: Context) {
  const runtime = listAccounts().map((id) => ({
    id,
    profile: getProfilePath(id),
  }));
  const stored = listStoredAccounts();
  return c.json({
    status: 'ok',
    default_account: process.env.KIMI_ACCOUNT || getDefaultAccountId(),
    account_store: storePath(),
    auto_recycle: isAutoRecycleEnabled(),
    auto_recycle_headless: (process.env.KIMI_AUTO_RECYCLE_HEADLESS || 'false').toLowerCase() === 'true',
    pool: poolSnapshot(),
    accounts: stored,
    runtime_sessions: runtime,
  });
}
