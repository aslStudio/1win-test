import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { root } from './common.js';

export async function confirmReplacement(directory: string) {
  let entries: string[];
  try { entries = await fs.readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!entries.length) return;
  if (process.env.ALLOW_OVERWRITE === '1') return;
  const label = path.relative(root, directory) || directory;
  if (!process.stdin.isTTY) {
    throw new Error(`${label}/ is not empty. Run interactively to confirm replacement, or set ALLOW_OVERWRITE=1 explicitly.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${label}/ is not empty. Replace its contents? Type yes or да to continue: `);
    if (!['yes', 'да'].includes(answer.trim().toLowerCase())) throw new Error(`Replacement of ${label}/ cancelled`);
  } finally {
    prompt.close();
  }
}
