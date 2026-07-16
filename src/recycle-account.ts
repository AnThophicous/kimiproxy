import * as dotenv from 'dotenv';
import {
  BrowserType,
  closePlaywright,
  listAccounts,
  sanitizeAccountId,
} from './services/playwright.ts';
import { recycleAccount } from './account/recycle.ts';

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
  let browserType: BrowserType = 'chromium';
  const browserArg = process.argv.find((a) => a.startsWith('--browser='));
  if (browserArg) browserType = browserArg.split('=')[1] as BrowserType;
  else if (process.env.BROWSER) browserType = process.env.BROWSER as BrowserType;

  const accountId = sanitizeAccountId(
    argValue('account') || process.env.KIMI_ACCOUNT || 'default'
  );
  const confirmWord = argValue('confirm') || process.env.KIMI_DELETE_CONFIRM || 'DELETE';
  const keepOpenSec = Number(argValue('keep-open') || process.env.RECYCLE_KEEP_OPEN || '30');
  const skipDelete = hasFlag('skip-delete') || hasFlag('login-only');
  const skipLogin = hasFlag('skip-login') || hasFlag('delete-only');
  const headless = hasFlag('headless');

  console.log('');
  console.log('Kimi recycle = DELETE conta + LOGIN Google de novo');
  console.log('(K3 Max costuma liberar de novo após recriar conta)');
  console.log('');
  console.log(`account     : ${accountId}`);
  console.log(`browser     : ${browserType}`);
  console.log(`confirm word: ${confirmWord}`);
  console.log(`skipDelete  : ${skipDelete}`);
  console.log(`skipLogin   : ${skipLogin}`);
  console.log(`known       : ${listAccounts().join(', ')}`);
  console.log('');
  console.log('Requisito: profile com Google já logado ajuda (popup escolhe a conta).');
  console.log('Se o Google pedir senha/2FA, complete na janela.');
  console.log('');

  if (!hasFlag('yes') && !hasFlag('y')) {
    console.log('Passe --yes para executar (proteção contra delete acidental).');
    console.log('Ex: npm run recycle -- --account=default --yes');
    process.exit(2);
  }

  const shutdown = async () => {
    console.log('Fechando browsers...');
    await closePlaywright();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });

  try {
    await recycleAccount({
      accountId,
      browserType,
      headless,
      confirmWord,
      skipDelete,
      skipLogin,
    });
    if (keepOpenSec > 0) {
      console.log(`Mantendo browser aberto ${keepOpenSec}s (Ctrl+C para sair antes)...`);
      await new Promise((r) => setTimeout(r, keepOpenSec * 1000));
    }
  } catch (err) {
    console.error('[recycle] falhou:', err);
    console.log('Browser fica aberto 90s para você terminar manualmente...');
    await new Promise((r) => setTimeout(r, 90000));
    process.exitCode = 1;
  } finally {
    await closePlaywright();
  }
}

main();
