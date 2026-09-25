<script setup lang="ts">
interface Props {
  compareLabel: string;
  generatedAt: string;
  themeName: string;
}

defineProps<Props>();
</script>

<template>
  <footer class="rp-foot">
    <div class="rp-foot__cols">
      <div>
        <h4>数据口径</h4>
        <p>
          浏览量按页面加载计数，独立访客按设备指纹去重（本地存储，不含跨设备合并）；跳出率 = 单页会话 / 会话总数；咨询转化 = 表单提交或
          mailto 点击 / 访客。
        </p>
      </div>
      <div>
        <h4>对比基准</h4>
        <p>「较上期」对比区间为 {{ compareLabel }}，长度与本期相同，不做季节性调整。</p>
      </div>
      <div>
        <h4>本文件说明</h4>
        <p>
          页面所有数字来自构建时的确定性随机样例（种子 20260925），生成于 {{ generatedAt }}，不代表任何真实站点。样式主题：{{ themeName }}。打印时会自动切换为黑白友好版式。
        </p>
      </div>
    </div>
    <p class="rp-foot__print">打印或导出 PDF：使用浏览器「打印」，背景图形需在打印设置中勾选。</p>
  </footer>
</template>
