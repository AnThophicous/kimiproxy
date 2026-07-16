import type { Page, Request } from 'playwright';
import { ensureAccount, getProfilePath, clearAccountCache } from '../services/playwright.ts';
import { kimiLoginWithStickyGoogle } from './google.ts';
import { markRecycled, upsertAccount } from './store.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function firstVisible(page: Page, selectors: string[], timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          return loc;
        }
      } catch {
      }
    }
    await sleep(150);
  }
  return null;
}

async function clickFirst(page: Page, selectors: string[], label: string, timeoutMs = 8000) {
  const el = await firstVisible(page, selectors, timeoutMs);
  if (!el) {
    throw new Error(`Não achei elemento para: ${label}`);
  }
  console.log(`[recycle] click: ${label}`);
  await el.click({ force: true, timeout: 5000 });
  await sleep(700);
  return el;
}

async function clickText(page: Page, patterns: RegExp[], label: string, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const re of patterns) {
      try {
        const loc = page.getByText(re).first();
        if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
          console.log(`[recycle] click text: ${label} ~ ${re}`);
          await loc.click({ force: true });
          await sleep(700);
          return true;
        }
      } catch {
      }
    }
    await sleep(200);
  }
  return false;
}

async function typeIfNeeded(page: Page, selectors: string[], text: string, label: string) {
  const el = await firstVisible(page, selectors, 2500);
  if (!el) return false;
  console.log(`[recycle] type: ${label} = ${text}`);
  await el.click({ force: true }).catch(() => {});
  await el.fill('').catch(() => {});
  await el.fill(text).catch(async () => {
    await page.keyboard.type(text, { delay: 30 });
  });
  await sleep(300);
  return true;
}

function attachDeleteNetworkSpy(page: Page) {
  const hits: string[] = [];
  const onReq = (req: Request) => {
    const u = req.url().toLowerCase();
    if (
      u.includes('delete') ||
      u.includes('cancel') ||
      u.includes('unregister') ||
      u.includes('closeaccount') ||
      u.includes('deactivate') ||
      u.includes('destroy')
    ) {
      hits.push(`${req.method()} ${req.url()}`);
      console.log(`[recycle] net delete-like: ${req.method()} ${req.url()}`);
    }
  };
  page.on('request', onReq);
  return {
    hits,
    dispose: () => page.off('request', onReq),
  };
}

