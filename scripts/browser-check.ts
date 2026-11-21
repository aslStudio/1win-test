import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { site } from '../config/site.js';
import { root } from './common.js';
import { createStaticServer } from './serve.js';

async function main() {
  const server = createStaticServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local server port');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser;
  const failures: string[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    await fs.mkdir(path.join(root, 'qa'), { recursive: true });
    for (const pageSpec of site.pages) {
      for (const width of [1440, 768, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        const page = await context.newPage();
        const label = `${pageSpec.key}@${width}`;
        page.on('pageerror', error => failures.push(`${label}: JS error ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') failures.push(`${label}: console ${message.text()}`); });
        page.on('response', response => { if (response.status() >= 400) failures.push(`${label}: HTTP ${response.status()} ${response.url()}`); });
        const response = await page.goto(origin + pageSpec.route, { waitUntil: 'networkidle' });
        if (response?.status() !== 200) failures.push(`${label}: page did not return HTTP 200`);
        const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (pageWidth > width + 2) failures.push(`${label}: horizontal overflow ${pageWidth}px`);
        const layout = await page.evaluate(() => {
          const logo = document.querySelector('.header .site-brand')?.getBoundingClientRect();
          const nav = document.querySelector('.header .site-shell-nav')?.getBoundingClientRect();
          const heroCopy = document.querySelector('.site-hero__copy')?.getBoundingClientRect();
          const media = document.querySelector('.site-hero__media')?.getBoundingClientRect();
          const promo = document.querySelector('.site-hero__media > .promo-code')?.getBoundingClientRect();
          const featured = [...document.querySelectorAll('.doc-section--feature')].every(section => {
            const copy = section.querySelector('.doc-section__copy')?.getBoundingClientRect();
            const image = section.querySelector('.doc-section__media')?.getBoundingClientRect();
            return !!copy && !!image && image.top >= copy.bottom - 2;
          });
          return { headerRow: !!logo && !!nav && nav.left >= logo.right - 2,
            promoCorner: !!media && !!promo && promo.right <= media.right + 2 && promo.bottom <= media.bottom + 2,
            heroColumn: !!heroCopy && !!media && media.top >= heroCopy.bottom - 2,
            featuredColumns: featured };
        });
        if (!layout.headerRow) failures.push(`${label}: header is not in one row`);
        if (!layout.promoCorner) failures.push(`${label}: promo card is not in the image corner`);
        if (!layout.heroColumn || !layout.featuredColumns) failures.push(`${label}: featured image is not below its text`);
        const broken = await page.locator('img').evaluateAll(images => images.filter(image => !(image as HTMLImageElement).complete || !(image as HTMLImageElement).naturalWidth).length);
        if (broken) failures.push(`${label}: ${broken} broken images`);
        await page.screenshot({ path: path.join(root, 'qa', `${pageSpec.key}-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: `Copy promo code ${site.promoCode}` }).first().click();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        if (copied !== site.promoCode) failures.push(`${label}: promo copy returned ${JSON.stringify(copied)}`);
        if (!await page.locator('.copy-toast--visible').isVisible()) failures.push(`${label}: copy toast did not appear`);
        const firstQuestion = page.locator('.faq-item').first();
        await firstQuestion.locator('summary').click();
        await page.waitForFunction(() => !(document.querySelector('.faq-item') as HTMLDetailsElement).open);
        await firstQuestion.locator('summary').click();
        await page.waitForFunction(() => (document.querySelector('.faq-item') as HTMLDetailsElement).open);
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  if (failures.length) {
    for (const failure of failures) console.error('FAIL:', failure);
    process.exitCode = 1;
  } else console.log('PASS: 3 routes × 3 viewports; screenshots in qa/');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
