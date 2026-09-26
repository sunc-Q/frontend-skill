import type { Corpus, MonthBucket, Post, SiteStats, TagId, TagStat } from '~types/post';

/**
 * The single source of truth for every number that reaches the screen.
 * Nothing downstream is allowed to hard-code a count: page counts, tag totals and month
 * buckets are all derived here, so an assertion can recompute them independently and compare.
 */

export const DAY0_UTC = Date.UTC(2021, 0, 1);
export const TODAY_DAY = 2094; // 2026-09-26 from DAY0_UTC; check-node recomputes this from Date.UTC
export const POST_COUNT = 240;

const TAGS: { id: TagId; label: string }[] = [
  { id: 'deploy', label: '发布' },
  { id: 'observe', label: '可观测' },
  { id: 'incident', label: '故障复盘' },
  { id: 'testing', label: '测试' },
  { id: 'storage', label: '存储' },
  { id: 'network', label: '网络' },
  { id: 'security', label: '安全' },
  { id: 'db', label: '数据库' },
  { id: 'frontend', label: '前端' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'process', label: '流程' },
];

export const TAG_LABEL: Record<TagId, string> = TAGS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<TagId, string>,
);

export const TAG_IDS: TagId[] = TAGS.map((t) => t.id);

const SUBJECT = [
  '灰度发布', '滚动重启', '熔断阈值', '采样率', '索引重建', '连接池', '慢查询', '证书轮换',
  '日志分级', '链路追踪', '回滚窗口', '压测基线', '缓存击穿', '分库分表', '包体积', '依赖锁定',
  '超时预算', '重试风暴', '数据迁移', '容量规划', '告警收敛', '影子流量', '金丝雀指标', '错误预算',
];
const ACTION = [
  '怎么定', '差一点错了', '的一次回退', '重做记录', '实测对比', '踩坑清单', '的三种写法', '复盘',
  '被低估的部分', '在夜间值班时', '的隐藏成本', '怎么测', '与一次线上事故', '的取舍', '重读笔记',
  '到底归谁管', '的两条底线', '的观测缺口', '为什么先做它', '小记', '的边界条件', '半年后再看',
];
const SERIES = [
  null, null, null, null, null, '值班手记', '发布流水线', '存储内参', '可观测性十二讲', '重写笔记',
];

/** Deterministic LCG — the corpus must be byte-identical on every machine and in every arm. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function dayToISO(day: number): string {
  const ms = DAY0_UTC + day * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dayToMonth(day: number): string {
  const iso = dayToISO(day);
  return iso.slice(0, 7);
}

export function dayToYear(day: number): number {
  return Number(dayToISO(day).slice(0, 4));
}

export function formatDate(day: number): string {
  return dayToISO(day).replaceAll('-', '.');
}

function sectionsFor(rnd: () => number, subject: string): string[] {
  const pool = [
    '背景', '当时的假设', '数据从哪来', '第一版实现', '为什么不够', '量出来的差别',
    '失败模式', '我们改了什么', '回归怎么守住', '代价', '如果重来一次', '后续动作',
  ];
  const n = 4 + Math.floor(rnd() * 3);
  const picked: string[] = [];
  while (picked.length < n) {
    const c = pool[Math.floor(rnd() * pool.length)] as string;
    if (!picked.includes(c)) picked.push(c);
  }
  picked.push(`关于${subject}的问答`);
  return picked;
}

function buildBody(subject: string, action: string, sections: string[], tag: TagId): string {
  const heads = sections.map((s) => `## ${s}`);
  const prose = sections.map((s, i) =>
    i % 3 === 0
      ? `${s}这一段先说结论：${subject}${action}，真正的分歧不在参数，而在谁能提供可信的读数。`
      : `我们把${subject}的读数拆成三层，逐层比对之后才发现缺的是${s}里那条基线。`,
  );
  const code = [
    '### 关键片段',
    '```go',
    '// 预算 0 表示不限制，这里故意不特判，交给上层拦。',
    'func pickReplicas(in []Node, budget int, zone string) ([]Node, error) {',
    '    const maxBudget = 12',
    '    sort.SliceStable(in, func(i, j int) bool { return in[i].Score > in[j].Score })',
    '    out := in[:min(min(budget, maxBudget), len(in))]',
    '    if len(out) == 0 && zone != "default" {',
    '        return nil, errNoNode',
    '    }',
    '    return out, nil',
    '}',
    '```',
    `> 注：上面的${TAG_LABEL[tag]}片段来自复盘记录，函数名做过脱敏。`,
  ];
  return [heads[0] as string, prose[0], heads.slice(1).map((h, i) => `${h}\n${prose[(i + 1) % prose.length]}`).join('\n\n'), code.join('\n')].join('\n\n');
}

/**
 * Three quiet stretches. Without them a 240-post / 69-month corpus posts in literally every
 * month, and "longest consecutive run" degenerates into "total months" — a KPI that can never be
 * wrong is a KPI that says nothing, so the streak needs real gaps to be worth printing.
 */
export const HIATUS: string[] = ['2022-07', '2022-08', '2024-01'];

function escapeHiatus(day: number): number {
  let d = day;
  while (HIATUS.includes(dayToMonth(d))) d += 1;
  return d;
}

