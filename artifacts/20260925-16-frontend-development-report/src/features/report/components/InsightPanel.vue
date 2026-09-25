<script setup lang="ts">
import type { Insight } from '../types';

interface Props {
  items: Insight[];
}

defineProps<Props>();

const toneLabel: Record<string, string> = {
  win: '见效',
  watch: '观察',
  risk: '风险',
};
</script>

<template>
  <section class="rp-sec" aria-labelledby="rp-in-h">
    <div class="rp-sec__head">
      <h2 id="rp-in-h">结论与建议</h2>
      <p class="rp-sec__note">由样例数据自动归纳，用于演示报表的叙述层；接入真实统计后应改为人工复核后发布。</p>
    </div>
    <ol class="rp-insights">
      <li v-for="i in items" :key="i.id" class="rp-insight" :data-tone="i.tone">
        <span class="rp-insight__tone">{{ toneLabel[i.tone] ?? i.tone }}</span>
        <h3 class="rp-insight__title">{{ i.title }}</h3>
        <p class="rp-insight__body">{{ i.body }}</p>
      </li>
    </ol>
  </section>
</template>
