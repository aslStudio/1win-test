import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { imageAlts, mappings } from '../config/mappings.js';
import { site } from '../config/site.js';
import { exists, root, routeFile, stage, targetUrl, write } from './common.js';
import { formatStage } from './format.js';
import { confirmReplacement } from './confirm.js';

type RecordData = { title: string; description: string; html: string; source: string };

async function main() {
  let stageAlreadyPopulated = false;
  for (const page of site.pages) {
    const file = routeFile(page.route, stage);
    if (!await exists(file)) throw new Error(`Missing stage shell: ${file}. Run npm run clean first.`);
    const html = await fs.readFile(file, 'utf8');
    if (html.includes('class="docx-content"')) stageAlreadyPopulated = true;
  }
  if (stageAlreadyPopulated) await confirmReplacement(stage);
  for (const page of site.pages) {
    const recordFile = path.join(root, 'content', `${page.key}.json`);
    if (!await exists(recordFile)) throw new Error(`Missing extracted content: ${recordFile}`);
    const record = JSON.parse(await fs.readFile(recordFile, 'utf8')) as RecordData;
    const file = routeFile(page.route, stage);
    const $ = cheerio.load(await fs.readFile(file, 'utf8'));
    const article = cheerio.load(record.html);
    article('a[href]').each((_, el) => {
      const text = article(el).text();
      const href = article(el).attr('href') || '';
      try {
        const url = new URL(href, site.targetOrigin);
        if (url.origin !== site.targetOrigin || !site.pages.some(p => p.route === url.pathname)) article(el).replaceWith(text);
      } catch { article(el).replaceWith(text); }
    });
    for (const el of article('img').toArray()) {
      const src = article(el).attr('src') || '';
      const match = src.match(/docx-(\d+)\.png$/);
      const index = match ? Number(match[1]) - 1 : -1;
      article(el).attr('alt', imageAlts[page.key]?.[index] || '').attr('loading', 'lazy');
      if (index >= 0) {
        const filePath = path.join(root, 'content/media', page.key, `docx-${index + 1}.png`);
        if (await exists(filePath)) {
          const data = await fs.readFile(filePath);
          if (data.subarray(1, 4).toString() === 'PNG') {
            article(el).attr('width', String(data.readUInt32BE(16)));
            article(el).attr('height', String(data.readUInt32BE(20)));
          }
        }
      }
    }
    const h1s = article('h1');
    h1s.slice(1).each((_, el) => { el.tagName = 'h2'; });
    article('table').each((_, el) => { article(el).wrap('<div class="table-scroll"></div>'); });
    const groups: Array<{ nodes: string[]; hasTable: boolean; hasMedia: boolean }> = [];
    const intro: string[] = [];
    let heroImage = '';
    for (const node of article('body').children().toArray()) {
      if (node.tagName === 'h2') groups.push({ nodes: [], hasTable: false, hasMedia: false });
      const html = article(node).toString();
      if (!groups.length) {
        if (!heroImage && article(node).find('img').length === 1 && !article(node).text().trim()) {
          const hero = article(node).find('img').first();
          hero.attr('loading', 'eager').attr('fetchpriority', 'high');
          heroImage = hero.toString();
        } else intro.push(html);
      } else {
        const current = groups.at(-1)!;
        current.nodes.push(html);
        if (article(node).find('table').length || node.tagName === 'table') current.hasTable = true;
        if (article(node).find('img').length) current.hasMedia = true;
      }
    }
    const promo = '<div class="promo-code"><span class="promo-code__eyebrow">Your promo code</span><div class="promo-code__row"><code>' + site.promoCode + '</code><button type="button" data-copy-promo aria-label="Copy promo code ' + site.promoCode + '"><span data-copy-label>Copy code</span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button></div></div>';
    const faqArrow = '<span class="faq-item__arrow" aria-hidden="true"><svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"/></svg></span>';
    const heroHtml = '<section class="site-hero"><div class="site-hero__copy">' + intro.join('') + '</div>' + (heroImage ? '<figure class="site-hero__media">' + heroImage + promo + '</figure>' : '') + '</section>';
    const sectionHtml = groups.map((group, index) => {
      const content = cheerio.load('<div id="section-content">' + group.nodes.join('') + '</div>');
      const container = content('#section-content');
      const heading = container.children('h2').first();
      const title = heading.toString();
      heading.remove();
      if (/^FAQ\b|Common Questions/i.test(content(title).text().trim())) {
        const parts: string[] = [];
        let question = '';
        let answer: string[] = [];
        let questionCount = 0;
        const flush = () => {
          if (question) {
            parts.push('<details class="faq-item"' + (questionCount === 0 ? ' open' : '') + '><summary>' + question + faqArrow + '</summary><div class="faq-item__answer">' + answer.join('') + '</div></details>');
            questionCount++;
          }
        };
        for (const node of container.children().toArray()) {
          if (node.tagName === 'h3') {
            flush();
            question = content(node).toString();
            answer = [];
          } else if (question) answer.push(content(node).toString());
          else parts.push(content(node).toString());
        }
        flush();
        return '<section class="doc-section doc-section--faq" id="section-' + (index + 1) + '">' + title + '<div class="faq-list">' + parts.join('') + '</div></section>';
      }
      let media = '';
      const image = container.find('img').first();
      if (image.length) {
        media = image.toString();
        const wrapper = image.parent();
        image.remove();
        if (wrapper.is('p') && !wrapper.text().trim() && !wrapper.children().length) wrapper.remove();
      }
      const isFeatured = page.key === 'home' && /^(1Win Features|🎁 1Win Bonuses|1Win Site – Providers and Games)/.test(content(title).text().trim());
      const classes = ['doc-section', group.hasTable ? 'doc-section--table' : '', media ? 'doc-section--media' : '', isFeatured ? 'doc-section--feature' : ''].filter(Boolean).join(' ');
      const body = '<div class="doc-section__copy">' + (isFeatured ? title : '') + container.html() + '</div>';
      const figure = media ? '<figure class="doc-section__media">' + media + '</figure>' : '';
      return '<section class="' + classes + '" id="section-' + (index + 1) + '">' + (isFeatured ? '' : title) + '<div class="doc-section__layout">' + body + figure + '</div></section>';
    }).join('');
    if (!h1s.length) throw new Error(`No h1 in extracted ${page.key} content`);
    const $root = $(`[${mappings.generatedArticleAttribute}="${page.key}"]`);
    $root.empty().append('<article class="docx-content">' + heroHtml + '<div class="docx-content__sections">' + sectionHtml + '</div></article>');
    $('head title').remove();
    $('head').append(`<title>${escapeHtml(record.title)}</title>`);
    $('head meta[name="description"],head link[rel="canonical"],head link[rel="alternate"],head meta[property^="og:"]').remove();
    const canonical = targetUrl(page.route);
    $('head').append(`<meta name="description" content="${escapeHtml(record.description)}">`);
    $('head').append(`<link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="${site.locale}" href="${canonical}">`);
    $('head').append(`<meta property="og:url" content="${canonical}"><meta property="og:title" content="${escapeHtml(record.title)}"><meta property="og:description" content="${escapeHtml(record.description)}">`);
    $('head').append('<link rel="stylesheet" href="/assets/adapter.css">');
    $('body').append('<div class="copy-toast" role="status" aria-live="polite" data-copy-toast></div>');
    $('body').append('<script src="/assets/adapter.js" defer></script>');
    $('html').attr('lang', site.locale);
    $('body').addClass('site-adapted');
    await write(file, $.html());
    const media = path.join(root, 'content/media', page.key);
    if (await exists(media)) {
      for (const name of await fs.readdir(media)) {
        await write(path.join(stage, 'assets', page.key, name), await fs.readFile(path.join(media, name)));
      }
    }
  }
  await write(path.join(stage, 'assets/adapter.css'), await fs.readFile(path.join(root, 'assets/adapter.css')));
  await write(path.join(stage, 'assets/adapter.js'), await fs.readFile(path.join(root, 'assets/adapter.js')));
  await write(path.join(stage, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${site.pages.map(p => `  <url><loc>${targetUrl(p.route)}</loc></url>`).join('\n')}\n</urlset>\n`);
  await write(path.join(stage, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.targetOrigin}/sitemap.xml\n`);
  await formatStage();
  console.log('Populated and formatted three pages in stage/');
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
