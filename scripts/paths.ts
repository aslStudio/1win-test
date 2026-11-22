import path from 'node:path';

export function relativeSiteUrl(fromFile: string, rootUrl: string): string {
  if (!rootUrl.startsWith('/') || rootUrl.startsWith('//')) return rootUrl;
  const url = new URL(rootUrl, 'https://local.invalid');
  const directory = path.posix.dirname('/' + fromFile.replace(/^\/+/, ''));
  const relative = path.posix.relative(directory, url.pathname);
  const pathname = relative ? relative + (url.pathname.endsWith('/') && !relative.endsWith('/') ? '/' : '') : './';
  return pathname + url.search + url.hash;
}

export function relativeCssUrls(css: string, fromFile: string): string {
  return css.replace(/url\(\s*(["']?)(\/(?!\/)[^)'"\s]+)\1\s*\)/g, (_, quote: string, url: string) => {
    return `url(${quote}${relativeSiteUrl(fromFile, url)}${quote})`;
  });
}
