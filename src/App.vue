<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import * as echarts from "echarts";
import { ElMessage } from "element-plus";

dayjs.locale("zh-cn");

const model = ref({
  symbol: "600519",
  buyDate: "2020-01-02",
  quantity: 100
});

const detected = ref({ kind: "unknown", market: "", text: "待识别" });
const instrumentName = ref("请输入代码");
const loading = ref(false);
const resolvingName = ref(false);
const status = ref("填写参数后点击“开始回放”，即可查看走势与分享摘要。");
const animPrice = ref("--");
const shareMode = ref("text");
const fullSeries = ref([]);
const hasPlaybackStarted = ref(false);

const summaryText = ref("");
const summaryLoading = ref(false);
const summaryStatus = ref("回放完成后，将自动生成暴躁老哥风格的持仓复盘文案。");

const result = ref({
  effectiveBuyDate: "--",
  endDate: "--",
  buyPrice: 0,
  endPrice: 0,
  startValue: 0,
  endValue: 0,
  profit: 0,
  returnRate: 0,
  adjusted: false
});

const chartEl = ref(null);
let chart = null;
let timer = null;
let nameTimer = null;

const displaySymbol = computed(() => model.value.symbol.trim().toUpperCase() || "--");
const isPositive = computed(() => result.value.returnRate >= 0);
const targetEndDate = computed(() => dayjs().subtract(1, "day").format("YYYY-MM-DD"));
const readyToShare = computed(() => result.value.endDate !== "--");
const summaryCards = computed(() => [
  { label: "持仓数量", value: `${money(model.value.quantity)} 份/股`, hint: "用于计算成本与市值" },
  { label: "买入成本", value: money(result.value.startValue), hint: result.value.buyPrice ? `买入净值 ${money(result.value.buyPrice)}` : "等待回放" },
  { label: "当前市值", value: money(result.value.endValue), hint: result.value.endPrice ? `最新净值 ${money(result.value.endPrice)}` : "等待回放" },
  { label: "累计盈亏", value: signedMoney(result.value.profit), hint: result.value.endDate === "--" ? "等待回放" : "按持仓数量自动计算", tone: result.value.profit >= 0 ? "up" : "down" },
  { label: "累计收益率", value: result.value.endDate === "--" ? "--" : pct(result.value.returnRate), hint: isPositive.value ? "当前为正收益" : "当前为负收益", tone: isPositive.value ? "up" : "down" }
]);
const shareText = computed(() => (summaryText.value || buildFallbackShareText()).trim());

