// The shader containers a game stores in its executable (Xbox 360 XDK: +0 magic 0x102A1101 vertex / 0x102A1100
// pixel, +4 virtual (header) size, +8 microcode size, word aligned), found in the decompressed image of
// default.xex (Ketsui: 88 in its .rdata). From peggle2-nx-installer's lib/shaders.js (futari-nx's
// tools/extract_shaders.py); the rest of that file (Peggle 2's PC shader library) does not apply here.

const BASE = 0x82000000; // load address of default.xex: offset 0 of the decompressed image

function be32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

export async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// [{ stage: 'vs' | 'ps', bytes, address }] in image order (a container stored twice is found twice).
export function imageContainers(image) {
  const found = [];
  for (let off = 0; off < image.length - 12; off += 4) {
    const magic = be32(image, off);
    if (magic !== 0x102a1101 && magic !== 0x102a1100) {
      continue;
    }
    const header = be32(image, off + 4);
    const ucode = be32(image, off + 8);
    if (header < 12 || header > 1 << 16 || ucode === 0 || ucode > 1 << 20 || ucode % 4) {
      continue;
    }
    if (off + header + ucode > image.length) {
      continue;
    }
    found.push({ stage: magic === 0x102a1101 ? 'vs' : 'ps', bytes: new Uint8Array(image.subarray(off, off + header + ucode)),
      address: BASE + off });
  }
  return found;
}
