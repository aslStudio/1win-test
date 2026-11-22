import { createServer } from 'node:http';
import { promises as fs, watch } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { dist, stage } from './common.js';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2'
};

const reloadClient = `<script>(()=>{const events=new EventSource('/__stage_events');let timer;events.onmessage=event=>{const file=JSON.parse(event.data);clearTimeout(timer);timer=setTimeout(()=>{if(file.endsWith('.css')){let updated=false;document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{const url=new URL(link.href);if(url.pathname==='/' + file){url.searchParams.set('stage_reload',Date.now().toString());link.href=url.href;updated=true}});if(updated)return}location.reload()},80)}})();</script>`;

export function createStaticServer(directory = dist, liveReload = false, mountPath = '/') {
  const clients = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      const prefix = mountPath === '/' ? '' : mountPath.replace(/\/+$/, '');
      if (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) {
        response.writeHead(404).end('Not found');
        return;
      }
      if (liveReload && url.pathname === '/__stage_events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive'
        });
        response.write(': connected\n\n');
        clients.add(response);
        response.on('close', () => clients.delete(response));
        return;
      }
      let relative = decodeURIComponent(prefix ? url.pathname.slice(prefix.length) : url.pathname).replace(/^\/+/, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      let file = path.resolve(directory, relative);
      if (!file.startsWith(directory + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      let data: Buffer | string;
      try {
        data = await fs.readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.extname(relative)) throw error;
        file = path.resolve(directory, relative + '.html');
        if (!file.startsWith(directory + path.sep)) {
          response.writeHead(403).end();
          return;
        }
        data = await fs.readFile(file);
      }
      if (liveReload && path.extname(file) === '.html') {
        const html = data.toString();
        data = html.includes('</body>') ? html.replace('</body>', reloadClient + '</body>') : html + reloadClient;
      }
      response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(data);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  if (liveReload) {
    server.on('listening', () => {
      const watcher = watch(directory, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const changed = String(filename).replaceAll('\\', '/');
        for (const client of clients) client.write(`data: ${JSON.stringify(changed)}\n\n`);
      });
      server.on('close', () => {
        watcher.close();
        for (const client of clients) client.end();
      });
    });
  }
  return server;
}

if (process.argv[1]?.endsWith('/serve.ts')) {
  const useStage = process.argv.includes('--stage');
  const server = useStage ? createStaticServer(stage, true) : createStaticServer();
  server.listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
}