export async function hardDeleteKimiAccount(page: Page, confirmWord = 'DELETE') {
  console.log('[recycle] DELETE real da conta Kimi (UI agressiva)');
  const spy = attachDeleteNetworkSpy(page);

  const entryUrls = [
    'https://www.kimi.com/settings',
    'https://www.kimi.com/user/settings',
    'https://www.kimi.com/settings/account',
    'https://www.kimi.com/settings/security',
    'https://www.kimi.com/',
  ];

  let deletedSignal = false;

  try {
    for (const url of entryUrls) {
      console.log(`[recycle] goto ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(1200);

      await clickText(
        page,
        [/settings/i, /configura/i, /设置/, /账号/, /account/i],
        'settings-ish',
        2500
      ).catch(() => false);

      try {
        const avatar = await firstVisible(
          page,
          [
            'header img[src*="avatar"]',
            'header button:has(img)',
            '[class*="avatar"]',
            'button:has(img[src*="googleusercontent"])',
            'img[src*="googleusercontent"]',
          ],
          2500
        );
        if (avatar) {
          await avatar.click({ force: true });
          await sleep(600);
        }
      } catch {
      }

      await clickText(
        page,
        [/settings/i, /configura/i, /设置/],
        'settings menu',
        3000
      ).catch(() => false);

      await clickText(
        page,
        [/account security/i, /segurança/i, /账号安全/, /account/i, /conta/i, /security/i],
        'security',
        3000
      ).catch(() => false);

      const openedDelete = await clickText(
        page,
        [
          /delete account/i,
          /excluir conta/i,
          /apagar conta/i,
          /remover conta/i,
          /注销账号/,
          /删除账号/,
          /delete/i,
        ],
        'delete entry',
        4000
      );

      if (!openedDelete) {
        const delBtn = await firstVisible(
          page,
          [
            'button:has-text("Delete Account")',
            'button:has-text("Delete")',
            'a:has-text("Delete Account")',
            'text=Delete Account',
          ],
          2000
        );
        if (delBtn) {
          await delBtn.click({ force: true });
          await sleep(800);
        } else {
          continue;
        }
      }

      for (const word of [confirmWord, 'DELETE', 'Delete', 'delete', '确认', 'EXCLUIR']) {
        await typeIfNeeded(
          page,
          [
            'input[placeholder*="DELETE" i]',
            'input[placeholder*="delete" i]',
            'input[placeholder*="Delete" i]',
            '[role="dialog"] input[type="text"]',
            '[role="dialog"] input',
            'input[type="text"]',
          ],
          word,
          'confirm input'
        );
      }

      for (let step = 0; step < 5; step++) {
        const confirmed = await clickText(
          page,
          [
            /^delete$/i,
            /delete account/i,
            /confirm/i,
            /confirmar/i,
            /excluir/i,
            /continue/i,
            /submit/i,
            /注销/,
            /删除/,
            /确定/,
          ],
          `confirm step ${step + 1}`,
          2500
        );
        if (!confirmed) {
          const btn = await firstVisible(
            page,
            [
              '[role="dialog"] button:has-text("Delete")',
              '[role="dialog"] button:has-text("Confirm")',
              '[role="dialog"] button:has-text("Confirmar")',
              '[role="dialog"] button:has-text("Excluir")',
              'button:has-text("Delete Account")',
              'button:has-text("Delete")',
            ],
            1500
          );
          if (btn) {
            await btn.click({ force: true }).catch(() => {});
            await sleep(900);
          } else break;
        } else {
          await sleep(1000);
        }
      }

      const out = await waitLoggedOut(page, 20000);
      if (out || spy.hits.length > 0) {
        deletedSignal = true;
        console.log('[recycle] sinal de delete/logout capturado');
        break;
      }
    }
  } finally {
    spy.dispose();
  }

  if (!deletedSignal) {
    const out = await waitLoggedOut(page, 15000);
    deletedSignal = out;
  }

  if (!deletedSignal) {
    throw new Error(
      'Não confirmei delete automático. UI do Kimi mudou ou falta passo manual de confirmação.'
    );
  }

  console.log('[recycle] conta Kimi deletada / sessão encerrada');
  return true;
}

export async function waitLoggedOut(page: Page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    const loginBtn = await firstVisible(
      page,
      [
        'text=Continue with Google',
        'text=Sign in with Google',
        'text=Log in with Google',
        'text=Entrar com o Google',
        'button:has-text("Google")',
        'text=Sign in',
        'text=Log in',
        'text=Entrar',
      ],
      600
    );
    if (
      loginBtn ||
      /login|signin|sign-in|auth/i.test(url) ||
      (await page.getByText(/continue with google/i).count().catch(() => 0)) > 0
    ) {
      console.log('[recycle] deslogado / tela auth');
      return true;
    }
    await sleep(400);
  }
  return false;
}

export async function loginWithGoogle(page: Page) {
  await kimiLoginWithStickyGoogle(page);
}

export type RecycleOptions = {
  accountId: string;
  headless?: boolean;
  browserType?: 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';
  confirmWord?: string;
  skipDelete?: boolean;
  skipLogin?: boolean;
  pauseMsAfterDelete?: number;
};

export async function recycleAccount(opts: RecycleOptions) {
  const accountId = opts.accountId || 'default';
  console.log('');
  console.log('=== recycle account (DELETE real + Google sticky) ===');
  console.log(`account : ${accountId}`);
  console.log(`profile : ${getProfilePath(accountId)}`);
  console.log(`headless: ${opts.headless ?? false}`);
  console.log('');

  const session = await ensureAccount(accountId, {
    headless: opts.headless ?? false,
    browserType: opts.browserType ?? 'chromium',
  });
  const page = session.page;

  await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  if (!opts.skipDelete) {
    console.log('[recycle] fase DELETE REAL');
    try {
      await hardDeleteKimiAccount(page, opts.confirmWord || 'DELETE');
    } catch (e) {
      console.error('[recycle] hardDelete falhou:', e);
      console.log('[recycle] retry caminho avatar→settings...');
      try {
        await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
        await sleep(800);
        const avatar = await firstVisible(
          page,
          [
            'header button:has(img)',
            '[class*="avatar"]',
            'img[src*="googleusercontent"]',
          ],
          5000
        );
        if (avatar) await avatar.click({ force: true });
        await sleep(500);
        await clickText(page, [/settings/i, /configura/i], 'settings', 4000);
        await hardDeleteKimiAccount(page, opts.confirmWord || 'DELETE');
      } catch (e2) {
        throw new Error(
          `Delete automático falhou: ${e2 instanceof Error ? e2.message : String(e2)}`
        );
      }
    }
    await sleep(opts.pauseMsAfterDelete ?? 3000);
    await clearAccountCache(accountId);
  }

  if (!opts.skipLogin) {
    console.log('[recycle] fase LOGIN Google sticky (profile já tem Google)');
    await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1000);
    await loginWithGoogle(page);
    markRecycled(accountId);
  }

  upsertAccount(accountId, { kimiReady: true, googleReady: true });
  await clearAccountCache(accountId);
  console.log('[recycle] concluído account=', accountId);
  return { accountId, profile: getProfilePath(accountId) };
}

export async function recycleAndClose(opts: RecycleOptions) {
  return recycleAccount(opts);
}
