import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
try {
  await writeFile(new URL('../.env', import.meta.url), template.replace('ADMIN_TOKEN=', `ADMIN_TOKEN=${randomBytes(32).toString('hex')}`), { flag: 'wx', mode: 0o600 });
  console.log('已创建 .env 并生成管理口令。请编辑飞书机器人配置；管理口令不会打印到日志。');
} catch (error) {
  if (error.code === 'EEXIST') { console.error('.env 已存在，未覆盖。'); process.exitCode = 1; } else throw error;
}
