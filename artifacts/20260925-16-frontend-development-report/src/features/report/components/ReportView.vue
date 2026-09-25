<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted } from 'vue';
import ChannelTable from './ChannelTable.vue';
import FilterBar from './FilterBar.vue';
import InsightPanel from './InsightPanel.vue';
import KpiGrid from './KpiGrid.vue';
import PageTable from './PageTable.vue';
import ReportFooter from './ReportFooter.vue';
import ReportHeader from './ReportHeader.vue';
import TrendChart from './TrendChart.vue';
import { useReportStore } from '../stores/reportStore';
import type { SortKey } from '../types';

interface Props {
  themeName: string;
}

const props = defineProps<Props>();
const store = useReportStore();
const { report, loading, error, query, expanded, sort, channels, pages, totals } = storeToRefs(store);

onMounted(() => {
  void store.load();
});

const first = computed(() => (report.value ? report.value.days[0] : undefined));
const last = computed(() => {
  const r = report.value;
  return r ? r.days[r.days.length - 1] : undefined;
});

function onSort(key: SortKey): void {
  store.toggleSort(key);
}

function onToggle(path: string): void {
  store.toggleRow(path);
}

function retry(): void {
  void store.load();
}

const theme = props.themeName;
</script>

<template>
  <div class="rp" :class="{ 'is-busy': loading }">
    <ReportHeader
      :site-name="report ? report.siteName : '—'"
      :site-url="report ? report.siteUrl : '—'"
      :period-label="report ? report.periodLabel : '加载中'"
      :range-from="first ? first.date : '—'"
      :range-to="last ? last.date : '—'"
      :generated-at="report ? report.generatedAt : '—'"
    />

    <FilterBar />

    <p v-if="error" class="rp-error" role="alert">
      取数失败：{{ error }}
      <button type="button" class="rp-btn rp-btn--inline" @click="retry">重试</button>
    </p>

    <template v-if="loading && !report">
      <section class="rp-sec" aria-busy="true">
        <div class="rp-sec__head">
          <h2><span class="rp-skel rp-skel--h">核心指标</span></h2>
        </div>
        <div class="rp-kpis">
          <div v-for="n in 7" :key="n" class="rp-kpi is-skel">
            <span class="rp-skel rp-skel--label"></span>
            <span class="rp-skel rp-skel--value"></span>
            <span class="rp-skel rp-skel--spark"></span>
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="report">
      <KpiGrid :items="report.kpis" :compare-label="report.compareLabel" />
      <TrendChart :days="report.days" />
      <ChannelTable
        :rows="channels"
        :sort="sort"
        :total-visitors="totals.visitors"
        :totals="totals"
        @sort="onSort"
      />
      <PageTable
        :rows="pages"
        :query="query"
        :expanded="expanded"
        :from="first ? first.date : ''"
        :to="last ? last.date : ''"
        :coverage="report.pageCoverage"
        :total="report.pages.length"
        @toggle="onToggle"
      />
      <InsightPanel :items="report.insights" />
      <ReportFooter :compare-label="report.compareLabel" :generated-at="report.generatedAt" :theme-name="theme" />
    </template>
  </div>
</template>
