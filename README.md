# 原油价差监控 · Hyperliquid / XYZ

Hyperliquid / XYZ 原油永续合约看板，加上可在 Linux 持续运行的价格／价差阈值监控与飞书告警。前端为原生 HTML、CSS、JavaScript，后端为 Node.js 24，无第三方运行依赖。

- 布伦特、WTI 和 `布伦特 − WTI` 价差分别支持多个上限／下限梯度，最多 50 条，可从前端新增、删除、修改和启停。
- 每条规则有独立的冷却时间、回差和发送状态；配置与最近 100 次发送记录存入服务器磁盘，重启后保留。
- 后台默认每 30 秒采集一次，关闭网页不影响告警；飞书 Webhook 与签名密钥仅保存在服务器环境变量。
- 保留 2026 年历史价差、价格图和历史做多／做空资金费率。

GitHub：[hxx344/oil-spread-monitor](https://github.com/hxx344/oil-spread-monitor)。Linux 部署使用整个仓库；`dist` 单独静态托管只提供看板，不运行后台告警。

## Linux 快速部署（Docker Compose）

需要已安装 Docker Engine 和 Compose 插件，并能访问 Hyperliquid 与飞书公网 API。仓库为私有，克隆时使用有权限的 GitHub 账号。

```bash
git clone https://github.com/hxx344/oil-spread-monitor.git
cd oil-spread-monitor
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
nano .env
```

将生成的随机字符串填入 `ADMIN_TOKEN`，将飞书群自定义机器人的 Webhook 填入 `FEISHU_WEBHOOK_URL`；机器人开启签名校验时再填 `FEISHU_WEBHOOK_SECRET`。也可以在有 Node.js 24 的机器上执行 `node scripts/init-env.mjs` 自动创建 `.env` 与管理口令，已有 `.env` 不会被覆盖。

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
docker compose logs --tail=50 oil-monitor
```

默认端口只绑定 Linux 主机的 `127.0.0.1:3000`。从本机访问可先建立 SSH 转发：

```bash
ssh -L 3000:127.0.0.1:3000 user@your-linux-server
```

然后在浏览器打开 `http://localhost:3000`。长期通过域名访问时，可使用 `deploy/Caddyfile` 配置 HTTPS 反向代理，将 `oil.example.com` 改为自己的域名，并在 `.env` 设置 `PUBLIC_ORIGIN=https://你的域名`。如果已有 HTTPS 代理，只需转发至 `127.0.0.1:3000`。管理口令在每次解锁时通过请求头发送，因此公网访问使用 HTTPS。

页面点击“告警设置”，输入 `ADMIN_TOKEN` 解锁。修改默认示例梯度后打开总开关并保存，再点击“发送飞书测试消息”检查收件结果。默认总开关关闭；机器人未配置时页面会说明原因，并允许先保存规则。

## 告警触发方式

所有阈值的单位均为 **美元／桶**。当前价格使用 Hyperliquid `markPx`，WTI API 合约为 `xyz:CL`，价差固定为 **布伦特标记价减 WTI 标记价**。

| 设置 | 含义 |
| --- | --- |
| 达到或高于 `≥` | 本次采集值大于等于阈值时触发 |
| 达到或低于 `≤` | 本次采集值小于等于阈值时触发 |
| 回差 | 上限规则需跌到 `阈值 − 回差` 以下，下限规则需涨到 `阈值 + 回差` 以上，才重新待命 |
| 冷却时间 | 两次成功告警之间的最短分钟数；不代表持续超限时定期重复发送 |

例如设置价差 `≥ 3 / ≥ 5 / ≥ 8` 三个梯度。价差从 2 跳到 6 时，3 和 5 两级会合并为一条飞书消息；随后保持 6 不会重复发送，涨到 8 时再发送 8 这一级。如果 5 这一级回差为 0.2，需跌到 4.8 以下才复位；再次达到 5 且冷却完成后重新告警。

- 首次启用、新增梯度、修改其指标／方向／阈值／回差时，已满足的条件会在下一次成功采集时触发。仅改名称或冷却时间保留已有触发状态。
- 暂停总开关时继续采集和记录回差复位，但不发送；关闭单个梯度后重新启用会将该梯度重新待命。
- 发送失败后，仍满足阈值的事件最多每 60 秒重试一次；条件不再满足时不补发过时通知。网络失败、业务失败和未确认结果可在发送记录中查看。
- 多个梯度同时触发时合并发送；只有飞书 HTTP 成功且响应 `code=0` 才记为已发送。启用关键词校验时，将关键词设置为“原油阈值告警”，正式消息和测试消息都包含该词。
- 采集失败或数据过期时不使用静态快照触发告警。轮询只能观察采样时刻，两个采样之间快速穿越并恢复的行情可能不被观察到。
- 配置更新带版本号；另一个页面先保存后，旧页面提交会报冲突并保留输入，点击重新载入再修改。
- 事件 ID 在发送前持久化，成功状态也持久化。飞书不提供请求幂等保证；若消息已送达而响应丢失，或送达后进程在落盘前崩溃，重试可能重复，消息内相同事件 ID 可用于识别。

飞书协议参考：[自定义机器人官方指南](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)。签名为以 `timestamp + "\n" + secret` 作 key、空字符串作消息的 HMAC-SHA256，再 Base64；时间戳使用秒，服务器时钟应同步。

## 配置与持久化

| 环境变量 | 默认值／用途 |
| --- | --- |
| `ADMIN_TOKEN` | 必填，至少 24 字符；用于解锁设置和测试发送 |
| `FEISHU_WEBHOOK_URL` | 飞书／Lark 群自定义机器人 Webhook，空值时不发送 |
| `FEISHU_WEBHOOK_SECRET` | 可选，机器人签名密钥 |
| `POLL_INTERVAL_SECONDS` | `30`，允许 10–3600 秒；每轮完成后间隔该时长 |
| `DATA_DIR` | 原生启动 `./data`；Compose 固定 `/data`；systemd 固定 `/var/lib/oil-spread-monitor` |
| `HOST` / `PORT` | Node 监听地址／端口，默认 `0.0.0.0:3000` |
| `PUBLIC_ORIGIN` | 可选，公开访问的完整来源，如 `https://oil.example.com`，不带尾斜杠 |
| `BIND_ADDRESS` / `HTTP_PORT` | Compose 宿主机绑定，默认 `127.0.0.1` / `3000` |

管理口令仅保留在当前页面内存，刷新或锁定后需要重新输入；接口不会返回口令、Webhook 或签名密钥。`.env` 和运行数据目录已被 Git 与 Docker 构建排除。

Compose 使用命名卷 `monitor-data` 保存 `monitor.json`。普通重建／重启不会丢失规则；不要在需要保留数据时执行 `docker compose down -v`。后台采用串行写入、原子替换和磁盘同步；磁盘写入失败会暂停告警并在页面状态中显示原因，修复磁盘后重启。

```bash
# 升级代码并重建，保留数据卷
git pull --ff-only
docker compose up -d --build

# 修改 .env 后重新创建容器以载入新配置
docker compose up -d --force-recreate

# 导出一份完整、原子写入的规则与发送状态备份
docker compose exec -T oil-monitor cat /data/monitor.json > monitor-backup.json
```

只运行一个监控实例。Docker、systemd 和 Linux 原生启动使用同一数据目录内的内核 `flock`，崩溃后自动释放锁；不同数据目录仍是独立实例。备份恢复时先停服务，再替换数据文件。数据文件损坏时启动失败并保留原文件，不会静默恢复默认规则。

## Linux 原生 systemd 部署

适用于已经安装 Node.js 24 和 `util-linux` 的服务器。先把仓库及配置准备在 `/opt/oil-spread-monitor`；确认 `node` 位于 `/usr/bin/node`，否则修改 service 的绝对路径。`.env` 用标准 `KEY=value` 行，不要使用 `export`。

```bash
sudo useradd --system --home-dir /opt/oil-spread-monitor --shell /usr/sbin/nologin oil-monitor
sudo chown -R oil-monitor:oil-monitor /opt/oil-spread-monitor
sudo chmod 600 /opt/oil-spread-monitor/.env
sudo cp /opt/oil-spread-monitor/deploy/oil-spread-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oil-spread-monitor
sudo systemctl status oil-spread-monitor
sudo journalctl -u oil-spread-monitor -n 50
```

systemd 会创建并保存 `/var/lib/oil-spread-monitor`，不依赖应用目录写权限。原生部署若配合本机 HTTPS 代理，可在 `.env` 设置 `HOST=127.0.0.1`。

## 本地开发与验证

```powershell
node scripts/init-env.mjs
npm start
npm test
npm run check
```

访问 `http://127.0.0.1:3000/`。首次运行先生成 `.env`；已有配置时跳过初始化。Windows 原生开发异常退出时，确认旧进程结束后移除 `data/monitor.lock` 再启动；Linux 使用自动释放的内核锁。

GitHub Actions 在 Ubuntu 上运行测试、构建 Docker 镜像，并验证 HTTP 服务、保存配置和 `SIGKILL` 后重启的数据保留。测试使用伪造通知接收端，不向真实飞书群发送。

## 数据来源与价格口径

- 用户提供的 [BRENTOIL](https://app.hyperliquid.xyz/trade/xyz:BRENTOIL) 对应 API `xyz:BRENTOIL`；[WTIOIL](https://app.hyperliquid.xyz/trade/xyz:WTIOIL) 的 API 名称为 `xyz:CL`。映射及每单位 1 桶见 [XYZ 官方商品目录](https://docs.trade.xyz/asset-directory/commodities)。不要对不存在的 `xyz:WTIOIL` 发 API 请求。
- 公共接口为 `POST https://api.hyperliquid.xyz/info`。无需钱包、API 密钥、用户地址或交易权限。
- 历史使用 `candleSnapshot` 的 `1d` 成交日 K 收盘 `c`；只保留 UTC 已收盘日 K，并按时间戳配对。当前未收盘日 K 不进入历史统计。请求范围从 2026-01-01 开始，实际共同数据自 **2026-03-04** 起；不使用 EIA 或其他数据回填之前的日期。
- 顶部当前价格采用 `metaAndAssetCtxs` (`dex: xyz`) 的 `markPx`，按 `meta.universe[].name` 查找上下文，不能硬编码数组位置。第四个指标为完整共同历史区间首尾收盘价差变化。
- 当前行情每 60 秒更新，历史每 5 分钟更新；页面隐藏时暂停请求。手动刷新会重取历史和当前行情。
- `dist/data/hyperliquid-2026.json` 是带采集时间的备用快照。启动先显示快照再尝试更新；更新失败保留最近有效数据，并明确显示失败状态及旧采集时间，不伪装为实时数据。
- 图表的最近 1/3 月窗口以最后一个共同已收盘日为终点。缺失自然日断线；月度平均仅按所选区间内实际有效日计算。

## 历史做多与做空资金费率

价差图下方显示历史资金费率，两张图共用日期范围与悬浮/键盘游标。原始数据来自两合约 `fundingHistory` 的真实已结算小时率，完整分页取数；备用文件为 `dist/data/hyperliquid-funding-2026.json`。启动后增量拉取最近两天，每 5 分钟更新，失败保留有效历史，并独立标注状态。

- 历史口径固定为每次结算两腿等预言机美元名义，总敞口作分母：做空 `(fB-fW)/2`，做多为其相反数。正数收款，负数付款。历史接口不提供当时的预言机价，因而不使用今日价格回填等桶数历史费率；该口径独立于上方当前预估的配仓选项。
- 按原始结算所在 UTC 小时对齐两腿（结算区块可能晚于整点数毫秒），缺失一腿时不计算净率，不补零。若同一小时出现不同费率则报错。
- 图表每个日度点是该 UTC 结算日中共同小时净费率的算术平均，单位为 `%/小时`，不是日累计费率或账户收益率。UTC 00:00 的结算归当天。提示框与明细表显示实际样本数；首日等不完整日期保留实际样本均值。
- 历史费率图与价格图保持相同已收盘日范围；更新中的当天结算点会保存在快照，待该日进入价格图后展示。上方当前预计费率继续独立实时更新。

## 做空价差的资金费率

组合方向为 **空布伦特、多 WTI**。正值表示组合收到资金费，负值表示支付。`metaAndAssetCtxs.funding` 是当前预计的**每小时小数率**，已包含 XYZ funding multiplier；不能再乘倍率或除以 8。资金费现金流使用 `oraclePx`，不是 `markPx`。

记布伦特、WTI 的预言机价为 `PB/PW`，小时费率为 `fB/fW`：

| 配仓 | 预计每小时现金流 | 净小时率（分母为两腿总预言机名义） |
| --- | --- | --- |
| 等桶数：空 1 桶 B、多 1 桶 W | `PB*fB - PW*fW` | `(PB*fB - PW*fW)/(PB+PW)` |
| 等预言机美元名义：每腿 N 美元 | `N*(fB-fW)` | `(fB-fW)/2` |

每 10,000 美元总名义的小时现金流为 `净小时率 * 10000`；简单年化为 `净小时率 * 24 * 365`。两者都不是保证金收益率、已结算金额或历史回报；实际资金费以整点结算费率与当时预言机价为准。

官方依据：[Hyperliquid 资金费](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)、[XYZ 资金费倍率](https://docs.trade.xyz/perp-mechanics/funding)、[永续合约 API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)。

## 刷新备用快照与发布

```powershell
node scripts/refresh-snapshot.mjs
node scripts/refresh-funding-snapshot.mjs
node --test
```

脚本在所有请求和校验成功后原子替换备用快照。`.openai/hosting.json` 将 `dist` 声明为静态发布目录，源代码和快照一同提交、推送后发布。

数据测试覆盖资金费符号、oracle 与 mark 区分、单腿与总敞口分母、小时倍率、真实样本数值、合约映射、未收盘排除、缺失日期、月边界及接口错误。没有执行浏览器视觉/点击测试。

可选 WebMCP 接口 `set_oil_chart_view` 使用相同页面状态。普通浏览器无需 WebMCP；真实浏览器注册尚未验证。
