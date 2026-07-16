import {
  getDefaultAccountId,
  listStoredAccounts,
  loadAccountStore,
  upsertAccount,
} from './store.ts';
import { sanitizeAccountId } from '../services/playwright.ts';

const recycling = new Set<string>();
const exhaustedUntil = new Map<string, number>();
let rr = 0;

export function markRecycling(accountId: string, busy: boolean) {
  const id = sanitizeAccountId(accountId);
  if (busy) {
    recycling.add(id);
    upsertAccount(id, { kimiReady: false, notes: `recycling@${new Date().toISOString()}` });
  } else {
    recycling.delete(id);
  }
}

export function isRecycling(accountId: string): boolean {
  return recycling.has(sanitizeAccountId(accountId));
}

export function markExhausted(accountId: string, ms = 60_000) {
  const id = sanitizeAccountId(accountId);
  exhaustedUntil.set(id, Date.now() + ms);
}

export function isExhausted(accountId: string): boolean {
  const id = sanitizeAccountId(accountId);
  const until = exhaustedUntil.get(id) || 0;
  if (until && until < Date.now()) {
    exhaustedUntil.delete(id);
    return false;
  }
  return until > Date.now();
}

export function listReadyAccounts(exclude: string[] = []): string[] {
  const ex = new Set(exclude.map(sanitizeAccountId));
  const stored = listStoredAccounts();
  const ready = stored
    .filter((a) => {
      if (ex.has(a.id)) return false;
      if (isRecycling(a.id)) return false;
      if (isExhausted(a.id)) return false;
      return a.googleReady && a.kimiReady;
    })
    .map((a) => a.id);

  if (ready.length) return ready;

  const fallback = stored
    .filter((a) => !ex.has(a.id) && !isRecycling(a.id) && a.googleReady)
    .map((a) => a.id);
  return fallback;
}

export function pickNextAccount(exclude: string | string[] = []): string | null {
  const ex = Array.isArray(exclude) ? exclude : [exclude];
  const ready = listReadyAccounts(ex);
  if (!ready.length) return null;
  rr = (rr + 1) % ready.length;
  return ready[rr];
}

export function getPreferredAccount(requested?: string | null): string {
  const storeDefault = (() => {
    try {
      return getDefaultAccountId();
    } catch {
      return 'default';
    }
  })();

  const req = requested?.trim()
    ? sanitizeAccountId(requested)
    : sanitizeAccountId(process.env.KIMI_ACCOUNT || storeDefault);

  if (!isRecycling(req) && !isExhausted(req)) {
    const acc = listStoredAccounts().find((a) => a.id === req);
    if (!acc || acc.kimiReady || acc.googleReady) return req;
  }

  const next = pickNextAccount(req);
  return next || req;
}

export function poolSnapshot() {
  const store = loadAccountStore();
  return {
    defaultAccountId: store.defaultAccountId,
    recycling: [...recycling],
    exhausted: [...exhaustedUntil.entries()].map(([id, until]) => ({
      id,
      until,
      msLeft: Math.max(0, until - Date.now()),
    })),
    ready: listReadyAccounts(),
    accounts: listStoredAccounts().map((a) => ({
      id: a.id,
      kimiReady: a.kimiReady,
      googleReady: a.googleReady,
      recycling: isRecycling(a.id),
      exhausted: isExhausted(a.id),
    })),
  };
}
