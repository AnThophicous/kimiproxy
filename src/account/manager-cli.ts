import * as readline from 'readline';
import {
  closePlaywright,
  ensureAccount,
  listAccounts as listRuntimeAccounts,
  sanitizeAccountId,
  BrowserType,
} from '../services/playwright.ts';
import {
  getDefaultAccountId,
  listStoredAccounts,
  loadAccountStore,
  markGoogleReady,
  markKimiReady,
  markRecycled,
  profilePathFor,
  removeAccountFromStore,
  setDefaultAccountId,
  storePath,
  upsertAccount,
} from './store.ts';
import {
  hasGoogleSession,
  kimiLoginWithStickyGoogle,
  prepareGoogleInProfile,
  waitGoogleReady,
} from './google.ts';
import { recycleAccount } from './recycle.ts';

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (ans) => resolve((ans || '').trim())));
}

function printBanner() {
  console.log('');
  console.log('============================================================');
  console.log('  KimiProxy — gerenciador de contas (1 profile = 1 conta)');
  console.log('  Google fica SALVO no profile Playwright (estilo Chrome)');
  console.log('============================================================');
  console.log(`  store: ${storePath()}`);
  console.log(`  default: ${getDefaultAccountId()}`);
  console.log('============================================================');
  console.log('');
}

function printMenu() {
  console.log('  [L] Login / adicionar conta  (Google no profile + Kimi)');
  console.log('  [R] Recycle  (delete Kimi + re-login Google sticky)');
  console.log('  [A] Listar contas (store)');
  console.log('  [D] Definir conta default');
  console.log('  [X] Remover conta do store');
  console.log('  [Q] Sair');
  console.log('');
}

function printAccounts() {
  const list = listStoredAccounts();
  const def = getDefaultAccountId();
  if (!list.length) {
    console.log('(nenhuma conta no store ainda)');
    return;
  }
  console.log('');
  console.log('id'.padEnd(16), 'google'.padEnd(8), 'kimi'.padEnd(6), 'email / profile');
  console.log('-'.repeat(72));
  for (const a of list) {
    const mark = a.id === def ? '*' : ' ';
    console.log(
      `${mark}${a.id}`.padEnd(16),
      (a.googleReady ? 'OK' : '--').padEnd(8),
      (a.kimiReady ? 'OK' : '--').padEnd(6),
      `${a.googleEmail || '-'} | ${a.profilePath}`
    );
  }
  console.log('');
  console.log('* = default   runtime abertos:', listRuntimeAccounts().join(', ') || '-');
  console.log('');
}

async function flowLogin(
  rl: readline.Interface,
  browserType: BrowserType,
  accountArg?: string
) {
  printAccounts();
  const raw =
    accountArg ||
    (await ask(rl, 'ID da conta (ex: default, max1, max2) [default]: ')) ||
    'default';
  const id = sanitizeAccountId(raw);
  const label =
    (await ask(rl, `Label amigável [${id}]: `)) || id;

  upsertAccount(id, { label, kimiReady: false, googleReady: false });
  console.log('');
  console.log(`Profile dedicado: ${profilePathFor(id)}`);
  console.log('Vou abrir o Playwright DESTE profile.');
  console.log('1) Você loga o GOOGLE nessa janela (fica salvo no profile)');
  console.log('2) Depois loga o KIMI com "Continue with Google" (cola na sessão)');
  console.log('');

  const session = await ensureAccount(id, { headless: false, browserType });
  const page = session.page;

  const prep = await prepareGoogleInProfile(page);
  if (!prep.ready) {
    await ask(rl, 'Pressione ENTER quando o Google estiver logado nesta janela...');
    const waited = await waitGoogleReady(page, 2 * 60 * 1000);
    if (!waited.ready) {
      const again = await hasGoogleSession(page.context());
      if (!again) {
        console.log('Google ainda não detectado. Continuando mesmo assim...');
      } else {
        const email = waited.email;
        markGoogleReady(id, email);
      }
    } else {
      markGoogleReady(id, waited.email);
    }
  } else {
    markGoogleReady(id, prep.email);
  }

  const email =
    listStoredAccounts().find((a) => a.id === id)?.googleEmail || prep.email;
  if (email) console.log('Google email detectado:', email);

  console.log('');
  console.log('Agora: Kimi com Google sticky...');
  try {
    await kimiLoginWithStickyGoogle(page);
    markKimiReady(id);
  } catch (e) {
    console.error(e);
    console.log('Complete o login Kimi na janela se precisar.');
    await ask(rl, 'ENTER quando o chat Kimi estiver visível...');
    markKimiReady(id);
  }

  const makeDefault = (await ask(rl, `Definir "${id}" como default? [S/n]: `)).toLowerCase();
  if (makeDefault !== 'n' && makeDefault !== 'nao' && makeDefault !== 'no') {
    setDefaultAccountId(id);
  }

  console.log('');
  console.log(`OK — conta "${id}" pronta.`);
  console.log('  profile Google sticky = este Playwright');
  console.log('  recycle depois não deve pedir seletor de conta (ideal: 1 Google no profile)');
  console.log('');
  await ask(rl, 'ENTER para fechar o browser desta conta...');
  await closePlaywright();
}

