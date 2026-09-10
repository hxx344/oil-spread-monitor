# 原油价差观察 · 2026

简体中文原油分析前端，采用原生 HTML、CSS 和 JavaScript，无运行时依赖。静态入口为 `dist/index.html`。

支持布伦特减 WTI 价差与两种价格切换、今年以来/近三月/近一月筛选、鼠标和触摸查看逐日数据、键盘图表游标、区间均值与极值、月度平均值以及日度数据表。

## 本地运行

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

访问 `http://127.0.0.1:4173/`。需要通过 HTTP 服务访问，不能直接双击 HTML，因为行情快照通过 `fetch` 加载。

## 数据口径

- 来源：[美国 EIA 日度现货历史数据](https://www.eia.gov/dnav/pet/xls/PET_PRI_SPT_S1_D.xls)，并与 [FRED WTI](https://fred.stlouisfed.org/series/DCOILWTICO) 和 [FRED Brent](https://fred.stlouisfed.org/series/DCOILBRENTEU) 最新值交叉核实。
- WTI 为库欣、布伦特为欧洲 Brent，均为日度 FOB 现货美元/桶；不是期货结算价。
- 快照核验于 2026-09-10，实际共同报价为 2026-01-02 至 2026-09-01，共 164 日。静态快照不会自动更新。
- 原始 171 条日期记录保存在 `dist/data/oil-prices-2026.json`。缺失项保留 `null`，只对同日两项均有效的记录相减，不插值、不前向填充。图线在单边缺失日期断开；周末不增加观测值。
- 所有范围以最后一个共同有效报价日为终点。顶部最新指标与年内变化保持全年口径；图表、区间速览、月度均值和明细跟随所选范围。
- 月均值为有效日度价差的算术平均，首尾月份可为不完整月份；年内变化为最新价差减首个有效日价差。
- 需更新时，从 EIA 工作簿的 `Data 1` 工作表读取日期、WTI、Brent 三列，保留 2026 年原始记录和缺失值，替换快照并更新 `metadata` 的核验时间、发布日、最后共同日期、计数与原始文件 SHA-256，然后重新核对并发布。测试中的固定快照基准值也应与新来源同步。

## 验证

```powershell
node --test
node --check dist/app.mjs
node --check dist/data-utils.mjs
```

数据测试覆盖真实源值、缺失记录、正负价差、极值、月度加权一致性、日历月边界和无效数据拒绝。未执行浏览器视觉/点击测试。

页面在支持 `document.modelContext` 的浏览器中可选注册 `set_oil_chart_view`，使用同一图表状态；普通浏览器无需此接口。当前环境未提供可调用的 WebMCP 验证上下文，因此未验证该可选接口的浏览器端注册。

## 发布

`.openai/hosting.json` 将 `dist` 声明为静态发布目录。源代码与快照一同提交至该 Site 的源仓库；发布无需打包应用依赖。外部字体无法加载时使用系统字体，不影响行情数据与图表功能。
