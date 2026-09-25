<script setup lang="ts">
interface Props {
  siteName: string;
  siteUrl: string;
  periodLabel: string;
  rangeFrom: string;
  rangeTo: string;
  generatedAt: string;
}

defineProps<Props>();
</script>

<template>
  <header class="rp-head">
    <div class="rp-head__meta">
      <span class="rp-badge">{{ siteName }} · {{ siteUrl }}</span>
      <span class="rp-tag rp-tag--fixture" title="本页数据由本地确定性样例生成，非真实统计">示例数据</span>
    </div>
    <h1 class="rp-head__title">流量与作品表现报表</h1>
    <p class="rp-head__sub">
      <span class="rp-head__period">{{ periodLabel }}</span>
      <span class="rp-head__range">{{ rangeFrom }} — {{ rangeTo }}</span>
    </p>
    <dl class="rp-head__facts">
      <div class="rp-fact">
        <dt>报表生成</dt>
        <dd>{{ generatedAt }}</dd>
      </div>
      <div class="rp-fact">
        <dt>统计口径</dt>
        <dd>UTC 日历日 · 设备去重</dd>
      </div>
      <div class="rp-fact">
        <dt>对比基准</dt>
        <dd>上一个等长区间</dd>
      </div>
    </dl>
  </header>
</template>