onMounted(async () => {
  await resolveInstrument();
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  clearTimer();
  if (nameTimer) {
    window.clearTimeout(nameTimer);
    nameTimer = null;
  }
  window.removeEventListener("resize", onResize);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

watch(
  () => model.value.symbol,
  () => {
    if (nameTimer) window.clearTimeout(nameTimer);
    nameTimer = window.setTimeout(() => resolveInstrument(), 260);
  }
);

function onResize() {
  if (chart) chart.resize();
}

function clearTimer() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
}

async function waitForChartElement(timeoutMs = 2000) {
  const start = Date.now();
  while (!chartEl.value && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }
}

async function ensureChartReady() {
  await waitForChartElement();
  if (chart || !chartEl.value) return;
  chart = echarts.init(chartEl.value);
  drawEmptyChart();
}

async function onSceneAfterEnter() {
  if (!hasPlaybackStarted.value) return;
  await ensureChartReady();
  if (!chart) return;
  chart.resize();
  if (fullSeries.value.length) {
    renderSeries(fullSeries.value, false);
  } else {
    drawEmptyChart();
  }
}

function detectCandidates(symbolRaw) {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return [];
  if (/^(SH|SZ)\d{6}$/.test(symbol)) return [{ kind: "stock", market: "A", symbol }];
  if (/^\d{5}$/.test(symbol)) return [{ kind: "stock", market: "HK", symbol }, { kind: "fund", market: "FUND", symbol }];
  if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return [{ kind: "stock", market: "US", symbol }];
  if (/^\d{6}$/.test(symbol)) return [{ kind: "stock", market: "A", symbol }, { kind: "fund", market: "FUND", symbol }];
  return [{ kind: "fund", market: "FUND", symbol }];
}

function marketText(kind, market) {
  if (kind === "fund") return "基金";
  if (market === "A") return "A 股";
  if (market === "HK") return "港股";
  if (market === "US") return "美股";
  return "待识别";
}

async function resolveInstrument() {
  const symbol = displaySymbol.value;
  if (symbol === "--") {
    instrumentName.value = "请输入代码";
    detected.value = { kind: "unknown", market: "", text: "待识别" };
    return null;
  }

  resolvingName.value = true;
  try {
    for (const candidate of detectCandidates(symbol)) {
      try {
        if (candidate.kind === "stock") {
          const name = await fetchStockName(candidate.market, candidate.symbol);
          instrumentName.value = name;
          detected.value = { kind: "stock", market: candidate.market, text: marketText("stock", candidate.market) };
          return candidate;
        }

        const name = await fetchFundName(candidate.symbol);
        instrumentName.value = name;
        detected.value = { kind: "fund", market: "FUND", text: "基金" };
        return candidate;
      } catch {
        continue;
      }
    }

    instrumentName.value = "无法识别该标的";
    detected.value = { kind: "unknown", market: "", text: "待识别" };
    return null;
  } finally {
    resolvingName.value = false;
  }
}

async function run() {
  hasPlaybackStarted.value = true;
  try {
    loading.value = true;
    clearTimer();
    validateInput();

    await nextTick();
    await ensureChartReady();
    drawEmptyChart();
    summaryText.value = "";
    summaryStatus.value = "正在计算回放数据...";

    const matched = await resolveInstrument();
    if (!matched) throw new Error("未能识别代码对应市场，请检查输入。");

    status.value = `正在拉取 ${model.value.buyDate} 到 ${targetEndDate.value} 的历史行情...`;
    const series =
      matched.kind === "fund"
        ? await fetchFundSeries(matched.symbol, model.value.buyDate, targetEndDate.value)
        : await fetchStockSeries(matched.market, matched.symbol, model.value.buyDate, targetEndDate.value);

    if (!series.length) throw new Error("没有可用于回放的历史数据。");
    fullSeries.value = series;

    const firstDate = series[0].date;
    const effectiveBuyDate = model.value.buyDate < firstDate ? firstDate : model.value.buyDate;
    const buyPoint = series.find((item) => item.date >= effectiveBuyDate) || series[0];
    const endPoint = series[series.length - 1];
    const quantity = Number(model.value.quantity);
    const startValue = quantity * buyPoint.price;
    const endValue = quantity * endPoint.price;

    result.value = {
      effectiveBuyDate,
      endDate: endPoint.date,
      buyPrice: buyPoint.price,
      endPrice: endPoint.price,
      startValue,
      endValue,
      profit: endValue - startValue,
      returnRate: startValue <= 0 ? 0 : (endValue - startValue) / startValue,
      adjusted: effectiveBuyDate !== model.value.buyDate
    };

    await playAnimation();
    await generateShareSummary();
    status.value = result.value.adjusted
      ? `已自动从 ${effectiveBuyDate} 作为可用起始日进行回放。`
      : `回放完成，数据更新到 ${endPoint.date}。`;
  } catch (error) {
    status.value = `计算失败：${error.message}`;
    summaryStatus.value = "本次回放未完成，暂时无法生成摘要。";
  } finally {
    loading.value = false;
  }
}

function validateInput() {
  if (!model.value.symbol.trim()) throw new Error("请输入股票代码。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(model.value.buyDate)) throw new Error("买入日期格式应为 YYYY-MM-DD。");
  if (!Number.isFinite(Number(model.value.quantity)) || Number(model.value.quantity) <= 0) throw new Error("持仓数量必须大于 0。");
}

function getChartOption({ dates = [], prices = [], color = "#f97316", areaColor = "rgba(249,115,22,0.16)", animated = false } = {}) {
  return {
    backgroundColor: "transparent",
    animation: animated,
    animationDuration: 220,
    animationDurationUpdate: 220,
    animationEasing: "cubicOut",
    grid: { left: 18, right: 18, top: 22, bottom: 18, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10, 15, 27, 0.94)",
      borderColor: "rgba(255,255,255,0.08)",
      textStyle: { color: "#f8fafc" },
      valueFormatter: (value) => money(value)
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.28)" } },
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", margin: 12 }
    },
    yAxis: {
      type: "value",
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", formatter: (value) => money(value) },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } }
    },
    series: [
      {
        name: "净值",
        type: "line",
        smooth: true,
        symbol: "none",
        data: prices,
        lineStyle: { width: 3, color },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: areaColor },
            { offset: 1, color: "rgba(255,255,255,0)" }
          ])
        }
      }
    ]
  };
}

function drawEmptyChart() {
  if (!chart) return;
  chart.setOption(
    getChartOption({
      dates: [],
      prices: [],
      color: "#94a3b8",
      areaColor: "rgba(148,163,184,0.12)"
    })
  );
}

