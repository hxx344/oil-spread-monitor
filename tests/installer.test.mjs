import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('../deploy/install.sh', import.meta.url));
let bash = 'bash';
if (process.platform === 'win32') {
  const found = spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0];
  bash = found ? path.resolve(path.dirname(found), '../bin/bash.exe') : '';
}
const available = Boolean(bash && (process.platform !== 'win32' || existsSync(bash)));
async function sandbox(action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'oil-installer-'));
  try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function run(directory, body, env = {}) {
  // Source function definitions only. None of these unit tests invoke main,
  // package managers, Docker, or privileged host setup.
  return spawnSync(bash, ['-c', `source "$1"; INSTALL_DIR="$2"; INTERACTIVE=0; ${body}`, '--', installer, directory], {
    encoding: 'utf8', env: { ...process.env, ADMIN_TOKEN: '', FEISHU_WEBHOOK_URL: '', FEISHU_WEBHOOK_SECRET: '', OIL_DOMAIN: '', HTTP_PORT: '', BIND_ADDRESS: '', COMPOSE_PROJECT_NAME: '', ...env }
  });
}
function values(text) { return Object.fromEntries(text.trim().split(/\r?\n/).filter(line => line.includes('=')).map(line => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1).replace(/^'|'$/g, '')]; })); }

test('installer syntax and help work both from a file and a curl-style stdin pipe', { skip: !available }, async () => {
  assert.equal(spawnSync(bash, ['-n', installer], { encoding: 'utf8' }).status, 0);
  const result = spawnSync(bash, [installer, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stdout, /--non-interactive/);
  const piped = spawnSync(bash, ['-s', '--', '--help'], { encoding: 'utf8', input: await readFile(installer, 'utf8') });
  assert.equal(piped.status, 0, piped.stderr); assert.match(piped.stdout, /--non-interactive/);
});

test('fresh unattended install generates a secret and writes valid defaults without logging credentials', { skip: !available }, async () => {
  await sandbox(async directory => {
    const result = run(directory, 'PORT_OPTION=03000; configure');
    assert.equal(result.status, 0, result.stderr);
    const config = values(await readFile(path.join(directory, '.env'), 'utf8'));
    assert.match(config.ADMIN_TOKEN, /^[a-f0-9]{64}$/);
    assert.equal(config.HTTP_PORT, '3000'); assert.equal(config.BIND_ADDRESS, '0.0.0.0');
    assert.equal(config.FEISHU_WEBHOOK_URL, ''); assert.equal(config.OIL_DOMAIN, '');
    assert.ok(!result.stdout.includes(config.ADMIN_TOKEN)); assert.ok(!result.stderr.includes(config.ADMIN_TOKEN));
    const before = await readFile(path.join(directory, '.env'), 'utf8');
    const repeated = run(directory, 'PORT_OPTION=03000; configure');
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), before);
  });
});

