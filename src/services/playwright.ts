import { chromium, firefox, webkit, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';

export type KimiHeadersResult = {
  headers: Record<string, string>;
  chatSessionId: string;
  parentMessageId: string | null;
  accountId: string;
};

type AccountSession = {
  id: string;
  profilePath: string;
  context: BrowserContext;
  page: Page;
  currentHeaders: Record<string, string>;
  cachedKimiHeaders: Omit<KimiHeadersResult, 'accountId'> | null;
  lastHeadersTime: number;
  mutex: Mutex;
};

const HEADERS_TTL = 10 * 60 * 1000;
const PROFILES_ROOT = path.resolve('kimi_profiles');
const LEGACY_PROFILE = path.resolve('kimi_profile');

let defaultAccountId = sanitizeAccountId(process.env.KIMI_ACCOUNT || 'default');
let defaultBrowserType: BrowserType = 'chromium';
let defaultHeadless = true;
const sessions = new Map<string, AccountSession>();

export let activePage: Page | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export function sanitizeAccountId(raw: string): string {
  const cleaned = String(raw || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'default';
}

export function resolveAccountId(input?: string | null): string {
  if (input && String(input).trim()) return sanitizeAccountId(input);
  return defaultAccountId;
}

export function getProfilePath(accountId: string): string {
  const id = sanitizeAccountId(accountId);
  if (id === 'default' && fs.existsSync(LEGACY_PROFILE) && !fs.existsSync(path.join(PROFILES_ROOT, 'default'))) {
    return LEGACY_PROFILE;
  }
  return path.join(PROFILES_ROOT, id);
}

export function listAccounts(): string[] {
  const ids = new Set<string>();
  if (fs.existsSync(LEGACY_PROFILE)) ids.add('default');
  if (fs.existsSync(PROFILES_ROOT)) {
    for (const name of fs.readdirSync(PROFILES_ROOT, { withFileTypes: true })) {
      if (name.isDirectory()) ids.add(sanitizeAccountId(name.name));
    }
  }
  for (const id of sessions.keys()) ids.add(id);
  if (ids.size === 0) ids.add('default');
  return [...ids].sort();
}

function browserEngineFor(browserType: BrowserType) {
  let browserEngine: typeof chromium | typeof firefox | typeof webkit = chromium;
  let channel: string | undefined;
  switch (browserType) {
    case 'firefox':
      browserEngine = firefox;
      break;
    case 'webkit':
      browserEngine = webkit;
      break;
    case 'chrome':
      browserEngine = chromium;
      channel = 'chrome';
      break;
    case 'edge':
      browserEngine = chromium;
      channel = 'msedge';
      break;
    default:
      browserEngine = chromium;
  }
  return { browserEngine, channel };
}

async function launchAccount(
  accountId: string,
  headless: boolean,
  browserType: BrowserType
): Promise<AccountSession> {
  const id = sanitizeAccountId(accountId);
  const profilePath = getProfilePath(id);
  fs.mkdirSync(profilePath, { recursive: true });

  const { browserEngine, channel } = browserEngineFor(browserType);
  const args: string[] = [];
  const ignoreDefaultArgs: string[] = [];
  if (browserType === 'chromium' || browserType === 'chrome' || browserType === 'edge') {
    args.push('--disable-blink-features=AutomationControlled');
    ignoreDefaultArgs.push('--enable-automation');
  }

  console.log(`[Playwright] Launching ${browserType} for account="${id}"...`);
  console.log(`[Playwright] Profile: ${profilePath}`);

  const context = await browserEngine.launchPersistentContext(profilePath, {
    headless,
    channel,
    args,
    ignoreDefaultArgs,
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = context.pages()[0] || (await context.newPage());
  const session: AccountSession = {
    id,
    profilePath,
    context,
    page,
    currentHeaders: {},
    cachedKimiHeaders: null,
    lastHeadersTime: 0,
    mutex: new Mutex(),
  };
  sessions.set(id, session);
  if (id === defaultAccountId) activePage = page;
  return session;
}

export async function initPlaywright(
  headless = true,
  browserType: BrowserType = 'chromium',
  accountId?: string
) {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  defaultHeadless = headless;
  defaultBrowserType = browserType;
  const id = resolveAccountId(accountId);
  defaultAccountId = id;
  if (sessions.has(id)) {
    activePage = sessions.get(id)!.page;
    return;
  }
  const session = await launchAccount(id, headless, browserType);
  activePage = session.page;
}

export async function ensureAccount(
  accountId?: string | null,
  opts?: { headless?: boolean; browserType?: BrowserType }
): Promise<AccountSession> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    throw new Error('ensureAccount unavailable in TEST_MOCK_PLAYWRIGHT');
  }
  const id = resolveAccountId(accountId);
  const existing = sessions.get(id);
  if (existing) return existing;
  return launchAccount(
    id,
    opts?.headless ?? defaultHeadless,
    opts?.browserType ?? defaultBrowserType
  );
}

export async function clearAccountCache(accountId?: string | null) {
  const id = resolveAccountId(accountId);
  const session = sessions.get(id);
  if (!session) return;
  session.cachedKimiHeaders = null;
  session.lastHeadersTime = 0;
  session.currentHeaders = {};
}

export async function closeAccount(accountId?: string | null) {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  const id = resolveAccountId(accountId);
  const session = sessions.get(id);
  if (!session) return;
  await session.context.close().catch(() => {});
  sessions.delete(id);
  if (activePage === session.page) activePage = null;
}

export async function closePlaywright() {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  for (const id of [...sessions.keys()]) {
    await closeAccount(id);
  }
  activePage = null;
}

export async function getCookies(accountId?: string | null): Promise<string> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return 'token=mock';
  const session = await ensureAccount(accountId);
  const cookies = await session.context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export async function getBasicHeaders(accountId?: string | null) {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    return { cookie: 'token=mock', userAgent: 'mock', authorization: 'Bearer MOCK' };
  }
  const session = await ensureAccount(accountId);
  const cookie = await getCookies(session.id);
  const userAgent = await session.page.evaluate(() => navigator.userAgent);
  const authorization = session.currentHeaders['authorization'] || '';
  return { cookie, userAgent, authorization };
}

export async function getKimiHeaders(
  forceNew = false,
  accountId?: string | null
): Promise<KimiHeadersResult> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    const mockSessionId = process.env.TEST_SESSION_ID || 'mock-session';
    return {
      headers: {
        authorization: 'Bearer MOCK',
        cookie: 'token=mock',
        'user-agent': 'mock',
        'x-msh-device-id': 'mock-device',
        'x-msh-session-id': 'mock-session-header',
        'x-traffic-id': 'mock-traffic',
      },
      chatSessionId: mockSessionId,
      parentMessageId: null,
      accountId: resolveAccountId(accountId),
    };
  }

  const session = await ensureAccount(accountId);
  const release = await session.mutex.acquire();
  try {
    const result = await getKimiHeadersInternal(session, forceNew);
    return { ...result, accountId: session.id };
  } finally {
    release();
  }
}