function renderSeries(rows, animated) {
  if (!chart || !rows.length) return;
  const color = result.value.returnRate >= 0 ? "#22c55e" : "#ef4444";
  const areaColor = result.value.returnRate >= 0 ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.16)";
  const last = rows[rows.length - 1];
  animPrice.value = `${last.date} · ${money(last.price)}`;
  chart.setOption(
    getChartOption({
      dates: rows.map((item) => item.date),
      prices: rows.map((item) => item.price),
      color,
      areaColor,
      animated
    })
  );
}

async function playAnimation() {
  return new Promise((resolve) => {
    const rows = fullSeries.value;
    clearTimer();

    let index = 1;
    const render = (count) => renderSeries(rows.slice(0, count), true);

    render(1);
    timer = window.setInterval(() => {
      if (index >= rows.length) {
        render(rows.length);
        clearTimer();
        resolve();
        return;
      }
      render(index);
      index += 1;
    }, 130);
  });
}

async function generateShareSummary() {
  if (!readyToShare.value) return;
  summaryLoading.value = true;
  summaryStatus.value = "正在用暴躁老哥语气生成复盘摘要...";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "你是投资复盘吐槽助手，语气像暴躁老哥：直白、犀利、带点火气，但不低俗不辱骂。" },
          { role: "user", content: buildSummaryPrompt() }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `请求失败（${response.status}）`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("模型返回为空");

    summaryText.value = content;
    summaryStatus.value = "摘要已由 AI 生成（暴躁老哥风格）。";
  } catch (error) {
    summaryText.value = buildFallbackShareText();
    summaryStatus.value = `模型调用失败，已回退本地摘要：${error.message}`;
  } finally {
    summaryLoading.value = false;
  }
}

function buildSummaryPrompt() {
  return [
    `标的：${instrumentName.value}（${detected.value.text} ${displaySymbol.value}）`,
    `回放区间：${result.value.effectiveBuyDate} 至 ${result.value.endDate}`,
    `持仓数量：${money(model.value.quantity)} 份/股`,
    `买入净值：${money(result.value.buyPrice)}`,
    `最新净值：${money(result.value.endPrice)}`,
    `买入成本：${money(result.value.startValue)}`,
    `当前市值：${money(result.value.endValue)}`,
    `累计盈亏：${signedMoney(result.value.profit)}`,
    `累计收益率：${pct(result.value.returnRate)}`,
    "语气要求：暴躁老哥，短句、狠一点、但信息要准确。",
    "输出要求：",
    "1. 3-5 行中文",
    "2. 第一行给收益结论",
    "3. 第二行写波动或风险感受",
    "4. 第三行给后续观察点（非投资建议）"
  ].join("\n");
}

function buildFallbackShareText() {
  return [
    `兄弟你这仓位我看完都拍桌子了：${detected.value.text} ${displaySymbol.value} ${instrumentName.value}`,
    `回放区间：${result.value.effectiveBuyDate} 至 ${result.value.endDate}`,
    `买入成本 ${money(result.value.startValue)}，当前市值 ${money(result.value.endValue)}。`,
    `累计盈亏 ${signedMoney(result.value.profit)}，累计收益率 ${pct(result.value.returnRate)}。`,
    "接下来盯住波动和量能节奏，仓位计划先写清楚再行动。"
  ].join("\n");
}

function proxyUrl(target) {
  return `/api/proxy?url=${encodeURIComponent(target)}`;
}

function toTencentCode(market, symbol) {
  if (market === "HK") return `hk${symbol.padStart(5, "0")}`;
  if (market === "A") {
    if (/^SH/i.test(symbol)) return `sh${symbol.slice(2)}`;
    if (/^SZ/i.test(symbol)) return `sz${symbol.slice(2)}`;
    return `${["5", "6", "9"].includes(symbol[0]) ? "sh" : "sz"}${symbol}`;
  }
  if (market === "US") return `us${symbol}`;
  throw new Error(`暂不支持的市场类型：${market}`);
}

async function fetchStockName(market, symbol) {
  const code = toTencentCode(market, symbol);
  const res = await fetch(proxyUrl(`https://qt.gtimg.cn/q=${code}`));
  if (!res.ok) throw new Error(`请求失败，状态码 ${res.status}`);
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  const fields = text.split("~");
  const name = fields[1];
  if (!name) throw new Error("stock name missing");
  return name;
}

