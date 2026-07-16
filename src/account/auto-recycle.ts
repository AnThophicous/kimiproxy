import { recycleAccount } from './recycle.ts';
import { clearAccountCache, resolveAccountId } from '../services/playwright.ts';
import { markRecycled, upsertAccount } from './store.ts';
import type { BrowserType } from '../services/playwright.ts';
import {
  isExhausted,
  isRecycling,
  markExhausted,
  markRecycling,
  pickNextAccount,
} from './pool.ts';

const locks = new Map<string, Promise<void>>();
const lastRecycleAt = new Map<string, number>();

const COOLDOWN_MS = Number(process.env.KIMI_RECYCLE_COOLDOWN_MS || 3 * 60 * 1000);

function autoEnabled(): boolean {
  const v = (process.env.KIMI_AUTO_RECYCLE || 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function recycleHeadless(): boolean {
  const v = (process.env.KIMI_AUTO_RECYCLE_HEADLESS || 'false').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function browserType(): BrowserType {
  return (process.env.BROWSER as BrowserType) || 'chromium';
}

export function isAutoRecycleEnabled(): boolean {
  return autoEnabled();
}

export function pickFallbackAccount(currentId: string): string | null {
  return pickNextAccount(currentId);
}

export function beginRecycleInBackground(accountId?: string | null): {
  accountId: string;
  promise: Promise<void>;
  alreadyRunning: boolean;
} {
  const id = resolveAccountId(accountId);

  if (!autoEnabled()) {
    return {
      accountId: id,
      alreadyRunning: false,
      promise: Promise.reject(
        new Error('KIMI_AUTO_RECYCLE desligado — limite detectado mas recycle automático não roda')
      ),
    };
  }

  const last = lastRecycleAt.get(id) || 0;
  if (Date.now() - last < COOLDOWN_MS && !isRecycling(id)) {
    markExhausted(id, COOLDOWN_MS - (Date.now() - last));
    const existing = locks.get(id);
    if (existing) {
      return { accountId: id, promise: existing, alreadyRunning: true };
    }
  }

  const existing = locks.get(id);
  if (existing) {
    return { accountId: id, promise: existing, alreadyRunning: true };
  }

  markRecycling(id, true);
  markExhausted(id, COOLDOWN_MS);

  const job = (async () => {
    console.log('');
    console.log(`[auto-recycle] LIMITE → recycle em background account="${id}"`);
    console.log('[auto-recycle] outras requests usam fallback de contas prontas');
    upsertAccount(id, {
      notes: `auto-recycle@${new Date().toISOString()}`,
      kimiReady: false,
    });

    try {
      await recycleAccount({
        accountId: id,
        headless: recycleHeadless(),
        browserType: browserType(),
        confirmWord: process.env.KIMI_DELETE_CONFIRM || 'DELETE',
        skipDelete: false,
        skipLogin: false,
        pauseMsAfterDelete: 4000,
      });
      await clearAccountCache(id);
      markRecycled(id);
      lastRecycleAt.set(id, Date.now());
      console.log(`[auto-recycle] account="${id}" pronta de novo`);
    } catch (err) {
      console.error(`[auto-recycle] falhou account="${id}":`, err);
      upsertAccount(id, {
        kimiReady: false,
        notes: `auto-recycle failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    } finally {
      markRecycling(id, false);
      console.log('');
    }
  })();

  locks.set(id, job);
  void job.finally(() => {
    locks.delete(id);
  });

  return { accountId: id, promise: job, alreadyRunning: false };
}

export async function runAutoRecycle(accountId?: string | null): Promise<void> {
  const { promise } = beginRecycleInBackground(accountId);
  await promise;
}

export function accountIsUnavailable(accountId: string): boolean {
  const id = resolveAccountId(accountId);
  return isRecycling(id) || isExhausted(id);
}
