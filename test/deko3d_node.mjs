// Makes deko3d_glsl.bin in Node with the page's code from the player's disc image (or game folder): default.xex's
// stored containers (lib/containers.js), the chain (lib/deko3d.js). Compares every shader's GLSL with ketsui-nx's
// native chain (out/deko3d_shaders/glsl_opt) and prints what the build's "deko3d" entry of release/manifest.json needs.
// Usage: node test/deko3d_node.mjs <disc image or game folder> [--native <glsl_opt folder>] [--out <file>]
//        [--dump <folder>]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, loadModules, root } from './node_files.mjs';
import { findGames, gameContainers } from '../lib/installer.js';
import { buildDeko3dPackage } from '../lib/deko3d.js';

const args = process.argv.slice(2);
const option = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args.splice(at, 2)[1] : null;
};
const native = option('--native');
const out = option('--out');
const dump = option('--dump');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const started = Date.now();

const chosen = await findGames(chosenOnDisk(args));
if (!chosen.game) {
  throw new Error('game not found');
}
const modules = await loadModules();
const { containers, xexHash } = await gameContainers(chosen, modules);
console.log(`default.xex ${xexHash}: ${containers.length} distinct containers`);
const common = fs.readFileSync(path.join(root, 'renut_shader_common.h'));
const { package: pkg, shaders } = await buildDeko3dPackage(containers, null, modules, common);
console.log(`${shaders.length} shaders translated in ${((Date.now() - started) / 1000).toFixed(0)} s ` +
  `(early alpha copies: ${shaders.filter((s) => s.earlyAlpha === 'copied').length})`);

if (native) {
  let same = 0;
  const differ = [];
  for (const s of shaders) {
    const file = path.join(native, `${s.name}.glsl`);
    if (!fs.existsSync(file)) {
      differ.push(`${s.name} (no native file)`);
    } else if (fs.readFileSync(file, 'utf8') === s.glsl) {
      same++;
    } else {
      differ.push(s.name);
    }
  }
  const nativeCount = fs.readdirSync(native).filter((n) => n.endsWith('.glsl')).length;
  console.log(`against the native chain (${nativeCount} shaders): ${same} identical, ${differ.length} different` +
    (differ.length ? `: ${differ.join(' ')}` : ''));
}
console.log('"deko3d": ' + JSON.stringify({
  shaders: shaders.map((s) => s.name),
  containers_sha256: [...new Set(shaders.map((s) => sha(containers[s.container].bytes)))].sort(),
  package_sha256: sha(pkg),
  package_size: pkg.length,
}));
if (dump) {
  fs.mkdirSync(dump, { recursive: true });
  for (const s of shaders) fs.writeFileSync(path.join(dump, `${s.name}.glsl`), s.glsl);
}
if (out) {
  fs.writeFileSync(out, pkg);
  console.log(`wrote ${out}`);
}
