// 出三风格的整页截图（CDP Page.captureScreenshot，等 DOM 真的渲染完再拍）。
// 用法：node scripts/screenshot.mjs <页面基址> <输出目录> [主题...]
//   node scripts/screenshot.mjs http://127.0.0.1:8080 evidence transit tag vinyl
import { writeFile, mkdir } from 'node:fs/promises';
import { openSession } from './headless.mjs';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
const outDir = process.argv[3];
const themes = process.argv.slice(4);
if (!base || !outDir || themes.length === 0) {
  console.error('用法: node screenshot.mjs <页面基址> <输出目录> [主题...]');
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const sess = await openSession({ port: Number(process.env.CDP_PORT || 19824), profileDir: '/tmp/fleaprobe/chrome-shot' });
try {
  for (const theme of themes) {
    await sess.goto(`${base}/?theme=${theme}`);
    const ready = await sess.waitFor('document.querySelectorAll(".kpi").length > 0 && document.querySelectorAll(".table:not(.mini) tbody tr").length > 0', 90);
    if (!ready) {
      console.error(`${theme}: 页面没渲染出表格，放弃出图`);
      continue;
    }
    // 整页高度按实际内容算，避免固定窗口把面板截断
    const height = Number(await sess.evaluate(`Math.min(document.body.scrollHeight + 40, 4200)`));
    await sess.conn.send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 700));
    const shot = await sess.conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(`${outDir}/style-${theme}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`写入 ${outDir}/style-${theme}.png (${Math.round((shot.data.length * 3) / 4 / 1024)} KB, 1440×${height})`);
    await sess.conn.send('Emulation.clearDeviceMetricsOverride');
  }
  if (sess.noise.length > 0) console.log('页面噪音：' + sess.noise.slice(0, 3).join(' | '));
} finally {
  sess.close();
}
