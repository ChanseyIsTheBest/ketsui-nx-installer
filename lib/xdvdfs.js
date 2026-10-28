// Reads the files of an Xbox 360 disc image (XDVDFS), in place: nothing is extracted to disk.
//
// A full dump (Redump) holds a video partition first and the game partition further on; an image rebuilt by
// extract-xiso or similar tools starts with the game partition. The game partition's volume descriptor is sector 32
// (2048-byte sectors): "MICROSOFT*XBOX*MEDIA", the root directory's sector and size (little-endian), and the magic
// again at its end. A directory is a table of entries forming a binary search tree: left and right child offsets (in
// 4-byte units from the table's start), the file's sector and size, its attributes (0x10 = directory) and its name.

const SECTOR = 2048;
const MAGIC = 'MICROSOFT*XBOX*MEDIA';
// where the game partition starts: rebuilt image, XGD2 (most Xbox 360 discs), XGD3, XGD1
const PARTITIONS = [0, 0xfd90000, 0x2080000, 0x18300000];

function u16(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function u32(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function text(data, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(data[offset + i]);
  }
  return s;
}

// The game partition's offset in an image, or -1. file: { size, read(offset, length) -> Promise<Uint8Array> }
export async function findPartition(file) {
  for (const base of PARTITIONS) {
    const at = base + 32 * SECTOR;
    if (at + SECTOR > file.size) {
      continue;
    }
    const sector = await file.read(at, SECTOR);
    if (text(sector, 0, 20) === MAGIC && text(sector, 0x7ec, 20) === MAGIC) {
      return base;
    }
  }
  return -1;
}

// Every file of the image: [{ path, size, read }], paths relative to the disc's root with '/' separators.
export async function listFiles(file) {
  const base = await findPartition(file);
  if (base < 0) {
    return null;
  }
  const volume = await file.read(base + 32 * SECTOR, SECTOR);
  const files = [];
  const seenTables = new Set();
  const walk = async (sector, size, prefix) => {
    const where = base + sector * SECTOR;
    if (!size || seenTables.has(where) || where + size > file.size || size > 64 * 1024 * 1024) {
      return;
    }
    seenTables.add(where);
    const table = await file.read(where, size);
    const visited = new Set();
    const stack = [0];
    while (stack.length) {
      const offset = stack.pop();
      if (visited.has(offset) || offset + 14 > table.length) {
        continue;
      }
      visited.add(offset);
      const left = u16(table, offset);
      const right = u16(table, offset + 2);
      if (left === 0xffff && right === 0xffff) {
        continue; // padding to the end of a sector
      }
      const start = u32(table, offset + 4);
      const length = u32(table, offset + 8);
      const attributes = table[offset + 12];
      const nameLength = table[offset + 13];
      if (offset + 14 + nameLength > table.length) {
        continue;
      }
      const name = text(table, offset + 14, nameLength);
      if (left && left !== 0xffff) {
        stack.push(left * 4);
      }
      if (right && right !== 0xffff) {
        stack.push(right * 4);
      }
      if (!name) {
        continue;
      }
      const path = prefix + name;
      if (attributes & 0x10) {
        await walk(start, length, path + '/');
      } else {
        const at = base + start * SECTOR;
        if (at + length <= file.size) {
          files.push({ path, size: length, read: (o, n) => file.read(at + o, n) });
        }
      }
    }
  };
  await walk(u32(volume, 20), u32(volume, 24), '');
  return files;
}
