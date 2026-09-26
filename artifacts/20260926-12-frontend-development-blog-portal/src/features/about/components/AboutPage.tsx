import type { ReactElement } from 'react';
import { POST_COUNT, TODAY_DAY, corpus, intfmt } from '@/lib/facts';
import { STYLES, readStyleId } from '@/lib/style/registry';

/**
 * Third route, zero reads: the page only re-states facts already in the bundle. Together with the
 * archive (cache hit) and the home page (one read) this makes the route table a real test bed for
 * the skill's data-fetching clauses instead of a single page with tabs.
 */
export function AboutPage(): ReactElement {
  const skin = STYLES[readStyleId()];
  const { stats } = corpus;
  const oldest = corpus.posts.reduce((a, b) => (a.day < b.day ? a : b));
  const newest = corpus.posts.reduce((a, b) => (a.day > b.day ? a : b));
  return (
    <>
      <div className="cols">
        <div>
          <section className="post">
            <h1 data-testid="about-title">关于这个站点</h1>
            <p className="meta">示例站点 · 全部内容虚构 · 当前外观：{skin.name}</p>
            <div className="prose">
              <p>{oldest.title.slice(0, 12)}…</p>
              <blockquote>每一处读数都能从同一份事实源推导出来，页面上不存在手抄的统计数字。</blockquote>
              <h2>数据口径</h2>
              <p>
                共 {intfmt(stats.posts)} 篇（事实源常量 {POST_COUNT}），最早 {oldest.day} 号发布日、最近 {newest.day} 号，
                今天记作 {TODAY_DAY} 号；跨 {stats.spanMonths} 个自然月、{stats.months} 个月有文，最长连续更新 {stats.streak} 个月、最长断更 {stats.longestGap} 个月；
                合计 {intfmt(stats.views)} 次阅读、{intfmt(stats.minutes)} 分钟阅读时长、{stats.comments} 条讨论。
              </p>
              <h2>三条读数规则</h2>
              <p>一、「高热」= 当前结果集内阅读数排到 90 分位以上，因此换筛选条件时高热行数会变，这是设计而不是 bug。</p>
              <p>二、「本期最热」= 最近 120 天内阅读数最高的一篇，与列表排序无关。</p>
              <p>三、「最快一篇」= 该区间内最短的阅读时长，只放极值与合计，不放跨月平均值。</p>
              <h2>收藏与偏好</h2>
              <p>排序、行高、标签筛选与收藏写在浏览器本地（localStorage），换设备就没了；本页面不向任何服务器发出请求。</p>
              <h2>外观</h2>
              <p>
                同一份代码、同一份数据、三种外观：等高线战术图（直角 + 细网）、黏土定格动画（大圆角 + 硬偏移阴影）、
                黑胶唱片架（深色 + 刻纹）。差异全部来自一层设计令牌，结构样式里没有任何颜色字面量。
              </p>
            </div>
          </section>
        </div>
        <aside className="side" aria-label="侧栏">
          <section className="panel">
            <h2>本站规模</h2>
            <table className="datatable">
              <tbody>
                <tr><th scope="row">文章</th><td>{stats.posts}</td></tr>
                <tr><th scope="row">标签</th><td>{stats.tags}</td></tr>
                <tr><th scope="row">有文月份</th><td>{stats.months} / {stats.spanMonths}</td></tr>
                <tr><th scope="row">最长断更</th><td>{stats.longestGap} 个月</td></tr>
                <tr><th scope="row">中位分钟</th><td>{stats.medianMinutes}</td></tr>
                <tr><th scope="row">平均阅读</th><td>{intfmt(stats.avgViews)}</td></tr>
              </tbody>
            </table>
          </section>
        </aside>
      </div>
    </>
  );
}

export default AboutPage;
