import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { reportApi } from '../api/reportApi';
import { PERIODS } from '../helpers/dataset';
import type { ChannelSort, PeriodKey, ReportPayload, SortKey } from '../types';

/**
 * 报表状态：区间筛选、排序、搜索、数据与请求状态。
 * 列表数据用 shallowRef，避免对上千条记录做深层响应式代理。
 */
export const useReportStore = defineStore('report', () => {
  const period = ref<PeriodKey>('30d');
  const sort = ref<ChannelSort>({ key: 'visitors', dir: 'desc' });
  const query = ref('');
  const expanded = ref<string | null>(null);

  const report = shallowRef<ReportPayload | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loadedAt = ref<string | null>(null);

  const periods = computed(() => PERIODS);

  const channels = computed(() => {
    const rows = report.value ? [...report.value.channels] : [];
    const key: SortKey = sort.value.key;
    const dir = sort.value.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN') * dir;
      return (a[key] - b[key]) * dir;
    });
    return rows;
  });

  const pages = computed(() => {
    const q = query.value.trim().toLowerCase();
    const rows = report.value ? report.value.pages : [];
    if (!q) return rows;
    return rows.filter((p) => p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  });

  const totals = computed(() => {
    const rows = report.value ? report.value.channels : [];
    const visitors = rows.reduce((acc, r) => acc + r.visitors, 0);
    const weightedBounce = rows.reduce((acc, r) => acc + r.bounce * r.visitors, 0);
    const weightedConv = rows.reduce((acc, r) => acc + r.conversion * r.visitors, 0);
    return {
      visitors,
      bounce: visitors ? weightedBounce / visitors : 0,
      conversion: visitors ? weightedConv / visitors : 0,
    };
  });

  async function load(next: PeriodKey = period.value): Promise<void> {
    period.value = next;
    loading.value = true;
    error.value = null;
    try {
      report.value = await reportApi.getReport(next);
      loadedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : '数据加载失败';
    } finally {
      loading.value = false;
    }
  }

  function toggleSort(key: SortKey): void {
    if (sort.value.key === key) {
      sort.value = { key, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' };
      return;
    }
    sort.value = { key, dir: key === 'name' ? 'asc' : 'desc' };
  }

  function toggleRow(path: string): void {
    expanded.value = expanded.value === path ? null : path;
  }

  return {
    period,
    sort,
    query,
    expanded,
    report,
    loading,
    error,
    loadedAt,
    periods,
    channels,
    pages,
    totals,
    load,
    toggleSort,
    toggleRow,
  };
});