export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function makeCorpus(): Corpus {
  const rnd = rng(20260926);
  const posts: Post[] = [];
  for (let i = 0; i < POST_COUNT; i++) {
    const subject = SUBJECT[i % SUBJECT.length] as string;
    const action = ACTION[Math.floor(rnd() * ACTION.length)] as string;
    const tag = TAG_IDS[Math.floor(rnd() * TAG_IDS.length)] as TagId;
    const series = SERIES[Math.floor(rnd() * SERIES.length)] as string | null;
    // 2021-01-04 .. just before TODAY (day 0 = 2021-01-01); the divisor is POST_COUNT, not
    // POST_COUNT-1, because rnd() adds up to 0.8 and would otherwise date a post in the future.
    const day = escapeHiatus(3 + Math.round(((i + rnd() * 0.8) / POST_COUNT) * (TODAY_DAY - 13)));
    const readingMinutes = 3 + Math.floor(rnd() * 22);
    const age = TODAY_DAY - day;
    const views = Math.round((240 + rnd() * 3600) * (1 + age / 420));
    const comments = Math.floor(rnd() * Math.max(1, views / 320));
    const sections = sectionsFor(rnd, subject);
    const slug = `p-${String(i + 1).padStart(3, '0')}-${tag}`;
    posts.push({
      slug,
      title: `${subject}${action}`,
      day,
      tag,
      series,
      readingMinutes,
      views,
      comments,
      summary: `${subject}相关的${TAG_LABEL[tag]}实践：${action}。全文 ${readingMinutes} 分钟。`,
      sections,
      body: buildBody(subject, action, sections, tag),
    });
  }

  const tagMap = new Map<TagId, TagStat>();
  for (const t of TAG_IDS) tagMap.set(t, { tag: t, count: 0, views: 0, minutes: 0 });
  const monthMap = new Map<string, MonthBucket>();
  let views = 0;
  let minutes = 0;
  let comments = 0;
  for (const p of posts) {
    const ts = tagMap.get(p.tag);
    if (ts !== undefined) {
      ts.count += 1;
      ts.views += p.views;
      ts.minutes += p.readingMinutes;
    }
    const month = dayToMonth(p.day);
    const existing = monthMap.get(month);
    if (existing === undefined) {
      monthMap.set(month, { month, year: Number(month.slice(0, 4)), count: 1, views: p.views, minutes: p.readingMinutes });
    } else {
      existing.count += 1;
      existing.views += p.views;
      existing.minutes += p.readingMinutes;
    }
    views += p.views;
    minutes += p.readingMinutes;
    comments += p.comments;
  }

  const byTag = [...tagMap.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const byMonth = [...monthMap.values()].sort((a, b) => (a.month < b.month ? 1 : -1));

  // longest run of consecutive months that actually have a post, and the longest empty stretch
  const months = [...monthMap.keys()].sort();
  let streak = 1;
  let run = 1;
  let longestGap = 0;
  for (let i = 1; i < months.length; i++) {
    const step = monthIndex(months[i] as string) - monthIndex(months[i - 1] as string);
    if (step === 1) {
      run += 1;
      streak = Math.max(streak, run);
    } else {
      longestGap = Math.max(longestGap, step - 1);
      run = 1;
    }
  }
  const spanMonths = monthIndex(months[months.length - 1] as string) - monthIndex(months[0] as string) + 1;

  const sortedMinutes = posts.map((p) => p.readingMinutes).sort((a, b) => a - b);
  const mid = Math.floor(sortedMinutes.length / 2);
  const medianMinutes =
    sortedMinutes.length % 2 === 0
      ? Number((((sortedMinutes[mid - 1] as number) + (sortedMinutes[mid] as number)) / 2).toFixed(1))
      : (sortedMinutes[mid] as number);

  const stats: SiteStats = {
    posts: posts.length,
    views,
    minutes,
    comments,
    tags: tagMap.size,
    months: monthMap.size,
    spanMonths,
    streak,
    longestGap,
    avgViews: Math.round(views / posts.length),
    medianMinutes,
  };

  return { posts, byTag, byMonth, stats };
}

export const corpus: Corpus = makeCorpus();

export const POST_INDEX: Map<string, Post> = new Map(corpus.posts.map((p) => [p.slug, p]));

/** The featured pick is a rule, not a choice: highest views inside the last 120 days. */
export function featuredSlug(): string {
  const window = corpus.posts.filter((p) => TODAY_DAY - p.day <= 120);
  const pool = window.length > 0 ? window : corpus.posts;
  let best = pool[0] as Post;
  for (const p of pool) if (p.views > best.views) best = p;
  return best.slug;
}

export function relatedTo(slug: string, limit = 4): Post[] {
  const self = POST_INDEX.get(slug);
  if (self === undefined) return [];
  return corpus.posts
    .filter((p) => p.slug !== self.slug && (p.tag === self.tag || (self.series !== null && p.series === self.series)))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export function daysAgo(day: number): number {
  return TODAY_DAY - day;
}

export function relativeDay(day: number): string {
  const d = daysAgo(day);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天前`;
  if (d < 60) return `${Math.floor(d / 7)} 周前`;
  if (d < 730) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

export function intfmt(n: number): string {
  return n.toLocaleString('en-US');
}
