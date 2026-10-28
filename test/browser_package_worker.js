// The worker of test/browser_package.html: lib/installer.js's createPackage in this browser, the player's files read
// through HTTP range requests, the release NRO from release/, the zip counted and its size checked instead of saved.
import createDxcModule from '../wasm/dxc_web.mjs';
import createLzxModule from '../wasm/lzx.mjs';
import createRenutHlslModule from '../wasm/renut_hlsl.mjs';
import createSpirvCrossModule from '../wasm/spirv_cross.mjs';
import { createPackage, findGames } from '../lib/installer.js';

const log = (text) => postMessage({ type: 'log', text });
const quiet = () => ({ print: () => {}, printErr: () => {} });

async function httpFile(url, path) {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) {
    throw new Error(`${url}: ${head.status}`);
  }
  return {
    path,
    size: Number(head.headers.get('Content-Length')),
    async read(offset, length) {
      if (!length) {
        return new Uint8Array(0);
      }
      const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

const bytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

self.onmessage = async ({ data }) => {
  const t0 = performance.now();
  try {
    const chosen = await findGames(await Promise.all(data.files.map((p) => httpFile(`/_test/${p}`, p))));
    log(`found: game ${chosen.game ? `${chosen.game.kind}, ${chosen.game.files.length} files` : 'none'}`);
    const manifest = await (await fetch('../release/manifest.json')).json();
    const release = {
      manifest,
      nro: await bytes(`../release/${manifest.builds[0].nro}`),
      licenses: await bytes('../release/LICENSES.txt'),
      renutShaderCommon: await bytes('../renut_shader_common.h'),
    };
    const modules = {
      lzx: await createLzxModule(quiet()),
      renutHlsl: await createRenutHlslModule(quiet()),
      dxc: await createDxcModule(quiet()),
      spirvCross: await createSpirvCrossModule(quiet()),
    };
    let written = 0;
    let announced = 0;
    const sink = {
      async write(b) {
        written += b.length;
      },
      async close() {},
    };
    const at = () => `[${((performance.now() - t0) / 1000).toFixed(0)} s]`;
    const result = await createPackage(chosen, release, modules, sink, (t) => log(`${at()} ${t}`), () => {},
      (size) => (announced = size));
    postMessage({ type: 'done', text: `${at()} zip: ${written} bytes written, ${announced} announced; ${JSON.stringify(result)}` });
  } catch (e) {
    postMessage({ type: 'error', text: `${e.message}\n${e.stack}` });
  }
};
