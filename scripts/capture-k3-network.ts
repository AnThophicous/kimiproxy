import { chromium, firefox, BrowserContext, Page, Request } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve('capture');
const PROFILE = path.resolve('kimi_profile');
const DURATION_MS = Number(process.env.CAPTURE_MS || 120000);

type Hit = {
  t: string;
  method: string;
  url: string;
  resourceType: string;
  postDataPreview?: string;
  postJson?: unknown;
};

function safeJsonFromPost(post: string | null): unknown {
  if (!post) return undefined;
  const brace = post.indexOf('{');
  if (brace === -1) return undefined;
  try {
    return JSON.parse(post.slice(brace));
  } catch {
    return undefined;
  }
}

function interesting(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes('kimi.com') &&
    (u.includes('apiv2') ||
      u.includes('chat') ||
      u.includes('model') ||
      u.includes('kimiplus') ||
      u.includes('scenario') ||
      u.includes('gateway') ||
      u.includes('ok-computer') ||
      u.includes('agent'))
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const hits: Hit[] = [];
  const chatBodies: unknown[] = [];

  console.log('[capture] profile:', PROFILE);
  console.log('[capture] duration ms:', DURATION_MS);
  console.log('[capture] opening browser — select K3 Max and send a short message');

  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: undefined,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1400, height: 900 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page: Page = context.pages()[0] || (await context.newPage());

  const onRequest = async (req: Request) => {
    const url = req.url();
    if (!interesting(url)) return;

    const post = req.postData();
    const postJson = safeJsonFromPost(post);
    const hit: Hit = {
      t: new Date().toISOString(),
      method: req.method(),
      url,
      resourceType: req.resourceType(),
      postDataPreview: post ? post.slice(0, 4000) : undefined,
      postJson,
    };
    hits.push(hit);

    const pathPart = url.split('?')[0];
    console.log(`[net] ${req.method()} ${pathPart}`);

    if (postJson && typeof postJson === 'object') {
      const j = postJson as Record<string, any>;
      if (
        j.scenario ||
        j.kimiplus_id ||
        j.kimi_plus_id ||
        j.options ||
        (j.message && j.message.scenario)
      ) {
        chatBodies.push(postJson);
        console.log('[chat-like body]', JSON.stringify(postJson, null, 2).slice(0, 2500));
      }
    }
  };

  page.on('request', (req) => {
    void onRequest(req);
  });
  context.on('request', (req) => {
    void onRequest(req);
  });

  await page.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
  console.log('[capture] ready. Interact in the window for', DURATION_MS / 1000, 's');

  await new Promise((r) => setTimeout(r, DURATION_MS));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const allPath = path.join(OUT_DIR, `network-${stamp}.json`);
  const chatPath = path.join(OUT_DIR, `chat-bodies-${stamp}.json`);
  fs.writeFileSync(allPath, JSON.stringify(hits, null, 2), 'utf8');
  fs.writeFileSync(chatPath, JSON.stringify(chatBodies, null, 2), 'utf8');

  console.log('[capture] saved', allPath);
  console.log('[capture] saved', chatPath);
  console.log('[capture] total hits', hits.length, 'chat-like', chatBodies.length);

  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
