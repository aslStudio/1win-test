import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { mappings } from '../config/mappings.js';
import { site } from '../config/site.js';
import { copyDir, exists, original, routeFile, stage, work, write } from './common.js';
import { confirmReplacement } from './confirm.js';
import { relativeCssUrls, relativeSiteUrl } from './paths.js';

const allowed = new Set<string>(site.pages.map(page => page.route));
function localRoute(href: string, base: string) {
  try {
    const url = new URL(href, base);
    if (url.origin !== site.targetOrigin && url.hostname !== site.sourceHost) return null;
    const route = url.pathname.replace(/index\.html$/, '');
    return allowed.has(route) ? route + url.hash : null;
  } catch { return null; }
}

async function main() {
  if (!await exists(path.join(original, 'index.html'))) throw new Error('No approved original template in source/original/index.html');
  await confirmReplacement(stage);
  await copyDir(original, work);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  async function copyAssets(directory: string) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await copyAssets(file);
      else if (!/\.(html?|json|xml|txt|js)$/i.test(item.name)) {
        const relative = path.relative(original, file);
        const data = await fs.readFile(file);
        await write(path.join(stage, relative), item.name.endsWith('.css') ? relativeCssUrls(data.toString('utf8'), relative) : data);
      }
    }
  }
  await copyAssets(original);
  for (const page of site.pages) {
    const pageFile = page.route.replace(/^\/+/, '') + 'index.html';
    const sourceFile = page.route === '/' ? path.join(work, 'index.html') : routeFile(page.route, work);
    if (!await exists(sourceFile)) {
      // The home template supplies a consistent shell when the approved source has no matching route.
      if (page.route !== '/') {
        const home = await fs.readFile(path.join(work, 'index.html'), 'utf8');
        await write(sourceFile, home);
      }
    }
    const $ = cheerio.load(await fs.readFile(sourceFile, 'utf8'));
    $('html').attr('lang', site.locale);
    $('script,iframe').remove();
    $('link[rel="alternate"],link[rel="canonical"],meta[property="og:url"],script[type="application/ld+json"]').remove();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.startsWith('#')) return;
      const route = localRoute(href, site.sourceUrl);
      if (route) $(el).attr('href', relativeSiteUrl(pageFile, route));
      else $(el).replaceWith($(el).contents());
    });
    $('form[action]').each((_, el) => {
      const route = localRoute($(el).attr('action') || '', site.sourceUrl);
      if (!route) $(el).removeAttr('action').removeAttr('method');
      else $(el).attr('action', relativeSiteUrl(pageFile, route));
    });
    $('[src],link[href]').each((_, el) => {
      const attr = $(el).attr('src') ? 'src' : 'href';
      const value = $(el).attr(attr) || '';
      if (/^(?:data:|#)/.test(value)) return;
      try {
        const url = new URL(value, site.sourceUrl);
        if (url.hostname === site.sourceHost) $(el).attr(attr, relativeSiteUrl(pageFile, url.pathname + url.search));
        else if (attr === 'src') $(el).remove();
      } catch { /* leave malformed source for validation */ }
    });
    $('meta[content]').each((_, el) => {
      const value = $(el).attr('content') || '';
      try {
        const url = new URL(value);
        if (url.hostname === site.sourceHost) {
          if (existsSync(path.join(original, url.pathname))) $(el).attr('content', relativeSiteUrl(pageFile, url.pathname + url.search));
          else $(el).remove();
        }
      } catch { /* non-URL metadata */ }
    });
    $('style').each((_, el) => {
      const css = $(el).html() || '';
      $(el).html(relativeCssUrls(css.replace(/\/\*# sourceURL=https?:\/\/[^*]+\*\//g, ''), pageFile));
    });
    $('[onclick]').removeAttr('onclick');
    $('[hreflang], [lang]').not('html').each((_, el) => {
      if ($(el).attr('hreflang')) $(el).remove();
    });
    const root = $(mappings.contentRoot).first();
    if (!root.length) throw new Error(`Missing mapped content root ${mappings.contentRoot} on ${page.route}`);
    root.empty().attr(mappings.generatedArticleAttribute, page.key);
    const logo = $('.header .logo img').first();
    const logoSrc = logo.attr('src');
    const nav = site.pages.map(item => {
      const label = item.key === 'home' ? 'Home' : item.key === 'bet' ? 'Bet' : 'Casino';
      const current = item.route === page.route ? ' aria-current="page"' : '';
      return `<a href="${relativeSiteUrl(pageFile, item.route)}"${current}>${label}</a>`;
    }).join('');
    const brand = logoSrc
      ? `<a class="site-brand" href="${relativeSiteUrl(pageFile, '/')}" aria-label="1Win home"><img src="${logoSrc}" alt="1Win" width="134" height="58"></a>`
      : `<a class="site-brand" href="${relativeSiteUrl(pageFile, '/')}" >1Win</a>`;
    $('header').first().html(`<div class="head-container site-shell-header">${brand}<nav class="site-shell-nav" aria-label="Main navigation">${nav}</nav></div>`);
    $('footer').first().html(`<div class="container site-shell-footer"><nav class="site-shell-nav" aria-label="Footer navigation">${nav}</nav></div>`);
    $('*[data-href]').remove();
    $('button').remove();
    await write(routeFile(page.route, stage), $.html());
  }
  console.log('Prepared three route shells in stage/');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
