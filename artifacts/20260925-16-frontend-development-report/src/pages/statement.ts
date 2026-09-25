import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ReportView from '../features/report/components/ReportView.vue';
import '../themes/all.css';

createApp(ReportView, { themeName: '冷灰对账单 statement' }).use(createPinia()).mount('#app');
