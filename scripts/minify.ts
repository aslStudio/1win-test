import { promises as fs } from 'node:fs';
import path from 'node:path';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import { confirmReplacement } from './confirm.js';
import { dist, exists, root, routeFile, stage, write } from './common.js';
import { site } from '../config/site.js';

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    files.push(...(item.isDirectory() ? await filesUnder(file) : [file]));
  }
  return files;
}

async function main() {
  for (const page of site.pages) {
    if (!await exists(routeFile(page.route, stage))) {
      throw new Error(`stage/ is missing ${page.route}`);
    }
  }
  if (!await exists(path.join(stage, 'sitemap.xml'))) throw new Error('stage/ is missing sitemap.xml');
  await confirmReplacement(dist);
  const next = path.join(root, '.dist-next');
  const backup = path.join(root, '.dist-backup');
  await fs.rm(next, { recursive: true, force: true });
  await fs.mkdir(next, { recursive: true });
  try {
    for (const source of await filesUnder(stage)) {
      const relative = path.relative(stage, source);
      const extension = path.extname(source).toLowerCase();
      const target = path.join(next, relative);
      if (!['.html', '.css', '.js', '.xml'].includes(extension)) {
        await write(target, await fs.readFile(source));
        continue;
      }
      const input = await fs.readFile(source, 'utf8');
      let output = input;
      if (extension === '.html') {
        output = await minifyHtml(input, {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          minifyCSS: true,
          minifyJS: true
        });
      } else if (extension === '.css') {
        const result = new CleanCSS({ level: 1 }).minify(input);
        if (result.errors.length) throw new Error(`${relative}: ${result.errors.join('; ')}`);
        output = result.styles;
      } else if (extension === '.js') {
        const result = await minifyJs(input);
        if (!result.code) throw new Error(`${relative}: JS minification returned no code`);
        output = result.code;
      } else if (extension === '.xml') {
        output = input.replace(/>\s+</g, '><').trim();
      }
      await write(target, output);
    }
    await fs.rm(backup, { recursive: true, force: true });
    if (await exists(dist)) await fs.rename(dist, backup);
    try {
      await fs.rename(next, dist);
      await fs.rm(backup, { recursive: true, force: true });
      await fs.rm(path.join(root, 'qa'), { recursive: true, force: true });
    } catch (error) {
      if (await exists(backup)) await fs.rename(backup, dist);
      throw error;
    }
    console.log('Minified stage/ into dist/');
  } finally {
    await fs.rm(next, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