async function fetchFundName(symbol) {
  const json = await fetchJson(proxyUrl(`https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(symbol)}`));
  const first = Array.isArray(json?.Datas) ? json.Datas[0] : null;
  const name = first?.NAME || first?.FundBaseInfo?.SHORTNAME;
  if (!name) throw new Error("fund name missing");
  return name;
}

async function fetchStockSeries(market, symbol, startDate, endDateValue) {
  const code = toTencentCode(market, symbol);
  const json = await fetchJson(proxyUrl(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,${startDate},${endDateValue},2000,qfq`));
  const entry = json?.data?.[code];
  if (!entry) throw new Error("股票历史数据返回为空。");
  const days = entry.day || entry.qfqday || [];
  if (!days.length) throw new Error("股票历史数据返回为空。");
  return days
    .map((item) => ({ date: item[0], price: Number(item[2]) }))
    .filter((item) => item.date && Number.isFinite(item.price));
}

async function fetchFundSeries(symbol, startDate, endDateValue) {
  const rows = [];
  const pageSize = 200;
  let page = 1;
  let total = 1;

  while ((page - 1) * pageSize < total) {
    const json = await fetchJson(proxyUrl(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(symbol)}&pageIndex=${page}&pageSize=${pageSize}&startDate=${startDate}&endDate=${endDateValue}`), { Referer: "https://fundf10.eastmoney.com/" });
    if (!json || Number(json.ErrCode) !== 0 || !json.Data) throw new Error("基金历史数据请求失败。");

    total = Number(json.TotalCount || 0);
    const list = Array.isArray(json.Data.LSJZList) ? json.Data.LSJZList : [];
    for (const item of list) {
      const date = String(item.FSRQ || "");
      const price = Number(item.DWJZ);
      if (date && Number.isFinite(price)) rows.push({ date, price });
    }
    if (!list.length) break;
    page += 1;
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: extraHeaders });
  if (!res.ok) throw new Error(`请求失败，状态码 ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (data && typeof data.contents === "string") {
    try {
      return JSON.parse(data.contents);
    } catch {
      return data;
    }
  }
  return data;
}

function createShareCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 760;
  const ctx = canvas.getContext("2d");
  const accent = isPositive.value ? "#22c55e" : "#ef4444";

  ctx.fillStyle = "#091323";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "rgba(249,115,22,0.20)");
  gradient.addColorStop(1, "rgba(8,15,29,0.06)");
  ctx.fillStyle = gradient;
  ctx.fillRect(34, 34, canvas.width - 68, canvas.height - 68);

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);

  ctx.fillStyle = "#98a8c3";
  ctx.font = "500 24px 'Segoe UI', 'Microsoft YaHei'";
  ctx.fillText("投资回放分享摘要 · 暴躁老哥", 72, 96);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 48px 'Segoe UI', 'Microsoft YaHei'";
  ctx.fillText(instrumentName.value, 72, 164);

  ctx.fillStyle = "#d3deee";
  ctx.font = "400 24px 'Segoe UI', 'Microsoft YaHei'";
  ctx.fillText(`${detected.value.text} · ${displaySymbol.value}`, 72, 204);
  ctx.fillText(`${result.value.effectiveBuyDate} 至 ${result.value.endDate}`, 72, 238);

  ctx.fillStyle = accent;
  ctx.font = "700 96px 'Segoe UI', 'Microsoft YaHei'";
  ctx.fillText(pct(result.value.returnRate), 72, 372);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "500 30px 'Segoe UI', 'Microsoft YaHei'";
  ctx.fillText(`累计盈亏 ${signedMoney(result.value.profit)}`, 76, 430);

  const summaryLines = shareText.value.split(/\n+/).slice(0, 3);
  ctx.fillStyle = "#b8c6db";
  ctx.font = "400 24px 'Segoe UI', 'Microsoft YaHei'";
  summaryLines.forEach((line, index) => {
    ctx.fillText(line, 72, 500 + index * 38);
  });

  return canvas;
}

async function share() {
  if (!readyToShare.value) {
    ElMessage.warning("请先完成一次回放计算。");
    return;
  }

  if (shareMode.value === "text") {
    try {
      await navigator.clipboard.writeText(shareText.value);
      ElMessage.success("摘要已复制到剪贴板。");
    } catch {
      ElMessage.error("复制失败，请检查浏览器权限。");
    }
    return;
  }

  const canvas = createShareCanvas();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    ElMessage.error("图片生成失败。");
    return;
  }

  const file = new File([blob], `share_${displaySymbol.value}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title: "投资回放摘要", text: shareText.value, files: [file] });
      return;
    } catch {
      // User canceled.
    }
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `share_${displaySymbol.value}_${dayjs().format("YYYYMMDD_HHmmss")}.png`;
  link.click();
  URL.revokeObjectURL(link.href);
  ElMessage.success("图片已导出。");
}

