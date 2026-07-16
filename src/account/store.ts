import fs from 'fs';
import path from 'path';
import { sanitizeAccountId } from '../services/playwright.ts';

export type StoredAccount = {
  id: string;
  label: string;
  profilePath: string;
  googleEmail?: string;
  kimiReady: boolean;
  googleReady: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastRecycleAt?: string;
  notes?: string;
};

type AccountStoreFile = {
  version: 1;
  defaultAccountId: string;
  accounts: Record<string, StoredAccount>;
};

const ROOT = path.resolve('kimi_profiles');
const STORE_PATH = path.join(ROOT, 'accounts.json');
const LEGACY_PROFILE = path.resolve('kimi_profile');

function nowIso() {
  return new Date().toISOString();
}

function emptyStore(): AccountStoreFile {
  return {
    version: 1,
    defaultAccountId: 'default',
    accounts: {},
  };
}

export function ensureStoreDirs() {
  fs.mkdirSync(ROOT, { recursive: true });
}

export function profilePathFor(accountId: string): string {
  const id = sanitizeAccountId(accountId);
  if (id === 'default' && fs.existsSync(LEGACY_PROFILE)) {
    const modern = path.join(ROOT, 'default');
    if (!fs.existsSync(modern)) return LEGACY_PROFILE;
  }
  return path.join(ROOT, id);
}

export function loadAccountStore(): AccountStoreFile {
  ensureStoreDirs();
  if (!fs.existsSync(STORE_PATH)) {
    const store = emptyStore();
    if (fs.existsSync(LEGACY_PROFILE)) {
      const id = 'default';
      store.accounts[id] = {
        id,
        label: 'default',
        profilePath: LEGACY_PROFILE,
        kimiReady: true,
        googleReady: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        notes: 'migrated from legacy kimi_profile/',
      };
    }
    saveAccountStore(store);
    return store;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as AccountStoreFile;
    if (!parsed.accounts) parsed.accounts = {};
    if (!parsed.defaultAccountId) parsed.defaultAccountId = 'default';
    return parsed;
  } catch {
    const store = emptyStore();
    saveAccountStore(store);
    return store;
  }
}

export function saveAccountStore(store: AccountStoreFile) {
  ensureStoreDirs();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export function listStoredAccounts(): StoredAccount[] {
  const store = loadAccountStore();
  return Object.values(store.accounts).sort((a, b) => a.id.localeCompare(b.id));
}

export function getDefaultAccountId(): string {
  return loadAccountStore().defaultAccountId || 'default';
}

export function setDefaultAccountId(accountId: string) {
  const store = loadAccountStore();
  const id = sanitizeAccountId(accountId);
  if (!store.accounts[id]) {
    throw new Error(`Conta "${id}" não existe no store. Faça login/add antes.`);
  }
  store.defaultAccountId = id;
  saveAccountStore(store);
  return id;
}

export function upsertAccount(
  accountId: string,
  patch: Partial<StoredAccount> = {}
): StoredAccount {
  const store = loadAccountStore();
  const id = sanitizeAccountId(accountId);
  const profilePath = profilePathFor(id);
  fs.mkdirSync(profilePath, { recursive: true });

  const prev = store.accounts[id];
  const next: StoredAccount = {
    id,
    label: patch.label || prev?.label || id,
    profilePath,
    googleEmail: patch.googleEmail ?? prev?.googleEmail,
    kimiReady: patch.kimiReady ?? prev?.kimiReady ?? false,
    googleReady: patch.googleReady ?? prev?.googleReady ?? false,
    createdAt: prev?.createdAt || nowIso(),
    updatedAt: nowIso(),
    lastLoginAt: patch.lastLoginAt ?? prev?.lastLoginAt,
    lastRecycleAt: patch.lastRecycleAt ?? prev?.lastRecycleAt,
    notes: patch.notes ?? prev?.notes,
  };
  store.accounts[id] = next;
  if (!store.defaultAccountId || !store.accounts[store.defaultAccountId]) {
    store.defaultAccountId = id;
  }
  saveAccountStore(store);
  return next;
}

export function markGoogleReady(accountId: string, email?: string) {
  return upsertAccount(accountId, {
    googleReady: true,
    googleEmail: email,
    updatedAt: nowIso(),
  });
}

export function markKimiReady(accountId: string) {
  return upsertAccount(accountId, {
    kimiReady: true,
    lastLoginAt: nowIso(),
  });
}

export function markRecycled(accountId: string) {
  return upsertAccount(accountId, {
    lastRecycleAt: nowIso(),
    kimiReady: true,
    googleReady: true,
  });
}

export function removeAccountFromStore(accountId: string, deleteProfile = false) {
  const store = loadAccountStore();
  const id = sanitizeAccountId(accountId);
  const acc = store.accounts[id];
  if (!acc) return false;
  delete store.accounts[id];
  if (store.defaultAccountId === id) {
    store.defaultAccountId = Object.keys(store.accounts)[0] || 'default';
  }
  saveAccountStore(store);
  if (deleteProfile && acc.profilePath && fs.existsSync(acc.profilePath)) {
    if (path.resolve(acc.profilePath) !== path.resolve(LEGACY_PROFILE)) {
      fs.rmSync(acc.profilePath, { recursive: true, force: true });
    }
  }
  return true;
}

export function storePath(): string {
  return STORE_PATH;
}
