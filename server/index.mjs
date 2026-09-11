import { FileStore } from './store.mjs';
import { createNotifier, validateWebhook } from './feishu.mjs';
import { Monitor } from './monitor.mjs';
import { createApp } from './http.mjs';
import { fetchMarket } from '../dist/hyperliquid.mjs';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

async function main() {
  const token = process.env.ADMIN_TOKEN || '';
  if (token.length < 24) throw new Error('请在 .env 设置至少 24 个字符的 ADMIN_TOKEN，可运行 node scripts/init-env.mjs 生成');
  const pollSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 30), port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 10 || pollSeconds > 3600) throw new Error('POLL_INTERVAL_SECONDS 需为 10–3600 的整数');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  let publicOrigin = process.env.PUBLIC_ORIGIN || '';
  if (publicOrigin) { const parsed = new URL(publicOrigin); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== publicOrigin) throw new Error('PUBLIC_ORIGIN 需为完整站点来源且不含路径'); }
  const webhook = validateWebhook(process.env.FEISHU_WEBHOOK_URL || '');
  const store = new FileStore(process.env.DATA_DIR || './data', process.env.OIL_EXTERNAL_LOCK === '1');
  await store.acquire();
  let server, monitor;
  try {
    const data = await store.read();
    monitor = new Monitor({ store, data, fetchMarket, notify: createNotifier({ webhook, secret: process.env.FEISHU_WEBHOOK_SECRET || '' }), webhookConfigured: Boolean(webhook), pollSeconds });
    server = createApp({ monitor, adminToken: token, publicOrigin });
    server.requestTimeout = 20_000; server.headersTimeout = 15_000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, process.env.HOST || '0.0.0.0', resolve); });
    monitor.start();
    console.log(`Oil spread monitor listening on http://127.0.0.1:${port}`);
    console.log(`Feishu: ${webhook ? 'configured' : 'not configured'}; polling every ${pollSeconds}s`);
  } catch (error) { await store.release(); throw error; }
  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    const timer = setTimeout(() => process.exit(1), 25_000).unref();
    try { await new Promise(resolve => server.close(resolve)); await monitor.stop(); await store.release(); clearTimeout(timer); }
    catch { process.exitCode = 1; }
  }
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
// Native Linux starts share the same kernel lock as Docker and systemd.
// Kernel locks release on crashes, so restart policies can recover unattended.
if (process.platform === 'linux' && process.env.OIL_EXTERNAL_LOCK !== '1') {
  const directory = path.resolve(process.env.DATA_DIR || './data');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const child = spawn('flock', ['--no-fork', '--nonblock', path.join(directory, 'instance.lock'), process.execPath, fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, DATA_DIR: directory, OIL_EXTERNAL_LOCK: '1' } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { console.error('无法启动 Linux 进程锁，请安装 util-linux（flock）'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} else main().catch(error => { console.error(error.message); process.exitCode = 1; });
