import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ReportView from '../features/report/components/ReportView.vue';
import '../themes/all.css';

createApp(ReportView, { themeName: '暗色霓虹 cyber' }).use(createPinia()).mount('#app');
