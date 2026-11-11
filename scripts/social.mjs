import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const svg = await readFile(new URL('../brand/social.svg', import.meta.url), 'utf8');
  await page.setContent(`<html><head><style>html,body{margin:0;width:1200px;height:630px;overflow:hidden}</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: new URL('../brand/social.png', import.meta.url).pathname });
  console.log('Rendered brand/social.png (1200 × 630).');
} finally { await browser.close(); }
