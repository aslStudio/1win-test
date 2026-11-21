import { promises as fs } from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { site } from '../config/site.js';
import { exists, root, write } from './common.js';

async function main() {
  for (const page of site.pages) {
    const input = path.join(root, page.docx);
    if (!await exists(input)) throw new Error(`Missing DOCX: ${page.docx}`);
    let imageNumber = 0;
    const converted = await mammoth.convertToHtml(
      { path: input },
      { convertImage: mammoth.images.imgElement(async image => {
        const extension = image.contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
        const filename = `docx-${++imageNumber}.${extension}`;
        await write(path.join(root, 'content/media', page.key, filename), Buffer.from(await image.read('base64'), 'base64'));
        return { src: `/assets/${page.key}/${filename}` };
      }) }
    );
    const $ = cheerio.load(converted.value);
    const paragraphs = $('p').map((_, el) => $(el).text().trim()).get();
    const explicitTitle = paragraphs.find(text => /^Title:\s*/i.test(text))?.replace(/^Title:\s*/i, '').trim();
    const explicitDescription = paragraphs.find(text => /^Description:\s*/i.test(text))?.replace(/^Description:\s*/i, '').trim();
    $('body').children().filter((_, el) => /^(?:Title & Description|Title:|Description:|Текст для)/i.test($(el).text().trim()) && !$(el).find('p,h1,h2,h3,h4,h5,h6').length).remove();
    const h1 = $('p').first().text().trim();
    if (!h1) throw new Error(`No heading/content in ${page.docx}`);
    $('p').first().replaceWith(`<h1>${h1.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</h1>`);
    const headings = $('h1,h2,h3,h4,h5,h6').map((_, el) => ({ level: Number(el.tagName.slice(1)), text: $(el).text().trim() })).get();
    const record = {
      source: page.docx, route: page.route,
      title: explicitTitle || h1,
      description: explicitDescription || $('p').first().text().trim().slice(0, 160),
      html: $('body').html() || '',
      headings, imageCount: imageNumber,
      warnings: converted.messages
    };
    await write(path.join(root, 'content', `${page.key}.json`), JSON.stringify(record, null, 2));
    console.log(`${page.key}: ${headings.length} headings, ${$('table').length} tables, ${imageNumber} embedded images`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
