import { promises as fs } from 'node:fs';
import path from 'node:path';
import { site } from '../config/site.js';

export const root = process.cwd();
export const original = path.join(root, 'source/original');
export const work = path.join(root, 'work');
export const stage = path.join(root, 'stage');
export const dist = path.join(root, 'dist');

export async function exists(file: string) {
  try { await fs.access(file); return true; } catch { return false; }
}

export async function write(file: string, value: string | Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}

export async function copyDir(from: string, to: string) {
  await fs.rm(to, { recursive: true, force: true });
  await fs.cp(from, to, { recursive: true });
}

export function relativeUrlPath(input: string) {
  const url = new URL(input, site.sourceUrl);
  if (url.hostname !== site.sourceHost) throw new Error(`Outside approved source host: ${url.href}`);
  let decoded = decodeURIComponent(url.pathname);
  if (decoded.includes('..') || decoded.includes('\\')) throw new Error(`Unsafe path: ${url.href}`);
  if (decoded.endsWith('/')) decoded += 'index.html';
  if (!path.posix.extname(decoded)) decoded += '.html';
  return decoded.replace(/^\/+/, '');
}

export function routeFile(route: string, base = dist) {
  return path.join(base, route.replace(/^\/+/, ''), 'index.html');
}

export function targetUrl(route: string) {
  return site.targetOrigin + route;
}

export function assertApprovedSource() {
  const url = new URL(site.sourceUrl);
  if (url.hostname !== site.sourceHost) {
    throw new Error(`SOURCE_URL host ${url.hostname} differs from SOURCE_HOST ${site.sourceHost}. Set both explicitly after source approval.`);
  }
}
