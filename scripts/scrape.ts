import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { site } from '../config/site.js';
import { assertApprovedSource, exists, original, relativeUrlPath, write } from './common.js';

type Entry = { url: string; file?: string; status?: number; contentType?: string; redirect?: string; error?: string };
const manifest: { source: string; host: string; started: string; entries: Entry[] } = {
  source: site.sourceUrl, host: site.sourceHost, started: new Date().toISOString(), entries: []
};
const queue: string[] = [site.sourceUrl];
const seen = new Set<string>();
let lastRequest = 0;

async function request(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, 350 - (Date.now() - lastRequest));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': '1win-template-adapter/1.0 (authorized archival)' } });
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Request retries exhausted');
}

function add(url: string, base: string) {
  try {
    const parsed = new URL(url, base);
    parsed.hash = '';
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== site.sourceHost) return;
    if (!seen.has(parsed.href)) queue.push(parsed.href);
  } catch { /* malformed URL */ }
}

async function main() {
  assertApprovedSource();
  await fs.mkdir(original, { recursive: true });
  const previousManifest = path.join(original, 'manifest.json');
  if (await exists(previousManifest)) {
    const previous = JSON.parse(await fs.readFile(previousManifest, 'utf8')) as { source?: string; entries?: Entry[] };
    if (previous.source && previous.source !== site.sourceUrl) throw new Error('Existing original archive belongs to another source URL');
    for (const entry of previous.entries || []) {
      if (!entry.file || !await exists(path.join(original, entry.file))) continue;
      manifest.entries.push(entry);
      seen.add(entry.url);
    }
    for (const entry of manifest.entries) {
      if (!entry.file || !entry.contentType?.includes('text/html')) continue;
      const $ = cheerio.load(await fs.readFile(path.join(original, entry.file), 'utf8'));
      $('meta[content]').each((_, el) => {
        const value = $(el).attr('content') || '';
        if (/^https?:\/\//.test(value)) add(value, entry.url);
      });
    }
  }
  const robotsUrl = new URL('/robots.txt', site.sourceUrl).href;
  try {
    const robots = await request(robotsUrl);
    manifest.entries.push({ url: robotsUrl, status: robots.status, contentType: robots.headers.get('content-type') || undefined });
    if (robots.ok) {
      const text = await robots.text();
      await write(path.join(original, 'robots.txt'), text);
      if (/^\s*disallow:\s*\/\s*$/im.test(text)) throw new Error('robots.txt disallows crawling');
      for (const match of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) add(match[1], robotsUrl);
    }
  } catch (error) {
    manifest.entries.push({ url: robotsUrl, error: String(error) });
    if (String(error).includes('disallows crawling')) throw error;
  }

  while (queue.length && seen.size < 500) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const entry: Entry = { url };
    manifest.entries.push(entry);
    try {
      const response = await request(url);
      entry.status = response.status;
      entry.contentType = response.headers.get('content-type') || undefined;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without Location');
        entry.redirect = new URL(location, url).href;
        if (new URL(entry.redirect).hostname !== site.sourceHost) {
          throw new Error(`Redirect to unapproved host: ${entry.redirect}`);
        }
        add(entry.redirect, url);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const local = relativeUrlPath(url);
      const destination = path.join(original, local);
      if (!destination.startsWith(original + path.sep)) throw new Error('Path escaped original directory');
      if (!await exists(destination)) await write(destination, bytes);
      entry.file = local;
      if (entry.contentType?.includes('text/html')) {
        const $ = cheerio.load(Buffer.from(bytes).toString('utf8'));
        $('a[href]').each((_, el) => add($(el).attr('href') || '', url));
        $('img[src],script[src],link[href],source[src],video[poster]').each((_, el) => add($(el).attr('src') || $(el).attr('href') || $(el).attr('poster') || '', url));
        $('meta[content]').each((_, el) => {
          const value = $(el).attr('content') || '';
          if (/^https?:\/\//.test(value)) add(value, url);
        });
        $('[srcset]').each((_, el) => ($(el).attr('srcset') || '').split(',').forEach(part => add(part.trim().split(/\s+/)[0], url)));
      } else if (entry.contentType?.includes('text/css')) {
        const css = Buffer.from(bytes).toString('utf8');
        for (const match of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) add(match[1], url);
      } else if (entry.contentType?.includes('xml') || url.endsWith('.xml')) {
        const xml = cheerio.load(Buffer.from(bytes).toString('utf8'), { xmlMode: true });
        xml('loc').each((_, el) => add(xml(el).text().trim(), url));
      }
    } catch (error) {
      entry.error = String(error);
      if (url === site.sourceUrl) break;
    }
  }
  await write(path.join(original, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const home = manifest.entries.find(entry => entry.url === site.sourceUrl);
  if (!home?.file) throw new Error(`Source home was not archived: ${home?.error || home?.redirect || 'unknown error'}`);
  const failures = manifest.entries.filter(entry => entry.error);
  if (failures.length) throw new Error(`Archive has ${failures.length} failed requests; see source/original/manifest.json`);
  console.log(`Saved ${manifest.entries.filter(entry => entry.file).length} files to source/original`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
