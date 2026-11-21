import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { site } from '../config/site.js';
import { dist, exists, root, routeFile, stage, targetUrl } from './common.js';

const errors: string[] = [];
const allowed = new Set<string>(site.pages.map(page => page.route));
async function filesUnder(dir: string): Promise<string[]> {
  if (!await exists(dir)) return [];
  const out: string[] = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    out.push(...(item.isDirectory() ? await filesUnder(full) : [full]));
  }
  return out;
}

async function main() {
  const htmlFiles = (await filesUnder(dist)).filter(file => file.endsWith('.html'));
  const expected = site.pages.map(page => routeFile(page.route)).sort();
  if (JSON.stringify(htmlFiles.sort()) !== JSON.stringify(expected)) errors.push(`Expected exactly three HTML files; got ${htmlFiles.length}`);
  for (const page of site.pages) {
    const file = routeFile(page.route);
    if (!await exists(file)) { errors.push(`Missing ${file}`); continue; }
    const $ = cheerio.load(await fs.readFile(file, 'utf8'));
    const stageFile = routeFile(page.route, stage);
    if (await exists(stageFile)) {
      const readable = cheerio.load(await fs.readFile(stageFile, 'utf8'));
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      const sourceFile = path.join(root, 'content', `${page.key}.json`);
      if (await exists(sourceFile)) {
        const source = cheerio.load((JSON.parse(await fs.readFile(sourceFile, 'utf8')) as { html: string }).html);
        const textNodes = (document: cheerio.CheerioAPI, selector: string) =>
          document(selector).map((_, element) => normalize(document(element).text())).get().filter(Boolean);
        const sourceText = textNodes(source, 'h1,h2,h3,p,li,th,td');
        const stageText = textNodes(readable, 'article h1,article h2,article h3,article p,article li,article th,article td');
        if (JSON.stringify(sourceText) !== JSON.stringify(stageText)) errors.push(`${page.route}: stage differs from DOCX content`);
      }
      const semanticText = (document: cheerio.CheerioAPI) =>
        document('article h1,article h2,article h3,article p,article li,article th,article td')
          .map((_, element) => normalize(document(element).text())).get();
      if (JSON.stringify(semanticText(readable)) !== JSON.stringify(semanticText($))) {
        errors.push(`${page.route}: minification changed semantic text`);
      }
      for (const selector of ['h1', 'h2', 'h3', 'table', 'ul', 'ol', 'img', 'details']) {
        if (readable(`article ${selector}`).length !== $(`article ${selector}`).length) {
          errors.push(`${page.route}: minification changed ${selector} count`);
        }
      }
    }
    const canonical = targetUrl(page.route);
    if ($('html').attr('lang') !== site.locale) errors.push(`${page.route}: wrong lang`);
    if ($('h1').length !== 1) errors.push(`${page.route}: expected one h1, got ${$('h1').length}`);
    if ($('title').length !== 1 || !$('title').text().trim()) errors.push(`${page.route}: missing unique title`);
    if (!$('meta[name="description"]').attr('content')) errors.push(`${page.route}: missing description`);
    if ($('link[rel="canonical"]').attr('href') !== canonical) errors.push(`${page.route}: wrong canonical`);
    if ($('link[hreflang="en-TZ"]').attr('href') !== canonical) errors.push(`${page.route}: wrong hreflang`);
    if ($('link[rel="alternate"]').length !== 1) errors.push(`${page.route}: unexpected language alternatives`);
    if (!$.html().includes(site.promoCode)) errors.push(`${page.route}: missing promo code ${site.promoCode}`);
    if ($('button').length !== 1 || $('[data-copy-promo]').length !== 1 || $('.promo-code').length !== 1) {
      errors.push(`${page.route}: unexpected or missing promo cards`);
    }
    if (!$('.site-hero__media > .promo-code').length) errors.push(`${page.route}: hero promo card is not attached to the image`);
    if ($('.doc-section .promo-code').length) errors.push(`${page.route}: promo card repeated after hero`);
    if (!$('.copy-toast[role="status"][aria-live="polite"]').length) errors.push(`${page.route}: missing copy toast`);
    if (!$('.doc-section__media img').length) errors.push(`${page.route}: missing section image column`);
    if (!$('.faq-item').length || $('.faq-item').length !== $('.faq-item summary h3').length || $('.faq-item').length !== $('.faq-item__answer').length) {
      errors.push(`${page.route}: FAQ disclosures are incomplete`);
    }
    if ($('.faq-item').length !== $('.faq-item__arrow svg path').length) errors.push(`${page.route}: FAQ source arrows are incomplete`);
    if ($('[data-href]').length) errors.push(`${page.route}: encoded redirect target remains`);
    if ($('script[src*="analytics"],script[src*="gtm"],iframe').length) errors.push(`${page.route}: tracking script/iframe remains`);
    if ($.html().includes(site.sourceHost)) errors.push(`${page.route}: old source host remains`);
    $('a[href],form[action]').each((_, el) => {
      const value = $(el).attr('href') || $(el).attr('action') || '';
      if (!value || value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('tel:')) return;
      try {
        const url = new URL(value, canonical);
        if (url.origin !== site.targetOrigin) errors.push(`${page.route}: external clickable URL ${value}`);
        else if (!allowed.has(url.pathname)) errors.push(`${page.route}: excluded route ${value}`);
      } catch { errors.push(`${page.route}: malformed URL ${value}`); }
    });
    $('img[src],link[rel="stylesheet"][href],link[rel="icon"][href],source[src],script[src]').each((_, el) => {
      const value = $(el).attr('src') || $(el).attr('href') || '';
      try {
        const url = new URL(value, canonical);
        if (url.origin !== site.targetOrigin) errors.push(`${page.route}: external resource ${value}`);
      } catch { errors.push(`${page.route}: malformed resource ${value}`); }
    });
    for (const el of $('img[src],link[rel="stylesheet"][href],link[rel="icon"][href],source[src],script[src]').toArray()) {
      const value = $(el).attr('src') || $(el).attr('href') || '';
      try {
        const url = new URL(value, canonical);
        if (url.origin === site.targetOrigin && !await exists(path.join(dist, decodeURIComponent(url.pathname)))) errors.push(`${page.route}: missing resource ${value}`);
      } catch { /* already reported */ }
    }
    for (const el of $('meta[name="msapplication-TileImage"][content]').toArray()) {
      const value = $(el).attr('content') || '';
      if (!await exists(path.join(dist, value.replace(/^\/+/, '')))) errors.push(`${page.route}: missing tile icon ${value}`);
    }
    $('article img').each((_, el) => {
      if (!$(el).attr('alt')) errors.push(`${page.route}: content image lacks alt`);
      if (!$(el).attr('width') || !$(el).attr('height')) errors.push(`${page.route}: content image lacks dimensions`);
    });
  }
  for (const cssFile of (await filesUnder(dist)).filter(file => file.endsWith('.css'))) {
    const css = await fs.readFile(cssFile, 'utf8');
    for (const match of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) {
      const value = match[1];
      if (value.startsWith('data:') || value.startsWith('#')) continue;
      try {
        const url = new URL(value, `https://1-win.co.tz/${path.relative(dist, cssFile).replaceAll(path.sep, '/')}`);
        if (url.origin !== site.targetOrigin) errors.push(`${path.relative(dist, cssFile)}: external CSS resource ${value}`);
        else if (!await exists(path.join(dist, decodeURIComponent(url.pathname)))) errors.push(`${path.relative(dist, cssFile)}: missing CSS resource ${value}`);
      } catch { errors.push(`${path.relative(dist, cssFile)}: malformed CSS resource ${value}`); }
    }
  }
  const sitemap = path.join(dist, 'sitemap.xml');
  if (!await exists(sitemap)) errors.push('Missing sitemap.xml');
  else {
    const xml = await fs.readFile(sitemap, 'utf8');
    if ((xml.match(/<loc>/g) || []).length !== 3) errors.push('Sitemap must have exactly three URLs');
    for (const page of site.pages) if (!xml.includes(`<loc>${targetUrl(page.route)}</loc>`)) errors.push(`Sitemap missing ${page.route}`);
  }
  if (!await exists(path.join(dist, 'robots.txt'))) errors.push('Missing robots.txt');
  if (errors.length) {
    for (const error of errors) console.error('FAIL:', error);
    process.exitCode = 1;
  } else console.log('PASS: three routes, local links/resources, SEO and sitemap');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
