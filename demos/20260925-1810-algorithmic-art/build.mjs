import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const src = fs.readFileSync(here + 'viewer.src.html', 'utf8');
const lib = fs.readFileSync(here + '../../.tmp/p5x/package/lib/p5.min.js', 'utf8');
if (!src.includes('/*__P5_INLINE__*/')) throw new Error('placeholder missing');
const out = src.replace('/*__P5_INLINE__*/', () => lib);
fs.writeFileSync(here + 'art-index.html', out);
console.log('built art-index.html bytes=', Buffer.byteLength(out));