test('HTTPS normalizes mixed-case domains, respects requested port, and preserves literal dollar signs in secrets', { skip: !available }, async () => {
  await sandbox(async directory => {
    const secret = 'example$literal#secret';
    const result = run(directory, "DOMAIN_OPTION=Oil.Example.COM; PORT_OPTION=3100; configure", { FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/example-id', FEISHU_WEBHOOK_SECRET: secret });
    assert.equal(result.status, 0, result.stderr);
    const config = values(await readFile(path.join(directory, '.env'), 'utf8'));
    assert.equal(config.OIL_DOMAIN, 'oil.example.com'); assert.equal(config.PUBLIC_ORIGIN, 'https://oil.example.com');
    assert.equal(config.BIND_ADDRESS, '127.0.0.1'); assert.equal(config.HTTP_PORT, '3100');
    assert.equal(config.FEISHU_WEBHOOK_SECRET, secret); assert.ok(!result.stdout.includes(secret));
  });
});

test('repeat configuration keeps existing settings byte-for-byte despite conflicting environment values', { skip: !available }, async () => {
  await sandbox(async directory => {
    const existing = "# user configuration\nADMIN_TOKEN='existing-secret-with-at-least-24-characters'\nHTTP_PORT=3200\nBIND_ADDRESS=127.0.0.1\nFEISHU_WEBHOOK_URL=\nEXTRA_SETTING=keep-me\n";
    await writeFile(path.join(directory, '.env'), existing);
    const result = run(directory, 'configure; printf "%s,%s" "$APP_PORT" "$APP_BIND"', { HTTP_PORT: '9999', BIND_ADDRESS: '0.0.0.0', ADMIN_TOKEN: 'do-not-replace-existing-token' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /3200,127\.0\.0\.1/);
    assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), existing);
  });
});

test('an empty token is repaired without dropping existing configuration', { skip: !available }, async () => {
  await sandbox(async directory => {
    await writeFile(path.join(directory, '.env'), 'ADMIN_TOKEN=\nHTTP_PORT=3300\nEXTRA_SETTING=keep-me\n');
    const result = run(directory, 'configure'); assert.equal(result.status, 0, result.stderr);
    const text = await readFile(path.join(directory, '.env'), 'utf8'), config = values(text);
    assert.match(config.ADMIN_TOKEN, /^[a-f0-9]{64}$/); assert.equal(config.HTTP_PORT, '3300'); assert.equal(config.EXTRA_SETTING, 'keep-me');
    assert.equal(text.match(/^ADMIN_TOKEN=/gm).length, 1);
  });
});

test('quoted existing values support inline comments and retain hash characters inside quotes', { skip: !available }, async () => {
  await sandbox(async directory => {
    const existing = "ADMIN_TOKEN = 'existing-secret#with-at-least-24-characters' # token\nHTTP_PORT='3400' # port\nBIND_ADDRESS=\"127.0.0.1\" # bind\nOIL_DOMAIN='oil.example.com' # domain\nPUBLIC_ORIGIN='https://oil.example.com'\n";
    await writeFile(path.join(directory, '.env'), existing);
    const result = run(directory, 'configure; printf "%s,%s" "$APP_PORT" "$APP_DOMAIN"');
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /3400,oil\.example\.com/);
    assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), existing);
  });
});

test('invalid ports, domains, endpoint hosts and conflicting repeat options fail without overwriting config', { skip: !available }, async () => {
  for (const body of ['PORT_OPTION=70000; configure', 'DOMAIN_OPTION=https://bad.example; configure', 'DOMAIN_OPTION=oil.example.com; PORT_OPTION=080; configure', 'FEISHU_WEBHOOK_URL=https://evil.example/hook; configure']) {
    await sandbox(async directory => { const result = run(directory, body); assert.notEqual(result.status, 0); assert.equal(existsSync(path.join(directory, '.env')), false); });
  }
  await sandbox(async directory => {
    const existing = "ADMIN_TOKEN='existing-secret-with-at-least-24-characters'\nHTTP_PORT=3000\n";
    await writeFile(path.join(directory, '.env'), existing);
    assert.notEqual(run(directory, 'PORT_OPTION=4000; configure').status, 0);
    assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), existing);
  });
});

test('HTTPS failure keeps the application running but does not claim a completed deployment', { skip: !available }, async () => {
  await sandbox(async directory => {
    const result = run(directory, `
      APP_PROJECT=test-project; APP_PORT=3000; APP_BIND=127.0.0.1; APP_DOMAIN=oil.example.com;
      docker_local() { if [[ "$*" == *'ps -q'* ]]; then printf fake-container; fi; return 0; }
      timeout() { return 0; }; curl() { return 1; }; sleep() { return 0; }
      deploy
    `);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /HTTPS 尚未就绪/);
    assert.ok(!result.stdout.includes('部署完成'));
  });
});

test('deploy pins Compose project and interpolation to saved configuration, ignoring ambient overrides', { skip: !available }, async () => {
  await sandbox(async directory => {
    const result = run(directory, `
      APP_PROJECT=existing-project; APP_PORT=3200; APP_BIND=127.0.0.1; APP_DOMAIN='';
      docker_local() { if [[ "$*" == *'ps -q'* ]]; then printf fake-container; else printf '%s|%s|%s|%s\\n' "$HTTP_PORT" "$BIND_ADDRESS" "$OIL_DOMAIN" "$*" >> "$INSTALL_DIR/calls"; fi; }
      timeout() { return 0; }
      deploy
    `, { HTTP_PORT: '9000', BIND_ADDRESS: '0.0.0.0', OIL_DOMAIN: 'wrong.example', COMPOSE_PROJECT_NAME: 'wrong-project' });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readFile(path.join(directory, 'calls'), 'utf8');
    assert.match(calls, /3200\|127\.0\.0\.1\|\|compose --project-name existing-project/);
    assert.ok(!calls.includes('wrong-project')); assert.ok(!calls.includes('wrong.example'));
  });
});
