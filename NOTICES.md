# Third-party notices

| Component | Where | License |
|---|---|---|
| [guwange-nx-installer](https://github.com/ChanseyIsTheBest/guwange-nx-installer) by ChanseyIsTheBest: this page's starting point (the page, the worker, the XEX reader set-up, the shader container scan, the deko3d shader chain with guwange-nx's passes, which ketsui-nx shares, the zip writer, the tests) | everything | GPL-3.0 |
| [futari-nx-installer](https://github.com/ChanseyIsTheBest/futari-nx-installer) by ChanseyIsTheBest: the disc image reader (`lib/xdvdfs.js`), the disc game's file selection, the deko3d shader chain of futari-nx's renderer (`lib/deko3d.js`, `lib/early_alpha.js`, `lib/deko3d_glsl.js`), the Japanese texts and the language flags | `lib/` | GPL-3.0 |
| [peggle1-nx-installer](https://github.com/ChanseyIsTheBest/peggle1-nx-installer), [peggle2-nx-installer](https://github.com/ChanseyIsTheBest/peggle2-nx-installer) and [sa2-nx-installer](https://github.com/ChanseyIsTheBest/sa2-nx-installer) by ChanseyIsTheBest: where those pages come from (the WebAssembly set-up, the shader container scan) | `lib/`, `wasm/` | GPL-3.0 |
| [nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND (commit `e7ec1b65`): the page's structure and style, the service worker (`sw.js`), the worker's download stream, the XEX reader (`lib/xex.js`), the zip writer (`lib/zip.js`), the language picker and its flags | `sw.js`, `worker.js`, `app.js`, `index.html`, `lib/` | GPL-3.0 |
| [DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) v2025.1 (commit `75a029d95`), unmodified, with its bundled SPIRV-Tools and SPIRV-Headers, and the `dxc_web.cpp` wrapper, as built by nfsmw-nx-installer | `wasm/dxc_web.*` | University of Illinois/NCSA Open Source License (LLVM); SPIRV-Tools: Apache-2.0; SPIRV-Headers: MIT; the wrapper: GPL-3.0 |
| Renut's shader translator: XenosRecomp ([hedge-dev](https://github.com/hedge-dev/XenosRecomp) and contributors) in [reNut](https://github.com/masterspike52/reNut)'s version (reNut and masterspike52), as banjo-nx, futari-nx, guwange-nx and ketsui-nx carry it, with peggle2-nx's front end (`tools/renut_hlsl_frontend.cpp`) | `wasm/renut_hlsl.*`, `renut_shader_common.h` | XenosRecomp: MIT; reNut: reuse permitted by its author |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) (commit `22b22f56`), unmodified | `wasm/spirv_cross.*` | Apache-2.0 |
| [libmspack](https://www.cabextract.org.uk/libmspack/) by Stuart Caie (LZX decoder) | `wasm/lzx.*` | LGPL-2.1 |
| [Emscripten](https://emscripten.org) runtime and the musl libc it links | `wasm/*.mjs`, `wasm/*.wasm` | MIT and the University of Illinois/NCSA Open Source License |

`wasm/lzx.*` is built from the futari-nx repository with its `shaders/wasm/build_wasm_tools.sh` (Emscripten 6.0.11).
libmspack is covered by the GNU Lesser General Public License 2.1: the module is built from its unmodified sources
(`lzxd.c` and `system.c`, at the commit pinned by ReXGlue SDK v0.10.0), so with those sources it can be rebuilt and
replaced by a modified version. `wasm/renut_hlsl.*` and `wasm/spirv_cross.*` are built with
`wasm/src/deko3d/build_wasm_deko3d.sh`.

The licenses of the software in the package (the NRO and its libraries) are in [release/LICENSES.txt](release/LICENSES.txt),
and the source code with its license is at https://github.com/ChanseyIsTheBest/ketsui-nx.
