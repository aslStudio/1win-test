import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as prettier from 'prettier';
import { stage } from './common.js';
import { confirmReplacement } from './confirm.js';

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    files.push(...(item.isDirectory() ? await filesUnder(file) : [file]));
  }
  return files;
}

export async function formatStage() {
  let count = 0;
  for (const file of await filesUnder(stage)) {
    const extension = path.extname(file).toLowerCase();
    const parser = extension === '.html' || extension === '.svg' ? 'html'
      : extension === '.css' ? 'css'
      : extension === '.js' ? 'babel'
      : null;
    if (!parser) continue;
    const input = await fs.readFile(file, 'utf8');
    const output = await prettier.format(input, { parser, printWidth: 100, tabWidth: 2, singleQuote: true });
    if (output !== input) await fs.writeFile(file, output);
    count++;
  }
  console.log(`Formatted ${count} source files in stage/`);
}

if (process.argv[1]?.endsWith('/format.ts')) {
  confirmReplacement(stage)
    .then(formatStage)
    .catch(error => { console.error(error); process.exitCode = 1; });
}
