// Builds the ketsui-nx.zip package from the player's own copy of Ketsui: Kizuna Jigoku Tachi Extra (Xbox 360 disc,
// title 465607D1): its disc image (read in place, nothing is extracted to disk) or a folder it was extracted into.
//
// The zip holds the Switch build (ketsui.nro) and its licenses, the shaders of its renderer made from the game's
// executable (deko3d_glsl.bin: the shader containers default.xex stores) and the game's files (game_root/, as on the
// disc, without the console's system update). The settings file, ketsui.toml, is written by the game at its first
// start, so an update never replaces the player's settings.

import { readXexImage } from './xex.js';
import { imageContainers, sha256 } from './containers.js';
import { buildDeko3dPackage } from './deko3d.js';
import { listFiles } from './xdvdfs.js';
import { ZipWriter, zipSize } from './zip.js';
import { t } from './i18n.js';

export { sha256 };

const CHUNK = 16 * 1024 * 1024;
const ROOT = 'ketsui-nx';
// the disc's console system update: not part of the game
const NOT_GAME = /^\$systemupdate\//i;
// files a computer adds to folders
const JUNK = /(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i;

async function* chunksOf(file) {
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    yield await file.read(offset, Math.min(CHUNK, file.size - offset));
  }
}

function baseName(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

// The LZX step of readXexImage, done by libmspack compiled to WebAssembly.
export function lzxStep(lzx) {
  return async (compressed, bits, size) => {
    lzx.FS.writeFile('/image.lzx', compressed);
    const rc = lzx.callMain(['/image.lzx', '/image.bin', String(bits), String(size)]);
    if (rc) {
      throw new Error(`LZX decompression failed (${rc})`);
    }
    const out = lzx.FS.readFile('/image.bin');
    lzx.FS.unlink('/image.lzx');
    lzx.FS.unlink('/image.bin');
    return out;
  };
}

// Where a release file is downloaded from. Its SHA-256 is part of the address, so every version is a different
// address and a copy kept by the browser is never mistaken for a newer one.
export function releasePath(name, hash) {
  return `./release/${name}?sha256=${hash}`;
}

export function programPath(build) {
  return releasePath(build.nro, build.nro_sha256);
}

// The game's files without what is not part of the game, sorted by path.
function gameFiles(files) {
  return files.filter((f) => !NOT_GAME.test(f.path) && !JUNK.test(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Sorts out what the player chose: files ([{ path, size, read }]) from the "Disc image" button (the chosen files) or
// from the "Folder" button (every file under the folder, path relative to it).
// Returns { game }: game = { kind: 'image' | 'folder', name, size, files } (paths relative to the disc's root) or null.
export async function findGames(chosen) {
  let game = null;
  // A disc image: the first large file that holds an XDVDFS game partition with a default.xex.
  for (const file of chosen.filter((f) => f.size >= 64 * 1024 * 1024).sort((a, b) => b.size - a.size)) {
    let files = null;
    try {
      files = await listFiles(file);
    } catch {
      files = null;
    }
    if (files && files.some((f) => f.path.toLowerCase() === 'default.xex')) {
      const kept = gameFiles(files);
      game = { kind: 'image', name: baseName(file.path), size: kept.reduce((sum, f) => sum + f.size, 0), files: kept };
      break;
    }
  }
  // An extracted game: the shallowest default.xex names its folder, and every file in that folder is a game file.
  if (!game) {
    const executables = chosen
      .filter((f) => baseName(f.path).toLowerCase() === 'default.xex')
      .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    if (executables.length) {
      const prefix = executables[0].path.slice(0, -'default.xex'.length);
      const files = gameFiles(chosen
        .filter((f) => f.path.startsWith(prefix))
        .map((f) => ({ ...f, path: f.path.slice(prefix.length) })));
      game = {
        kind: 'folder',
        name: prefix ? baseName(prefix.slice(0, -1)) : '',
        size: files.reduce((sum, f) => sum + f.size, 0),
        files,
      };
    }
  }
  return { game };
}

function fileNamed(files, name) {
  return files.find((f) => f.path.toLowerCase() === name.toLowerCase());
}

// Identifies the build: default.xex by its SHA-256, the game's other files by their sizes.
// Returns { xexHash, build, problems }.
export async function identifyGames(chosen, manifest) {
  const { game } = chosen;
  const xexFile = game && fileNamed(game.files, 'default.xex');
  if (!xexFile) {
    const error = new Error(t('noGame'));
    error.code = 'noGame';
    throw error;
  }
  const xexHash = await sha256(await xexFile.read(0, xexFile.size));
  const build = manifest.builds.find((b) => b.xex_sha256 === xexHash) || null;
  const problems = [];
  if (build) {
    for (const want of build.game_files) {
      const f = fileNamed(game.files, want.path);
      if (!f || f.size !== want.size) {
        problems.push('gameDifferent');
        break;
      }
    }
  }
  return { xexHash, build, problems };
}

// Every distinct shader container default.xex stores (lib/containers.js), in image order.
// Returns { containers: [{ stage, bytes, address, sha256 }], xexHash }.
export async function gameContainers(chosen, modules) {
  const xexFile = fileNamed(chosen.game.files, 'default.xex');
  const xex = await xexFile.read(0, xexFile.size);
  const { image } = await readXexImage(xex, lzxStep(modules.lzx));
  const containers = [];
  const seen = new Set();
  for (const c of imageContainers(image)) {
    const hash = await sha256(c.bytes);
    if (!seen.has(hash)) {
      seen.add(hash);
      containers.push({ ...c, sha256: hash });
    }
  }
  return { containers, xexHash: await sha256(xex) };
}

// The shaders of the Switch build's renderer (Renut on deko3d): deko3d_glsl.bin, which the NRO reads beside itself,
// made from the game's shader containers (lib/deko3d.js) and checked against the build's manifest entry ("deko3d":
// { shaders, containers_sha256, package_sha256 }).
// modules: { lzx, renutHlsl, dxc, spirvCross }; renutCommon: Renut's shader_common.h; onShader(done, total) after
// each shader.
export async function makeDeko3dPackage(chosen, build, modules, renutCommon, log = () => {}, onShader = () => {}) {
  const wanted = build.deko3d.containers_sha256;
  const containers = (await gameContainers(chosen, modules)).containers.filter((c) => wanted.includes(c.sha256));
  if (containers.length !== wanted.length) {
    throw new Error(t('deko3dContainers', { found: containers.length, wanted: wanted.length }));
  }
  log(t('deko3dShaders', { count: build.deko3d.shaders.length }));
  const { package: pkg } = await buildDeko3dPackage(containers, build.deko3d.shaders, modules, renutCommon, () => {},
    onShader);
  const hash = await sha256(pkg);
  if (hash !== build.deko3d.package_sha256) {
    throw new Error(t('deko3dMismatch', { hash }));
  }
  log(t('deko3dReady'));
  return pkg;
}

// chosen: findGames(); release: { manifest, nro, licenses, renutShaderCommon } (bytes)
// modules: { lzx, renutHlsl, dxc, spirvCross } instantiated Emscripten modules
// sink: { write(Uint8Array), close() } receiving the zip file
// onSize(bytes) is called with the exact size of the zip before the first byte is written.
// update: only the program, its licenses and the shaders, for a folder already on the SD card.
export async function createPackage(chosen, release, modules, sink, log = () => {}, progress = () => {},
  onSize = () => {}, { update = false } = {}) {
  const id = await identifyGames(chosen, release.manifest);
  const { build } = id;
  if (!build) {
    throw new Error(t('notSupportedYet', { hash: id.xexHash }));
  }
  if (id.problems.length) {
    throw new Error(t(id.problems[0]));
  }
  log(t('logBuild', { version: build.version }));
  if (update) {
    log(t('logUpdate'));
  }

  // The shaders first: they are the step most likely to stop the package, and nothing is written before them.
  const stage = (from, to) => (f) => progress(from + (to - from) * Math.min(Math.max(f, 0), 1));
  const shaderStage = stage(0, update ? 0.9 : 0.3);
  const deko3d = await makeDeko3dPackage(chosen, build, modules, release.renutShaderCommon, log,
    (done, total) => shaderStage(done / total));

  // game_root/: the game's files, as on the disc
  const gameEntries = update ? [] : chosen.game.files.map((f) => ({ path: `${ROOT}/game_root/${f.path}`, file: f }));
  const entries = [
    { path: `${ROOT}/ketsui.nro`, size: release.nro.length },
    { path: `${ROOT}/LICENSES.txt`, size: release.licenses.length },
    { path: `${ROOT}/deko3d_glsl.bin`, size: deko3d.length },
    ...gameEntries.map((e) => ({ path: e.path, size: e.file.size })),
  ];
  onSize(zipSize(entries));
  log(t('packing'));
  const total = gameEntries.reduce((n, e) => n + e.file.size, 0) || 1;
  const write = stage(update ? 0.9 : 0.3, 1);
  let done = 0;
  const onChunk = (chunk) => {
    done += chunk.length;
    write(done / total);
  };
  const zip = new ZipWriter(sink);
  await zip.addBytes(`${ROOT}/ketsui.nro`, release.nro);
  await zip.addBytes(`${ROOT}/LICENSES.txt`, release.licenses);
  await zip.addBytes(`${ROOT}/deko3d_glsl.bin`, deko3d);
  for (const e of gameEntries) {
    await zip.addFile(e.path, e.file.size, chunksOf(e.file), onChunk);
  }
  await zip.finish();
  progress(1);
  log(t('done'));
  return { version: build.version, update };
}
