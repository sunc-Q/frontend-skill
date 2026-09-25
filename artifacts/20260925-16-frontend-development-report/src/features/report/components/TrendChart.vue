<script setup lang="ts">
import { computed, ref } from 'vue';
import { int, shortDate } from '../helpers/format';
import type { DailyPoint } from '../types';

interface Props {
  days: DailyPoint[];
}

const props = defineProps<Props>();

const W = 720;
const H = 220;
const PAD = { t: 14, r: 8, b: 26, l: 8 };
const hover = ref<number | null>(null);

const geometry = computed(() => {
  const days = props.days;
  const n = days.length;
  const max = days.reduce((acc: number, d: DailyPoint) => Math.max(acc, d.pv), 1);
  const step = n > 1 ? (W - PAD.l - PAD.r) / (n - 1) : 0;
  const base = H - PAD.b;
  const yOf = (v: number): number => base - (v / max) * (base - PAD.t);
  const xOf = (i: number): number => PAD.l + i * step;
  const seriesOf = (pick: (d: DailyPoint) => number): string =>
    days.map((d: DailyPoint, i: number) => `${xOf(i).toFixed(1)},${yOf(pick(d)).toFixed(1)}`).join(' ');
  const pvPts = days.map((d: DailyPoint, i: number): [number, number] => [xOf(i), yOf(d.pv)]);
  const pvArea = pvPts.length
    ? `M${xOf(0).toFixed(1)},${base} ` +
      pvPts.map((p: [number, number]) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') +
      ` L${xOf(n - 1).toFixed(1)},${base} Z`
    : '';
  return {
    n,
    max,
    step,
    pvLine: seriesOf((d: DailyPoint): number => d.pv),
    uvLine: seriesOf((d: DailyPoint): number => d.uv),
    workLine: seriesOf((d: DailyPoint): number => d.work),
    pvArea,
    ticks: [0, 0.5, 1].map((r: number) => ({ y: base - r * (base - PAD.t), label: int(max * r) })),
    xTicks: [0, Math.floor((n - 1) / 2), n - 1].map((i: number) => ({
      x: xOf(i),
      label: days[i] ? shortDate(days[i].date) : '',
    })),
  };
});

const readout = computed(() => {
  const i = hover.value;
  if (i === null || !props.days.length) return null;
  const d = props.days[i];
  if (!d) return null;
  const p = geometry.value;
  return {
    x: p.step * i + PAD.l,
    date: d.date,
    pv: int(d.pv),
    uv: int(d.uv),
    work: int(d.work),
    ratio: (d.pv / (d.work || 1)).toFixed(1),
  };
});

function onMove(event: MouseEvent): void {
  const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  const rel = (event.clientX - box.left) / (box.width || 1);
  const i = Math.round(rel * (geometry.value.n - 1));
  hover.value = Math.min(geometry.value.n - 1, Math.max(0, i));
}
</script>

<template>
  <section class="rp-sec" aria-labelledby="rp-trend-h">
    <div class="rp-sec__head">
      <h2 id="rp-trend-h">每日趋势</h2>
      <p class="rp-sec__note">
        峰值 {{ int(geometry.max) }} 次/日 · 共 {{ days.length }} 天。悬停查看单日明细。
      </p>
    </div>
    <div class="rp-chart">
      <svg
        class="rp-chart__svg"
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        aria-label="每日浏览量趋势图"
        @mousemove="onMove"
        @mouseleave="hover = null"
      >
        <defs>
          <linearGradient id="rp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="rp-grad-a" />
            <stop offset="100%" class="rp-grad-b" />
          </linearGradient>
        </defs>
        <g class="rp-chart__grid">
          <line
            v-for="t in geometry.ticks"
            :key="t.label"
            :x1="PAD.l"
            :x2="W - PAD.r"
            :y1="t.y"
            :y2="t.y"
          />
        </g>
        <path v-if="geometry.pvArea" :d="geometry.pvArea" class="rp-chart__area" />
        <polyline :points="geometry.pvLine" class="rp-chart__pv" />
        <polyline :points="geometry.uvLine" class="rp-chart__uv" />
        <polyline :points="geometry.workLine" class="rp-chart__work" />
        <g class="rp-chart__axis">
          <text v-for="t in geometry.xTicks" :key="t.label" :x="t.x" :y="H - 8" text-anchor="middle">
            {{ t.label }}
          </text>
          <text v-for="t in geometry.ticks" :key="t.y" :x="W - PAD.r" :y="t.y - 4" text-anchor="end">
            {{ t.label }}
          </text>
        </g>
        <line
          v-if="readout"
          class="rp-chart__cursor"
          :x1="readout.x"
          :x2="readout.x"
          :y1="PAD.t"
          :y2="H - PAD.b"
        />
      </svg>
      <div v-if="readout" class="rp-chart__readout" :style="{ left: `${(readout.x / W) * 100}%` }">
        <strong>{{ readout.date }}</strong>
        <span>PV {{ readout.pv }}</span>
        <span>UV {{ readout.uv }}</span>
        <span>作品 {{ readout.work }}</span>
      </div>
      <ul class="rp-chart__legend">
        <li class="rp-lg rp-lg--pv">浏览量 PV</li>
        <li class="rp-lg rp-lg--uv">访客 UV</li>
        <li class="rp-lg rp-lg--work">作品页浏览</li>
      </ul>
    </div>
  </section>
</template>
