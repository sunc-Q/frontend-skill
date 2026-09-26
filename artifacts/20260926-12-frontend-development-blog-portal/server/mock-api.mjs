import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFacts } from '../scripts/dump-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A zero-dependency origin for the `?api=1` measurement arms.
 *
 * Why it exists: three of this round's questions (is the queryKey stable, is the chart panel
 * really deferred, does a back-navigation hit the cache) are only answerable by *counting
 * requests that crossed a real network boundary*. Latency is configurable per path so a slow
 * origin can be replayed deterministically, and every arrival is logged on the server side with
 * hrtime, so the count does not depend on the client cooperating.
 *
 * The payloads come from the app's own TypeScript through scripts/dump-facts.mjs — there is no
 * second copy of the corpus here to drift.
 */
export async function startMockApi({ port = 8188, latency = { '/posts': 120, '/insights': 240 } } = {}) {
  const facts = await loadFacts();
  const rows = facts.wireRows();
  const arrivals = [];
  const t0 = process.hrtime.bigint();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' }).end(body);
    };

    if (url.pathname === '/__control/reset') {
      arrivals.length = 0;
      return send(200, JSON.stringify({ ok: true }));
    }
    if (url.pathname === '/__control/log') {
      return send(200, JSON.stringify({ arrivals }));
    }

    if (url.pathname.startsWith('/api/')) {
      const key = url.pathname.slice('/api/'.length);
      const delay = latency[`/${key.split('/')[0]}`] ?? latency[`/${key}`] ?? 30;
      arrivals.push({ path: url.pathname, atMs: Number(process.hrtime.bigint() - t0) / 1e6 });
      await sleep(delay);
      if (key === 'posts') return send(200, JSON.stringify({ rows, generatedFor: 'grayscale' }));
      if (key === 'insights') return send(200, JSON.stringify(facts.insightsBuild()));
      const slug = key.startsWith('post/') ? key.slice(5) : null;
      if (slug !== null) {
        const post = facts.corpus.posts.find((p) => p.slug === slug);
        if (post === undefined) return send(404, JSON.stringify({ error: `no such post ${slug}` }));
        return send(
          200,
          JSON.stringify({
            slug: post.slug,
            title: post.title,
            day: post.day,
            tag: post.tag,
            views: post.views,
            minutes: post.readingMinutes,
            comments: post.comments,
            summary: post.summary,
            series: post.series,
            sections: post.sections,
            body: post.body,
            related: facts.relatedTo(post.slug).map((q) => ({
              slug: q.slug,
              title: q.title,
              day: q.day,
              tag: q.tag,
              views: q.views,
              minutes: q.readingMinutes,
              comments: q.comments,
            })),
          }),
        );
      }
      return send(404, JSON.stringify({ error: `no such endpoint ${key}` }));
    }

    /* static: the previews and the split-build host page */
    const rel = url.pathname === '/' ? '/preview/portal-topo-tactical.html' : url.pathname;
    const file = path.join(ROOT, rel.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file)) return send(404, 'nope', 'text/plain');
    const type = path.extname(file) === '.html' ? 'text/html; charset=utf-8' : path.extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    return send(200, readFileSync(file), type);
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    arrivals,
    close: () => new Promise((r) => server.close(r)),
  };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] ?? 8188);
  const s = await startMockApi({ port });
  console.log(`mock api on ${s.origin}  (previews: ${s.origin}/preview/portal-topo-tactical.html)`);
}
