<script setup lang="ts">
import { computed } from 'vue';
import { duration, int } from '../helpers/format';
import type { PageRow } from '../types';

interface Props {
  rows: PageRow[];
  query: string;
  expanded: string | null;
  from: string;
  to: string;
  coverage: number;
  total: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{ toggle: [path: string] }>();

const maxViews = computed(() => props.rows.reduce((acc, r) => Math.max(acc, r.views), 1));

const shaped = computed(() =>
  props.rows.map((r: PageRow) => ({
    ...r,
    share: (r.views / maxViews.value) * 100,
    viewsText: int(r.views),
    dwellText: duration(r.dwell),
    exitText: int(r.exits),
    density: r.views ? (r.exits / r.views) * 100 : 0,
  })),
);

const emptyHint = computed(() =>
  props.query.trim() ? `没有匹配「${props.query.trim()}」的页面。按 Esc 清空筛选。` : '这个区间没有页面数据。',
);
</script>

<template>
  <section class="rp-sec" aria-labelledby="rp-pg-h">
    <div class="rp-sec__head">
      <h2 id="rp-pg-h">页面表现</h2>
      <p class="rp-sec__note">
        {{ from }} — {{ to }} 区间内浏览量最高的 {{ total }} 个页面，合计约占全站浏览量
        {{ (coverage * 100).toFixed(0) }}%（其余为未单独统计的路径与静态资源）。当前显示
        {{ rows.length }} / {{ total }}。
      </p>
    </div>
    <p v-if="!rows.length" class="rp-empty">{{ emptyHint }}</p>
    <div v-else class="rp-tablewrap">
      <table class="rp-table rp-table--pages">
        <caption class="rp-sr-only">页面浏览量、平均停留与退出</caption>
        <thead>
          <tr>
            <th scope="col">页面</th>
            <th scope="col" class="is-right">浏览量</th>
            <th scope="col" class="is-right">平均停留</th>
            <th scope="col" class="is-right">退出</th>
            <th scope="col" class="is-right">退出率</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in shaped" :key="r.path">
            <tr :class="{ 'is-open': expanded === r.path }">
              <td class="rp-td-page">
                <button type="button" class="rp-rowbtn" :aria-expanded="expanded === r.path" @click="emit('toggle', r.path)">
                  <span class="rp-caret" aria-hidden="true">{{ expanded === r.path ? '▾' : '▸' }}</span>
                  <span class="rp-td-page__title">{{ r.title }}</span>
                  <code class="rp-path">{{ r.path }}</code>
                  <span class="rp-rowbar" :style="{ '--w': `${r.share.toFixed(1)}%` }" aria-hidden="true"></span>
                </button>
              </td>
              <td class="is-right">{{ r.viewsText }}</td>
              <td class="is-right">{{ r.dwellText }}</td>
              <td class="is-right">{{ r.exitText }}</td>
              <td class="is-right">{{ r.density.toFixed(1) }}%</td>
            </tr>
            <tr v-if="expanded === r.path" class="rp-detail">
              <td colspan="5">
                <p class="rp-detail__p">
                  区间内 {{ r.viewsText }} 次浏览，其中 {{ r.exitText }} 次以该页结束会话（退出率
                  {{ r.density.toFixed(1) }}%），单次平均停留 {{ r.dwellText }}。
                  <span v-if="r.path.startsWith('/works')"
                    >作品页承担咨询转化，是本站最接近商务目标的页面，退出率低说明访客会继续浏览其他作品。</span
                  >
                  <span v-else-if="r.path.startsWith('/notes')"
                    >长文的贡献是阅读深度而非直接转化，评估它应看停留时长而不是表单提交。</span
                  >
                  <span v-else>首页承担分发职责，关注点是它把访客送去了哪些具体页面。</span>
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
