<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useReportStore } from '../stores/reportStore';
import type { PeriodKey } from '../types';

const store = useReportStore();
const draft = ref(store.query);
let timer: ReturnType<typeof setTimeout> | null = null;

const options = computed(() => store.periods);

// 搜索防抖：输入停止 350ms 后才写入 store，避免每键重排表格
watch(draft, (value: string) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    store.query = value;
  }, 350);
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

function pick(key: PeriodKey): void {
  void store.load(key);
}

function print(): void {
  window.print();
}

function onSearchInput(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    if (timer) clearTimeout(timer);
    store.query = draft.value;
  }
  if (event.key === 'Escape') {
    draft.value = '';
    store.query = '';
  }
}
</script>

<template>
  <div class="rp-bar" role="search">
    <div class="rp-seg" role="group" aria-label="统计区间">
      <button
        v-for="opt in options"
        :key="opt.key"
        type="button"
        class="rp-seg__btn"
        :aria-pressed="store.period === opt.key"
        :disabled="store.loading"
        @click="pick(opt.key)"
      >
        {{ opt.label }}
      </button>
    </div>

    <label class="rp-field">
      <span class="rp-field__label">筛选页面</span>
      <input
        class="rp-field__input"
        type="search"
        :value="draft"
        placeholder="按标题或路径搜索，Esc 清空"
        @input="onSearchInput"
        @keydown="onKeydown"
      />
    </label>

    <div class="rp-bar__actions">
      <span v-if="store.loading" class="rp-bar__status" role="status">正在取数…</span>
      <span v-else-if="store.loadedAt" class="rp-bar__status">已加载 {{ store.loadedAt }}</span>
      <button type="button" class="rp-btn" @click="print">打印 / 导出 PDF</button>
    </div>
  </div>
</template>
