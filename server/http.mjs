import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDirectory = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const hash = value => createHash('sha256').update(value).digest();

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { const error = new Error('需要 application/json'); error.status = 415; throw error; }
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) { const error = new Error('配置内容过大'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { const error = new Error('JSON 格式无效'); error.status = 400; throw error; }
}

export function createApp({ monitor, adminToken, publicOrigin = '' }) {
  const expected = hash(`Bearer ${adminToken}`);
  return createServer(async (request, response) => {
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.hyperliquid.xyz; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/health') return json(200, { ok: !monitor.storageError, service: 'oil-spread-monitor' });
        if (request.method === 'GET' && url.pathname === '/api/status') return json(200, monitor.status());
        if (!adminToken || !timingSafeEqual(hash(request.headers.authorization || ''), expected)) return json(401, { error: '管理口令不正确' });
        if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin) {
          let origin;
          try { origin = new URL(request.headers.origin); } catch { return json(403, { error: '请求来源无效' }); }
          if (publicOrigin ? origin.origin !== publicOrigin : origin.host !== request.headers.host) return json(403, { error: '不允许跨站修改配置' });
        }
        if (request.method === 'GET' && url.pathname === '/api/config') return json(200, monitor.configuration());
        if (request.method === 'GET' && url.pathname === '/api/events') return json(200, { events: monitor.data.events });
        if (request.method === 'PUT' && url.pathname === '/api/config') {
          const body = await readBody(request);
          if (!body || !Number.isSafeInteger(body.revision)) return json(400, { error: '缺少配置版本号' });
          try { return json(200, await monitor.configure(body.config, body.revision)); }
          catch (error) { return json(error.status || (monitor.storageError ? 503 : 400), { error: error.message }); }
        }
        if (request.method === 'POST' && url.pathname === '/api/test-notification') {
          await readBody(request);
          try { return json(200, await monitor.testNotification()); }
          catch (error) { return json(error.status || 502, { error: error.message }); }
        }
        return json(404, { error: '接口不存在' });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: '请求方法不支持' });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return json(400, { error: '路径无效' }); }
      if (pathname.includes('\0') || pathname.includes('\\')) return json(404, { error: '文件不存在' });
      const target = path.resolve(publicDirectory, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(publicDirectory + path.sep) && target !== path.join(publicDirectory, 'index.html')) return json(404, { error: '文件不存在' });
      const mime = mimeTypes[path.extname(target)];
      if (!mime) return json(404, { error: '文件不存在' });
      try {
        const info = await stat(target);
        if (!info.isFile()) return json(404, { error: '文件不存在' });
        response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Content-Length': info.size });
        response.end(request.method === 'HEAD' ? undefined : await readFile(target));
      } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return json(404, { error: '文件不存在' }); throw error; }
    } catch (error) {
      if (!response.headersSent) json(error.status || 500, { error: error.status ? error.message : '服务处理失败' });
      else response.destroy();
    }
  });
}
