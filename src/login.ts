import * as dotenv from 'dotenv';
import { BrowserType } from './services/playwright.ts';
import { runAccountManagerCli } from './account/manager-cli.ts';
import { getDefaultAccountId, loadAccountStore } from './account/store.ts';

dotenv.config();

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  loadAccountStore();

  let browserType: BrowserType = 'chromium';
  const browserArg = process.argv.find((arg) => arg.startsWith('--browser='));
  if (browserArg) browserType = browserArg.split('=')[1] as BrowserType;
  else if (process.env.BROWSER) browserType = process.env.BROWSER as BrowserType;

  let command: string | undefined;
  if (hasFlag('login') || hasFlag('L') || hasFlag('l')) command = 'login';
  if (hasFlag('recycle') || hasFlag('R') || hasFlag('r')) command = 'recycle';
  if (hasFlag('list') || hasFlag('A') || hasFlag('a')) command = 'list';

  const account = argValue('account') || process.env.KIMI_ACCOUNT;

  if (hasFlag('legacy-open')) {
    const { initPlaywright, closePlaywright, activePage, sanitizeAccountId, getProfilePath } =
      await import('./services/playwright.ts');
    const accountId = sanitizeAccountId(account || getDefaultAccountId());
    const minutes = Number(argValue('minutes') || '2');
    console.log(`Legacy open account=${accountId} profile=${getProfilePath(accountId)}`);
    await initPlaywright(false, browserType, accountId);
    if (activePage) {
      await activePage.goto('https://www.kimi.com/', { waitUntil: 'domcontentloaded' });
    }
    console.log(`Aberto por ${minutes} min — logue Google+Kimi se precisar`);
    await new Promise((r) => setTimeout(r, Math.max(30, minutes * 60) * 1000));
    await closePlaywright();
    return;
  }

  await runAccountManagerCli({
    browserType,
    command,
    account,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
