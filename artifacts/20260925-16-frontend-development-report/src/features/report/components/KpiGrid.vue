<script setup lang="ts">
import { computed } from 'vue';
import { delta as diffOf, kpiValue, signedPercent } from '../helpers/format';
import type { Kpi } from '../types';

interface Props {
  items: Kpi[];
  compareLabel: string;
}

const props = defineProps<Props>();

interface Card extends Kpi {
  display: string;
  diff: number | null;
  diffText: string;
  up: boolean;
  good: boolean;
  path: string;
  area: string;
}

const W = 100;
const H = 30;

function toPoints(values: number[]): Array<[number, number]> {
  if (!values.length) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  return values.map((v: number, i: number): [number, number] => [
    i * step,
    H - ((v - min) / span) * (H - 4) - 2,
  ]);
}

const cards = computed<Card[]>(() =>
  props.items.map((item: Kpi): Card => {
    const diff = diffOf(item.value, item.prev);
    const pts = toPoints(item.spark);
    const line = pts.map(([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return {
      ...item,
      display: kpiValue(item.value, item.unit),
      diff,
      diffText: diff === null ? '无上期数据' : signedPercent(diff),
      up: diff !== null && diff > 0,
      good: diff === null ? true : item.goodWhenUp ? diff > 0 : diff < 0,
      path: line,
      area: last ? `0,${H} ${line} ${W},${H}` : '',
    };
  }),
);
</script>

<template>
  <section class="rp-sec" aria-labelledby="rp-kpi-h">
    <div class="rp-sec__head">
      <h2 id="rp-kpi-h">核心指标</h2>
      <p class="rp-sec__note">涨跌均与上一等长区间（{{ compareLabel }}）比较；跳出率越低越好。</p>
    </div>
    <div class="rp-kpis">
      <article v-for="c in cards" :key="c.key" class="rp-kpi" :data-key="c.key">
        <p class="rp-kpi__label">{{ c.label }}</p>
        <p class="rp-kpi__value">{{ c.display }}</p>
        <p class="rp-kpi__delta" :class="c.diff === null ? 'is-flat' : c.good ? 'is-good' : 'is-bad'">
          <span aria-hidden="true">{{ c.diff === null ? '·' : c.up ? '▲' : '▼' }}</span>
          {{ c.diffText }}
        </p>
        <svg class="rp-kpi__spark" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="c.area" class="rp-kpi__spark-area" />
          <polyline :points="c.path" class="rp-kpi__spark-line" />
        </svg>
        <p class="rp-kpi__note">{{ c.note }}</p>
      </article>
    </div>
  </section>
</template>
