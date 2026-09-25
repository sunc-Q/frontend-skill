export type PhotoKind = 'person' | 'event' | 'blur' | 'screenshot';

export interface Photo {
  id: string;
  kind: PhotoKind;
  year: number;
  score: number;
  span: 1 | 2;
  hue: number;
}

export interface Album {
  id: string;
  name: string;
  count: number;
  coverHue: number;
}

/* mulberry32：种子固定，三页拿到完全相同的数据，风格差异只可能来自 CSS */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOTAL_PHOTOS = 168;

export function buildPhotos(): { photos: Photo[]; albums: Album[] } {
  const r = rng(20260925);
  const photos: Photo[] = [];
  for (let i = 0; i < TOTAL_PHOTOS; i += 1) {
    const k = r();
    const kind: PhotoKind = k < 0.34 ? 'person' : k < 0.66 ? 'event' : k < 0.85 ? 'blur' : 'screenshot';
    photos.push({
      id: 'p' + String(i).padStart(3, '0'),
      kind,
      year: 2016 + Math.floor(r() * 10),
      score: Math.round(r() * 100),
      span: r() > 0.82 ? 2 : 1,
      hue: Math.floor(r() * 360),
    });
  }
  const albumDefs: Array<[string, PhotoKind, number]> = [
    ['家人', 'person', 31],
    ['旅行', 'event', 24],
    ['演出与展览', 'event', 17],
    ['猫', 'person', 12],
    ['待清理（模糊）', 'blur', 19],
    ['截图归档', 'screenshot', 27],
  ];
  const albums: Album[] = [];
  for (const [name, kind, count] of albumDefs) {
    let n = 0;
    for (const p of photos) {
      if (p.kind === kind) n += 1;
    }
    albums.push({
      id: name,
      name,
      count: Math.min(count, n === 0 ? count : Math.max(3, n)),
      coverHue: (count * 47 + kind.length * 31) % 360,
    });
  }
  return { photos, albums };
}

export const KIND_LABEL: Record<PhotoKind, string> = {
  person: '人物',
  event: '事件',
  blur: '模糊',
  screenshot: '截图',
};

export function countKept(photos: Photo[]): number {
  let n = 0;
  // js-combine-iterations: 一次遍历同时算出保留数与归档数
  for (const p of photos) {
    if (p.kind !== 'blur' && p.kind !== 'screenshot' && p.score >= 38) n += 1;
  }
  return n;
}
