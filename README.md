# 原油价差观察 · 2026

Hyperliquid / XYZ 原油永续合约看板，原生 HTML、CSS、JavaScript，无构建依赖。入口为 `dist/index.html`。

支持布伦特减 WTI 价差、两个合约的价格、年内/近三月/近一月筛选、鼠标/触摸/键盘查看日 K、月度均值、日度数据表及**做空价差的资金费率**。

## 本地运行与验证

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory dist
node --test
node --check dist/app.mjs
node --check dist/hyperliquid.mjs
```

访问 `http://127.0.0.1:4173/`。通过 HTTP 提供静态文件，不能直接双击 HTML。

## 数据来源与价格口径

- 用户提供的 [BRENTOIL](https://app.hyperliquid.xyz/trade/xyz:BRENTOIL) 对应 API `xyz:BRENTOIL`；[WTIOIL](https://app.hyperliquid.xyz/trade/xyz:WTIOIL) 的 API 名称为 `xyz:CL`。映射及每单位 1 桶见 [XYZ 官方商品目录](https://docs.trade.xyz/asset-directory/commodities)。不要对不存在的 `xyz:WTIOIL` 发 API 请求。
- 公共接口为 `POST https://api.hyperliquid.xyz/info`。无需钱包、API 密钥、用户地址或交易权限。
- 历史使用 `candleSnapshot` 的 `1d` 成交日 K 收盘 `c`；只保留 UTC 已收盘日 K，并按时间戳配对。当前未收盘日 K 不进入历史统计。请求范围从 2026-01-01 开始，实际共同数据自 **2026-03-04** 起；不使用 EIA 或其他数据回填之前的日期。
- 顶部当前价格采用 `metaAndAssetCtxs` (`dex: xyz`) 的 `markPx`，按 `meta.universe[].name` 查找上下文，不能硬编码数组位置。第四个指标为完整共同历史区间首尾收盘价差变化。
- 当前行情每 60 秒更新，历史每 5 分钟更新；页面隐藏时暂停请求。手动刷新会重取历史和当前行情。
- `dist/data/hyperliquid-2026.json` 是带采集时间的备用快照。启动先显示快照再尝试更新；更新失败保留最近有效数据，并明确显示失败状态及旧采集时间，不伪装为实时数据。
- 图表的最近 1/3 月窗口以最后一个共同已收盘日为终点。缺失自然日断线；月度平均仅按所选区间内实际有效日计算。

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
node --test
```

脚本在所有请求和校验成功后原子替换备用快照。`.openai/hosting.json` 将 `dist` 声明为静态发布目录，源代码和快照一同提交、推送后发布。

数据测试覆盖资金费符号、oracle 与 mark 区分、单腿与总敞口分母、小时倍率、真实样本数值、合约映射、未收盘排除、缺失日期、月边界及接口错误。没有执行浏览器视觉/点击测试。

可选 WebMCP 接口 `set_oil_chart_view` 使用相同页面状态。普通浏览器无需 WebMCP；真实浏览器注册尚未验证。
