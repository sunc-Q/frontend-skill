import { buildReport } from '../helpers/dataset';
import type { PeriodKey, ReportPayload } from '../types';

/**
 * 数据访问层。当前为本地样例数据的异步实现，接口形状与真实统计后端一致，
 * 换成 fetch('/analytics/report?period=...') 只需替换本文件。
 */
export const reportApi = {
  async getReport(period: PeriodKey): Promise<ReportPayload> {
    await new Promise((resolve) => setTimeout(resolve, 260));
    return buildReport(period);
  },
};
