import type { Page, BrowserContext } from 'playwright';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function hasGoogleSession(context: BrowserContext): Promise<boolean> {
  try {
    const cookies = await context.cookies('https://accounts.google.com');
    const names = new Set(cookies.map((c) => c.name));
    return (
      names.has('SID') ||
      names.has('HSID') ||
      names.has('SSID') ||
      names.has('APISID') ||
      names.has('SAPISID') ||
      names.has('__Secure-1PSID') ||
      names.has('__Secure-3PSID')
    );
  } catch {
    return false;
  }
}

export async function readGoogleEmail(page: Page): Promise<string | undefined> {
  try {
    const url = page.url();
    if (!url.includes('google.com')) {
      await page.goto('https://myaccount.google.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }
    await sleep(1200);
    const email = await page.evaluate(() => {
      const candidates = [
        ...Array.from(document.querySelectorAll('[data-email]')),
        ...Array.from(document.querySelectorAll('a[aria-label*="@"]')),
        ...Array.from(document.querySelectorAll('div[data-identifier]')),
      ];
      for (const el of candidates) {
        const v =
          el.getAttribute('data-email') ||
          el.getAttribute('data-identifier') ||
          el.getAttribute('aria-label') ||
          el.textContent ||
          '';
        const m = v.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (m) return m[0];
      }
      const body = document.body?.innerText || '';
      const m2 = body.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      return m2?.[0];
    });
    return email || undefined;
  } catch {
    return undefined;
  }
}

export async function prepareGoogleInProfile(page: Page): Promise<{
  ready: boolean;
  email?: string;
}> {
  console.log('[google] abrindo accounts.google.com neste profile do Playwright...');
  await page.goto('https://accounts.google.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await sleep(1500);

  const context = page.context();
  let ready = await hasGoogleSession(context);
  if (ready) {
    const email = await readGoogleEmail(page);
    console.log('[google] sessão Google já presente neste profile', email || '');
    return { ready: true, email };
  }

  console.log('');
  console.log('>>> LOGUE O GOOGLE NESTA JANELA DO PLAYWRIGHT <<<');
  console.log('    (é o "Chrome" desta conta — a sessão fica salva no profile)');
  console.log('    Quando terminar o login Google, volte ao CMD e pressione ENTER.');
  console.log('');

  return { ready: false };
}

export async function waitGoogleReady(
  page: Page,
  timeoutMs = 10 * 60 * 1000
): Promise<{ ready: boolean; email?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await hasGoogleSession(page.context());
    if (ready) {
      const email = await readGoogleEmail(page).catch(() => undefined);
      return { ready: true, email };
    }
    await sleep(2000);
  }
  return { ready: false };
}

export async function kimiLoginWithStickyGoogle(page: Page) {
  console.log('[google] Kimi ← Google sticky (sem pedir conta se só houver 1 logada)');
  await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  const alreadyChat = await page
    .locator('textarea:visible, [contenteditable="true"]:visible')
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyChat) {
    console.log('[google] já está no chat Kimi');
    return;
  }

  const googleBtn = page
    .locator(
      [
        'button:has-text("Continue with Google")',
        'button:has-text("Sign in with Google")',
        'button:has-text("Log in with Google")',
        'button:has-text("Entrar com o Google")',
        'button:has-text("Google")',
        'div[role="button"]:has-text("Google")',
        'a:has-text("Google")',
      ].join(', ')
    )
    .first();

  const popupPromise = page.context().waitForEvent('page', { timeout: 20000 }).catch(() => null);
  if (await googleBtn.isVisible().catch(() => false)) {
    await googleBtn.click({ force: true });
  } else {
    throw new Error('Botão Google do Kimi não apareceu — faça login manual e ENTER no CMD');
  }

  const popup = await popupPromise;
  const g = popup || page;
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});

  await sleep(1500);

  const accounts = g.locator('[data-identifier], div[data-email], li div[data-identifier]');
  const count = await accounts.count().catch(() => 0);
  if (count === 1) {
    console.log('[google] 1 conta Google no profile → clique automático');
    await accounts.first().click({ force: true }).catch(() => {});
  } else if (count > 1) {
    console.log(`[google] ${count} contas Google — escolhendo a primeira (deixe só 1 no profile idealmente)`);
    await accounts.first().click({ force: true }).catch(() => {});
  } else {
    console.log('[google] sem lista de contas (já autenticado ou precisa login manual)');
  }

  for (const text of ['Continue', 'Continuar', 'Next', 'Avançar', 'Allow', 'Permitir']) {
    const btn = g.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      await sleep(800);
    }
  }

  if (popup && !popup.isClosed()) {
    await popup.waitForEvent('close', { timeout: 120000 }).catch(() => {});
  }

  await page.bringToFront().catch(() => {});
  await page
    .waitForSelector('textarea:visible, [contenteditable="true"]:visible', { timeout: 120000 })
    .catch(() => {
      throw new Error('Chat Kimi não abriu após Google — complete na janela se necessário');
    });
  console.log('[google] Kimi logado via Google sticky');
}