async function getKimiHeadersInternal(
  session: AccountSession,
  forceNew = false
): Promise<Omit<KimiHeadersResult, 'accountId'>> {
  if (!forceNew && session.cachedKimiHeaders && Date.now() - session.lastHeadersTime < HEADERS_TTL) {
    return session.cachedKimiHeaders;
  }

  const page = session.page;
  const currentUrl = page.url();
  const isOnKimi = currentUrl.includes('kimi.com');

  if (!isOnKimi || forceNew) {
    console.log(
      `[Playwright] Navigating to Kimi home (account=${session.id})... (Current: ${currentUrl})`
    );
    await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
  }

  console.log('[Playwright] Waiting for chat input...');
  const inputSelector =
    'textarea:visible, [contenteditable="true"]:visible, div[contenteditable="true"]';
  await page.waitForSelector(inputSelector, { timeout: 30000 }).catch(() => {
    console.error('[Playwright] Chat input not found. Current URL:', page.url());
    throw new Error(
      `Timeout waiting for chat input on account "${session.id}". Are you logged in? Run: npm run login -- --account=${session.id}`
    );
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('[Playwright] Timeout waiting for Kimi headers. Current URL:', page.url());
      reject(new Error(`Timeout waiting for Kimi headers (account=${session.id})`));
    }, 60000);

    console.log('[Playwright] Setting up route interception...');
    const routeHandler = async (route: any, request: any) => {
      clearTimeout(timeout);

      const reqHeaders = request.headers();
      let uiSessionId = '';
      let uiParentMessageId: string | null = null;

      const postData = request.postData();
      if (postData) {
        try {
          const jsonStart = postData.indexOf('{');
          if (jsonStart !== -1) {
            const payload = JSON.parse(postData.slice(jsonStart));
            if (payload.chat_id) uiSessionId = payload.chat_id;
            if (payload.message && payload.message.parent_id) {
              uiParentMessageId = payload.message.parent_id;
            }
          }
        } catch {
        }
      }

      const extractedHeaders = {
        cookie: reqHeaders['cookie'] || '',
        authorization: reqHeaders['authorization'] || '',
        'connect-protocol-version': reqHeaders['connect-protocol-version'] || '1',
        'x-msh-device-id': reqHeaders['x-msh-device-id'] || '',
        'x-msh-platform': reqHeaders['x-msh-platform'] || 'web',
        'x-msh-session-id': reqHeaders['x-msh-session-id'] || '',
        'x-msh-version': reqHeaders['x-msh-version'] || '1.0.0',
        'x-traffic-id': reqHeaders['x-traffic-id'] || '',
        'r-timezone': reqHeaders['r-timezone'] || 'America/Maceio',
        'user-agent': reqHeaders['user-agent'] || '',
        origin: 'https://www.kimi.com',
        referer: 'https://www.kimi.com/',
      };

      if (!extractedHeaders.cookie || !extractedHeaders.authorization) {
        console.log('[Playwright] Intercepted request missing critical headers, skipping...');
        await route.continue();
        return;
      }

      console.log(`[Playwright] Successfully intercepted Kimi headers (account=${session.id}).`);
      session.currentHeaders = extractedHeaders;
      session.cachedKimiHeaders = {
        headers: extractedHeaders,
        chatSessionId: uiSessionId,
        parentMessageId: uiParentMessageId,
      };
      session.lastHeadersTime = Date.now();

      await route.abort('aborted');
      await page.unroute('**/apiv2/kimi.gateway.chat.v1.ChatService/Chat*', routeHandler);
      resolve(session.cachedKimiHeaders);
    };

    page.route('**/apiv2/kimi.gateway.chat.v1.ChatService/Chat*', routeHandler).then(async () => {
      console.log('[Playwright] Triggering request...');
      const inputSelector =
        'textarea:visible, [contenteditable="true"]:visible, div[contenteditable="true"]';

      await page.focus(inputSelector);
      await page.fill(inputSelector, '');
      await page.type(inputSelector, 'a', { delay: 100 });
      console.log('[Playwright] Typed char, waiting for UI to update...');
      await sleep(2000);

      const selectors = [
        'button[type="submit"]',
        'button.send-button',
        '.chat-input-send-button',
        'button:has(svg)',
        '[role="button"]:has(svg)',
        'svg.send-icon',
      ];

      let clicked = false;
      for (const selector of selectors) {
        try {
          const el = await page.$(selector);
          if (!el || !(await el.isVisible())) continue;

          console.log(`[Playwright] Attempting click on: ${selector}`);

          await page.evaluate((sel) => {
            const node = document.querySelector(sel);
            if (!node) return;
            const target =
              (node.closest('button') as HTMLElement | null) ||
              (node.closest('[role="button"]') as HTMLElement | null) ||
              (node as HTMLElement);
            if (typeof (target as any).focus === 'function') {
              try {
                target.focus();
              } catch {
              }
            }
            if (typeof (target as any).click === 'function') {
              target.click();
              return;
            }
            target.dispatchEvent(
              new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
            );
          }, selector);

          await el.click({ force: true, delay: 50 }).catch(async () => {
            const box = await el.boundingBox().catch(() => null);
            if (box) {
              await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            }
          });

          clicked = true;
          break;
        } catch (e) {
          console.error(`[Playwright] Error clicking ${selector}:`, e);
        }
      }

      if (!clicked) {
        console.log('[Playwright] No send button found/clicked, fallback to Enter...');
      }
      try {
        await page.focus(inputSelector);
        await page.keyboard.press('Enter');
      } catch {
      }
    });
  });
}
