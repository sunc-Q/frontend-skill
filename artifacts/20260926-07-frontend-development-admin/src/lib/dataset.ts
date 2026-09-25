import type { ActivityEvent, ApiKey, BeLink, Dataset } from '~types/index';

/**
 * Fact source copied verbatim from artifacts/20260925-17-vercel-react-best-practices-admin
 * (same seed, same generator) so the two rounds can be compared on identical content:
 * that round was built under vercel-react-best-practices, this one under frontend-development.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SLUG_WORDS = [
  'spring', 'launch', 'promo', 'docs', 'blog', 'video', 'signup', 'demo', 'sale', 'guide',
  'report', 'event', 'podcast', 'resume', 'album', 'trial', 'invite', 'review', 'stats', 'fallback',
];
const OWNERS = ['lin@beacon.dev', 'chen@beacon.dev', 'wong@beacon.dev', 'zhao@beacon.dev', 'ops@beacon.dev'];
const TLD_HOSTS = ['acme.io', 'nuwa.cn', 'trail.run', 'mobi.dev', 'datafox.cloud', 'jianli.me'];

const DAY = 86_400_000;

export function buildDataset(): Dataset {
  const rnd = mulberry32(20260925);
  const now = Date.UTC(2026, 8, 25, 1, 0, 0);
  const links: BeLink[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 60; i++) {
    let slug = '';
    do {
      const w = SLUG_WORDS[Math.floor(rnd() * SLUG_WORDS.length)] ?? 'link';
      slug = w + (rnd() < 0.5 ? '' : String(1 + Math.floor(rnd() * 99)));
    } while (used.has(slug));
    used.add(slug);
    const age = Math.floor(rnd() * 160);
    const clicks = Math.floor(Math.pow(rnd(), 2.1) * 9000) + 5;
    const host = TLD_HOSTS[Math.floor(rnd() * TLD_HOSTS.length)] ?? 'acme.io';
    links.push({
      id: i + 1,
      slug,
      target: `https://${host}/${slug}${rnd() < 0.3 ? '/index' : ''}`,
      owner: OWNERS[Math.floor(rnd() * OWNERS.length)] ?? 'ops@beacon.dev',
      createdAt: now - age * DAY - Math.floor(rnd() * DAY),
      lastClickAt: rnd() < 0.14 ? null : now - Math.floor(rnd() * 28 * DAY),
      clicks,
      paused: rnd() < 0.18,
      note: rnd() < 0.25 ? '运营活动专用，到期检查' : '',
    });
  }

  const series14: number[] = [];
  for (let d = 0; d < 14; d++) {
    const weekday = (Date.UTC(2026, 8, 12 + d) / DAY) % 7;
    const weekendDip = weekday === 5 || weekday === 6 ? 0.68 : 1;
    series14.push(Math.round((2600 + rnd() * 1400) * weekendDip + d * 46));
  }

  const scopesPool = ['links:read', 'links:write', 'stats:read', 'keys:manage'];
  const keys: ApiKey[] = [];
  const hex = '0123456789abcdef';
  for (let i = 0; i < 5; i++) {
    let secret = '';
    for (let c = 0; c < 28; c++) secret += hex[Math.floor(rnd() * 16)] ?? '0';
    const nScopes = 1 + Math.floor(rnd() * 3);
    keys.push({
      id: i + 1,
      label: ['CI 流水线', '数据同步任务', '客服面板', '投放脚本', '备用只读'][i] ?? '未命名',
      prefix: `bcn_${secret.slice(0, 4)}`,
      secret,
      scopes: scopesPool.slice(0, nScopes),
      lastUsedAt: rnd() < 0.2 ? null : now - Math.floor(rnd() * 20 * DAY),
      createdAt: now - Math.floor(30 + rnd() * 300) * DAY,
    });
  }

  const kinds: ActivityEvent['kind'][] = ['deploy', 'alert', 'user', 'system'];
  const events: ActivityEvent[] = [];
  for (let i = 0; i < 8; i++) {
    const kind = kinds[i % 4] ?? 'system';
    const text =
      kind === 'deploy' ? `发布 v2.${9 + i}.${i} 到生产环境` :
      kind === 'alert' ? `短链 r/${SLUG_WORDS[i + 3] ?? 'promo'} 触发限流阈值` :
      kind === 'user' ? `${OWNERS[i % 5] ?? 'ops@beacon.dev'} 新建了 ${1 + (i % 4)} 条短链` :
      '数据库每日快照完成，耗时 42s';
    events.push({ id: i + 1, at: now - i * Math.floor(2 + rnd() * 9) * 3_600_000, kind, text });
  }

  const clicks7d = series14.slice(7).reduce((a, b) => a + b, 0);
  const clicksPrev7d = series14.slice(0, 7).reduce((a, b) => a + b, 0);
  let top = links[0] ?? { slug: '-', clicks: 0 };
  let activeLinks = 0;
  for (const l of links) {
    if (!l.paused) activeLinks += 1;
    if (l.clicks > top.clicks) top = l;
  }
  const sparkWeekly: number[] = [];
  for (let w = 0; w < 8; w++) sparkWeekly.push(Math.round(clicks7d * (0.62 + rnd() * 0.5) * (1 + w * 0.05)));
  const sparkApi: number[] = [];
  for (let w = 0; w < 8; w++) sparkApi.push(Math.round(120_000 * (0.7 + rnd() * 0.6)));
  const sparkUptime: number[] = [];
  for (let w = 0; w < 8; w++) sparkUptime.push(99.5 + rnd() * 0.5);

  return {
    links,
    series14,
    keys,
    events,
    stats: {
      totalLinks: links.length,
      activeLinks,
      clicks7d,
      clicksPrev7d,
      apiCalls30d: sparkApi.reduce((a, b) => a + b, 0) * 4,
      topSlug: top.slug,
      topClicks: top.clicks,
      uptime: Number((sparkUptime.reduce((a, b) => a + b, 0) / sparkUptime.length).toFixed(2)),
      sparkDaily: series14,
      sparkWeekly,
      sparkApi,
      sparkUptime,
    },
  };
}

export type { BeLink, ApiKey, ActivityEvent, Dataset };
