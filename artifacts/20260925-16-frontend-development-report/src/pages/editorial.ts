import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ReportView from '../features/report/components/ReportView.vue';
import '../themes/all.css';

createApp(ReportView, { themeName: '暖纸数据新闻 editorial' }).use(createPinia()).mount('#app');
