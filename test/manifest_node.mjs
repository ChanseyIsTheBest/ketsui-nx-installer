// Writes the build's entry of release/manifest.json from the tested files: the player's disc image (or game folder),
// the NRO in release/ and the shaders the page makes (lib/deko3d.js: the containers default.xex stores).
// Usage: node test/manifest_node.mjs <disc image or game folder> --version <version> [--write]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chosenOnDisk, loadModules, root } from './node_files.mjs';
import { findGames, gameContainers } from '../lib/installer.js';
import { buildDeko3dPackage } from '../lib/deko3d.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const versionAt = args.indexOf('--version');
const version = versionAt >= 0 ? args.splice(versionAt, 2)[1] : null;
const inputs = args.filter((a) => a !== '--write');
if (!version || !inputs.length) {
  console.error('usage: node test/manifest_node.mjs <disc image or game folder> --version <version> [--write]');
  process.exit(1);
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const chosen = await findGames(chosenOnDisk(inputs));
if (!chosen.game) {
  throw new Error('the game was not found');
}
const modules = await loadModules();
const { containers, xexHash } = await gameContainers(chosen, modules);
const common = fs.readFileSync(path.join(root, 'renut_shader_common.h'));
const { package: pkg, shaders } = await buildDeko3dPackage(containers, null, modules, common);
const nro = fs.readFileSync(path.join(root, 'release', 'ketsui.nro'));
const build = {
  edition: 'Xbox 360 disc (title 465607D1, Ketsui Kizuna Jigoku Tachi Extra)',
  version,
  xex_sha256: xexHash,
  game_files: chosen.game.files.map((f) => ({ path: f.path, size: f.size })).sort(byPath),
  nro: 'ketsui.nro',
  nro_sha256: sha(nro),
  nro_size: nro.length,
  deko3d: {
    shaders: shaders.map((s) => s.name),
    containers_sha256: [...new Set(shaders.map((s) => containers[s.container].sha256))].sort(),
    package_sha256: sha(pkg),
    package_size: pkg.length,
  },
};
const manifest = { version: 1, builds: [build] };
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (write) {
  fs.writeFileSync(path.join(root, 'release', 'manifest.json'), text);
  fs.writeFileSync(path.join(root, 'release', 'deko3d_glsl.bin'), pkg);
  console.log(`wrote release/manifest.json (${build.game_files.length} game files, ${shaders.length} shaders, NRO ` +
    `${build.nro_sha256}) and release/deko3d_glsl.bin (for tests only)`);
} else {
  process.stdout.write(text);
}