function money(n) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(n || 0));
}

function signedMoney(n) {
  const value = Number(n || 0);
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${money(value)}`;
}

function pct(v) {
  return `${(Number(v) * 100).toFixed(2)}%`;
}
</script>

<template>
  <main class="page-shell">
    <Transition name="scene-switch" mode="out-in" @after-enter="onSceneAfterEnter">
      <section v-if="!hasPlaybackStarted" key="intro" class="intro-panel">
        <div class="intro-copy">
          <span class="eyebrow">Portfolio Playback</span>
          <h1>让每一笔买入，都能被重新复盘。</h1>
          <p>输入股票代码、买入日期和持仓数量，点击回放后查看走势与 AI 分享摘要。</p>
        </div>

        <div class="intro-form-wrap">
          <div class="identity-card">
            <span>已识别标的</span>
            <el-skeleton :loading="resolvingName" animated :rows="1">
              <template #template>
                <el-skeleton-item variant="text" class="identity-skeleton" />
              </template>
              <template #default>
                <strong>{{ instrumentName }}</strong>
                <small>{{ detected.text }} · {{ displaySymbol }}</small>
              </template>
            </el-skeleton>
          </div>

          <el-form class="control-grid" label-position="top">
            <el-form-item label="股票代码">
              <el-input v-model="model.symbol" size="large" placeholder="600519 / 00700 / AAPL / 161725" />
            </el-form-item>
            <el-form-item label="买入日期">
              <el-date-picker v-model="model.buyDate" size="large" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="持仓数量">
              <el-input-number v-model="model.quantity" size="large" :min="0.0001" :step="1" />
            </el-form-item>
          </el-form>

          <div class="intro-actions">
            <el-button class="run-button" type="primary" size="large" :loading="loading" @click="run">开始回放</el-button>
          </div>
        </div>
      </section>

      <section v-else key="replay" class="replay-shell">
        <section class="replay-toolbar">
          <el-form class="replay-grid" label-position="top">
            <el-form-item label="股票代码">
              <el-input v-model="model.symbol" size="large" />
            </el-form-item>
            <el-form-item label="买入日期">
              <el-date-picker v-model="model.buyDate" size="large" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="持仓数量">
              <el-input-number v-model="model.quantity" size="large" :min="0.0001" :step="1" />
            </el-form-item>
            <el-button class="run-button replay-run" type="primary" size="large" :loading="loading" @click="run">重新回放</el-button>
          </el-form>
        </section>

        <section class="summary-grid">
          <article v-for="card in summaryCards" :key="card.label" class="summary-card">
            <span>{{ card.label }}</span>
            <strong :class="card.tone">{{ card.value }}</strong>
            <small>{{ card.hint }}</small>
          </article>
        </section>

        <el-alert
          v-if="result.adjusted"
          type="warning"
          show-icon
          :closable="false"
          title="买入日期早于可用历史行情，系统已自动对齐到首个有效交易日。"
          class="info-alert"
        />

        <section class="chart-panel">
          <div class="chart-panel-header">
            <div>
              <span class="panel-kicker">走势回放</span>
              <h2>{{ instrumentName }}</h2>
              <p>{{ status }}</p>
            </div>
            <div class="chart-badge">
              <span>最新节点</span>
              <strong>{{ animPrice }}</strong>
            </div>
          </div>
          <div ref="chartEl" class="chart-canvas"></div>
        </section>

        <section class="share-panel">
          <div class="share-copy">
            <div class="share-title-row">
              <div>
                <span class="panel-kicker">分享摘要</span>
                <h2>AI锐评</h2>
              </div>
              <el-button plain class="refresh-button" :loading="summaryLoading" @click="generateShareSummary">重新生成</el-button>
            </div>

            <div class="summary-text-box">
              <p v-if="summaryLoading">正在调用模型生成摘要，请稍候...</p>
              <p v-else>{{ shareText }}</p>
            </div>
            <small class="summary-status">{{ summaryStatus }}</small>
          </div>

          <div class="share-actions">
            <el-segmented
              v-model="shareMode"
              :options="[
                { label: '复制文本', value: 'text' },
                { label: '导出图片', value: 'image' }
              ]"
            />
            <el-button type="primary" plain class="share-button" @click="share">
              {{ shareMode === "image" ? "导出分享图" : "复制摘要文本" }}
            </el-button>
          </div>
        </section>
      </section>
    </Transition>
  </main>
</template>
