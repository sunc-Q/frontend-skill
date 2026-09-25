<script setup lang="ts">
import { computed } from 'vue';
import { int, percent, signedPercent } from '../helpers/format';
import type { ChannelRow, ChannelSort, SortKey } from '../types';

interface Props {
  rows: ChannelRow[];
  sort: ChannelSort;
  totalVisitors: number;
  totals: { visitors: number; bounce: number; conversion: number };
}

const props = defineProps<Props>();
const emit = defineEmits<{ sort: [key: SortKey] }>();

const cols: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'name', label: '渠道', align: 'left' },
  { key: 'visitors', label: '访客', align: 'right' },
  { key: 'pv', label: '浏览量', align: 'right' },
  { key: 'bounce', label: '跳出率', align: 'right' },
  { key: 'conversion', label: '咨询转化', align: 'right' },
];

const shaped = computed(() =>
  props.rows.map((r: ChannelRow) => {
    const share = props.totalVisitors ? r.visitors / props.totalVisitors : 0;
    const d = r.prevVisitors ? r.visitors / r.prevVisitors - 1 : null;
    return {
      ...r,
      share,
      shareText: percent(share, 1),
      growth: d,
      growthText: d === null ? '—' : signedPercent(d),
      growthGood: d === null ? true : d > 0,
    };
  }),
);

function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
  if (props.sort.key !== key) return 'none';
  return props.sort.dir === 'asc' ? 'ascending' : 'descending';
}
</script>

<template>
  <section class="rp-sec" aria-labelledby="rp-ch-h">
    <div class="rp-sec__head">
      <h2 id="rp-ch-h">流量来源质量</h2>
      <p class="rp-sec__note">
        合计 {{ int(totals.visitors) }} 位访客，加权跳出率 {{ percent(totals.bounce) }}，加权咨询转化
        {{ percent(totals.conversion, 2) }}。点击表头排序。
      </p>
    </div>
    <div class="rp-tablewrap">
      <table class="rp-table">
        <caption class="rp-sr-only">按渠道拆分的访客、浏览量、跳出率与转化</caption>
        <thead>
          <tr>
            <th
              v-for="c in cols"
              :key="c.key"
              scope="col"
              :aria-sort="ariaSort(c.key)"
              :class="`is-${c.align}`"
            >
              <button type="button" class="rp-th" @click="emit('sort', c.key)">
                {{ c.label }}
                <span aria-hidden="true" class="rp-th__arrow">{{
                  sort.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'
                }}</span>
              </button>
            </th>
            <th scope="col" class="is-right">占比</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in shaped" :key="r.key">
            <td class="rp-td-name">
              <span class="rp-dot" :data-ch="r.key" aria-hidden="true"></span>{{ r.name }}
            </td>
            <td class="is-right">{{ int(r.visitors) }}</td>
            <td class="is-right">{{ int(r.pv) }}</td>
            <td class="is-right" :class="r.bounce > 0.5 ? 'is-bad-text' : 'is-good-text'">
              {{ percent(r.bounce) }}
            </td>
            <td class="is-right">{{ percent(r.conversion, 2) }}</td>
            <td class="is-right">
              <span class="rp-share" :style="{ '--w': `${(r.share * 100).toFixed(1)}%` }" aria-hidden="true"></span>
              <span class="rp-share__text">{{ r.shareText }}</span>
              <span class="rp-mini" :class="r.growthGood ? 'is-good' : 'is-bad'">{{ r.growthText }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