async function flowRecycle(
  rl: readline.Interface,
  browserType: BrowserType,
  accountArg?: string
) {
  printAccounts();
  const raw =
    accountArg ||
    (await ask(rl, `Conta para recycle [${getDefaultAccountId()}]: `)) ||
    getDefaultAccountId();
  const id = sanitizeAccountId(raw);
  const acc = listStoredAccounts().find((a) => a.id === id);
  if (!acc) {
    console.log(`Conta "${id}" não está no store. Use [L] primeiro.`);
    return;
  }
  if (!acc.googleReady) {
    console.log('Aviso: googleReady=false. Ideal rodar [L] e logar Google neste profile antes.');
  }

  const conf = (await ask(rl, `Recycle DELETE+relogin na conta "${id}"? digite SIM: `)).toUpperCase();
  if (conf !== 'SIM') {
    console.log('Cancelado.');
    return;
  }

  try {
    await recycleAccount({
      accountId: id,
      browserType,
      headless: false,
      confirmWord: 'DELETE',
    });
    markRecycled(id);
    console.log('Recycle OK. Profile mantido (Google sticky).');
  } catch (e) {
    console.error('Recycle falhou:', e);
    await ask(rl, 'ENTER depois de terminar manualmente na janela...');
  } finally {
    await closePlaywright();
  }
}

async function flowDefault(rl: readline.Interface) {
  printAccounts();
  const raw = await ask(rl, 'ID da conta default: ');
  if (!raw) return;
  try {
    setDefaultAccountId(raw);
    console.log('Default =', getDefaultAccountId());
  } catch (e) {
    console.error(e);
  }
}

async function flowRemove(rl: readline.Interface) {
  printAccounts();
  const raw = await ask(rl, 'ID para remover do store: ');
  if (!raw) return;
  const id = sanitizeAccountId(raw);
  const delProf = (await ask(rl, 'Apagar pasta do profile também? [s/N]: ')).toLowerCase();
  const ok = removeAccountFromStore(id, delProf === 's' || delProf === 'sim' || delProf === 'y');
  console.log(ok ? 'Removido.' : 'Não encontrado.');
}

export async function runAccountManagerCli(opts?: {
  browserType?: BrowserType;
  command?: string;
  account?: string;
}) {
  const browserType = opts?.browserType || 'chromium';
  const rl = createRl();
  printBanner();

  const bootCmd = (opts?.command || '').toLowerCase();

  const loop = async () => {
    if (bootCmd === 'l' || bootCmd === 'login') {
      await flowLogin(rl, browserType, opts?.account);
      return;
    }
    if (bootCmd === 'r' || bootCmd === 'recycle') {
      await flowRecycle(rl, browserType, opts?.account);
      return;
    }
    if (bootCmd === 'a' || bootCmd === 'list') {
      printAccounts();
      return;
    }

    while (true) {
      printMenu();
      const choice = (await ask(rl, 'comando> ')).toLowerCase();
      if (!choice) continue;
      if (choice === 'q' || choice === 'quit' || choice === 'sair') break;
      if (choice === 'l' || choice === 'login') {
        await flowLogin(rl, browserType);
        continue;
      }
      if (choice === 'r' || choice === 'recycle') {
        await flowRecycle(rl, browserType);
        continue;
      }
      if (choice === 'a' || choice === 'list') {
        printAccounts();
        continue;
      }
      if (choice === 'd' || choice === 'default') {
        await flowDefault(rl);
        continue;
      }
      if (choice === 'x' || choice === 'remove' || choice === 'del') {
        await flowRemove(rl);
        continue;
      }
      console.log('Opção inválida.');
    }
  };

  try {
    await loop();
  } finally {
    rl.close();
    await closePlaywright().catch(() => {});
  }
}
