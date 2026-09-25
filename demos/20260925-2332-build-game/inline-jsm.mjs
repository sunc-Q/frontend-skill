/**
 * three r160 ships examples/jsm only as ES modules meant for an importmap + CDN.
 * This sandbox resets jsdelivr/cdnjs TLS, so convert the addon chain into one classic
 * script that reads from the global THREE exposed by build/three.min.js.
 *   import {A, B as C} from 'three';   -> const {A, B: C} = THREE;
 *   import {Pass} from './Pass.js';    -> dropped (concatenated in dependency order)
 *   export {X, Y};                     -> dropped (top-level bindings are already global-lexical)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSM = process.env.JSM_DIR || path.join(HERE, '../../.tmp/three/package/examples/jsm');
const FILES = [
  'postprocessing/Pass.js', 'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js',
  'shaders/FXAAShader.js', 'postprocessing/ShaderPass.js', 'postprocessing/MaskPass.js',
  'postprocessing/RenderPass.js', 'postprocessing/EffectComposer.js', 'postprocessing/UnrealBloomPass.js',
  'shaders/OutputShader.js', 'postprocessing/OutputPass.js'
];
const exported = {};
const conv = (code, key) => {
  const names = [];
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*['"]three['"];?/g, (_, n) => 'const {' + n.split(',')
    .map(x => x.trim()).filter(Boolean).map(x => x.replace(/\s+as\s+/, ': ')).join(', ') + '} = THREE;');
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\.js['"];?/g, (_, n) => 'const {' + n.split(',')
    .map(x => x.trim()).filter(Boolean).join(', ') + '} = __FX;');
  code = code.replace(/export\s*\{([^}]*)\};?/g, (_, n) => { n.split(',').map(x => x.trim()).filter(Boolean).forEach(x => names.push(x)); return ''; });
  exported[key] = names;
  return '(function(){\n' + code + '\nObject.assign(__FX, {' + names.join(', ') + '});\n})();\n';
};
let out = 'const __FX = (window.__POSTFX = {});\n';
for (const f of FILES) {
  const src = fs.readFileSync(path.join(JSM, f), 'utf8');
  const c = conv(src, f);
  if (/^\s*(import)\b/m.test(c)) throw new Error('unconverted import in ' + f);
  out += `\n/* ===== ${f} (converted from ES module; exports: ${exported[f].join(', ')}) ===== */\n` + c;
}
out += 'const { Pass, FullScreenQuad, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, CopyShader, FXAAShader, LuminosityHighPassShader } = __FX;\n';
fs.writeFileSync(path.join(HERE, 'postfx.bundle.js'), out);
if (/<\/script/i.test(out)) throw new Error('addon source contains a closing script tag');
fs.writeFileSync(path.join(HERE, 'postfx.bundle.js'), out);
console.log('postfx.bundle.js', out.length, 'chars from', FILES.length, 'addon modules');
