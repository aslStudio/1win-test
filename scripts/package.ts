import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dist, exists, original, root, routeFile } from './common.js';
import { site } from '../config/site.js';

const run = promisify(execFile);
async function zip(file: string, entries: string[]) {
  await fs.rm(file, { force: true });
  await run('zip', ['-q', '-r', file, ...entries], { cwd: root });
  console.log(file);
}

async function main() {
  const output = path.join(root, 'deliverables');
  await fs.mkdir(output, { recursive: true });
  if (await exists(path.join(original, 'index.html')) && await exists(path.join(original, 'manifest.json'))) {
    await zip(path.join(output, 'original-template.zip'), ['source/original']);
  } else console.log('Skipped original-template.zip: approved original is incomplete');
  if (site.pages.every(page => existsSync(routeFile(page.route))) && await exists(path.join(dist, 'sitemap.xml'))) {
    await run('npm', ['run', 'validate'], { cwd: root });
    const entries = ['dist', 'stage', 'scripts', 'config', 'assets', 'content', 'input/content', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'REPORT.md'];
    if (await exists(path.join(root, '.github'))) entries.push('.github');
    if (await exists(path.join(root, 'qa'))) entries.push('qa');
    await zip(path.join(output, 'finished-site.zip'), entries);
  } else console.log('Skipped finished-site.zip: finished site is incomplete');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
