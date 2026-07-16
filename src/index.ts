import { serve } from '@hono/node-server';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import * as dotenv from 'dotenv';
import { app } from './app.ts';
import { initPlaywright, BrowserType } from './services/playwright.ts';

dotenv.config();

export { app } from './app.ts';

function getNetworkAddress() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let browserType: BrowserType = 'chromium';
  const browserArg = process.argv.find((arg) => arg.startsWith('--browser='));
  if (browserArg) {
    browserType = browserArg.split('=')[1] as BrowserType;
  } else if (process.env.BROWSER) {
    browserType = process.env.BROWSER as BrowserType;
  }

  initPlaywright(true, browserType)
    .then(() => {
      console.log(`Playwright initialized (${browserType}).`);
      const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
      const networkIP = getNetworkAddress();

      console.log('\nKimiProxy started!');
      console.log(`- Local:   http://localhost:${port}`);
      if (networkIP) {
        console.log(`- Network: http://${networkIP}:${port}`);
      }

      console.log('\nAvailable Routes:');
      app.routes.forEach((route) => {
        console.log(`- [${route.method}] ${route.path}`);
      });
      console.log('');

      serve({
        fetch: app.fetch,
        port,
      });
    })
    .catch((err: any) => {
      console.error('Failed to initialize playwright:', err);
      process.exit(1);
    });
}
