// Reproduce the single-file artifact: template (game.src.html) + three r160 classic build
// -> frostlight-gather.html  (no CDN; the sandbox resets jsdelivr/unpkg TLS)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const threePath = process.env.THREE_MIN || path.join(here, '../../.tmp/three/package/build/three.min.js');
const three = fs.readFileSync(threePath, 'utf8');
if (/<\/script/i.test(three)) throw new Error('three build contains a closing script tag - escape it first');
const src = fs.readFileSync(path.join(here, 'game.src.html'), 'utf8');
const postfx = fs.readFileSync(path.join(here, 'postfx.bundle.js'), 'utf8');
if (/<\/script/i.test(postfx)) throw new Error('addon bundle contains a closing script tag');
// replacer functions: a literal $& / $' inside the library source must not expand
const out = src.replace('/*__THREE__*/', () => three).replace('/*__POSTFX__*/', () => postfx);
fs.writeFileSync(path.join(here, 'frostlight-gather.html'), out);
console.log('frostlight-gather.html', Buffer.byteLength(out), 'bytes (three:', three.length, 'chars)');
