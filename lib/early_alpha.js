// The early alpha copies of Renut's alpha-tested pixel shaders (banjo-nx's banjo_gpu_early_alpha, package 27): a port
// of futari-nx's tools/renut_early_alpha.py + tools/early_alpha.py, the step the native build runs between the
// translator's two runs (app/src/renut_engine/gpu/gpu.cmake, BANJO_RENUT_EARLY_ALPHA): a pixel shader whose alpha needs
// only a few early texture fetches gets bool banjoEarlyAlphaFails(...), a copy of that slice, and at the earliest
// point main() can call it a site that discards a 2x2 quad whose four pixels all fail the alpha test there.
//
// renutEarlyAlpha(name, hlsl) -> { hlsl, status, info }: hlsl is the text the Python tool leaves in the file
// <name>.hlsl (the shader's own text when it makes no copy), status its verdict ('copied', 'little', 'differs',
// 'unsupported') and info the dict of its report line (formatInfo() writes it as Python does). name is the dump's file
// name, with or without '.hlsl': it seeds the self-check, as the file name does. A JavaScript error means the Python
// tool would stop there too.
//
// A line-for-line port: the same regular expressions (with Python's whitespace for \s and strip()), the same slicing,
// planning and emission, dicts as Maps (insertion order), and Python's error behaviour (IndexError, StopIteration and
// RecursionError make a shader unsupported as in renut_early_alpha.py; the errors that stop the Python tool throw).
// Assumes ASCII identifiers (the translator writes ASCII), where Python's \w \d \b are Unicode-aware.
//
// The self-check (the copy run against main() on random registers, fetch results, constants and bools; a copy that
// differs once is dropped) is ported, not stubbed: CPython's Mersenne Twister with its int seeding and random(),
// uniform(), choice(), getrandbits(); zlib.crc32; repr() of the floats that key each fetch's random texels; the
// iteration order of CPython's int sets (it orders the draws of the constants and bools); numpy's float32 arithmetic
// (Math.fround: +, -, *, /, sqrt are correctly rounded either way) and its fmax/fmin/sign/rint. One part is not
// bit-exact: numpy's float32 sin, cos, exp2 and log2 (its own SIMD code and the C library's, platform-dependent in
// Python too) are Math.fround(Math.sin(x)) and so on here, so a trial in which such a value keys a fetch or takes a
// branch may follow another path than Python's. The text never depends on the trials when the check passes (only the
// verdict does), and a correct copy passes on any inputs: on futari-nx's 24 pixel shaders (13 copies) and banjo-nx's
// 3936 every verdict, report line and text is the Python tool's (test/early_alpha_node.mjs).

const MARK = 'banjo_gpu_early_alpha';
const BIG = 2 ** 40;           // the guard on constants a bound relies on
const FINITE = 2 ** 100;       // a bound below this is finite in float32
const MAX_COPY = 160;          // statements in a copy
const MIN_FETCHES_SKIPPED = 2;
const MIN_STATEMENTS_SKIPPED = 24;

class Unsupported extends Error {}
class PyIndexError extends Error {}
class PyStopIteration extends Error {}
class PyValueError extends Error {}

function stop(what) {
  return new Error(`early_alpha: ${what} (where tools/early_alpha.py stops)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Python's str semantics
const PY_SPACE = new Set([9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
const PY_SPACE_CLASS = String.raw`[\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0  -     　]`;

function pyLstrip(s) {
  let a = 0;
  while (a < s.length && PY_SPACE.has(s.charCodeAt(a))) a++;
  return s.slice(a);
}

function pyRstrip(s) {
  let b = s.length;
  while (b > 0 && PY_SPACE.has(s.charCodeAt(b - 1))) b--;
  return s.slice(0, b);
}

function pyStrip(s) {
  return pyRstrip(pyLstrip(s));
}

// A Python pattern (\s is Python's whitespace; '.' never meets a newline here, the 's' flag makes it Python's '.').
function pyRe(src, flags = '') {
  return new RegExp(src.replaceAll(String.raw`\s`, PY_SPACE_CLASS), flags);
}

function pyIndex(seq, i) {
  if (i < 0) i += seq.length;
  if (i < 0 || i >= seq.length) throw new PyIndexError('IndexError');
  return seq[i];
}

function nextIndex(seq, from, pred) {  // next(i for i in range(from, len(seq)) if pred(seq[i]))
  for (let i = from; i < seq.length; i++) {
    if (pred(seq[i])) return i;
  }
  throw new PyStopIteration('StopIteration');
}

function countChar(s, ch) {
  let n = 0;
  for (let i = s.indexOf(ch); i >= 0; i = s.indexOf(ch, i + 1)) n++;
  return n;
}

function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pyMax(values) {  // max(): the first of the largest (a NaN first stays)
  if (!values.length) throw stop('ValueError: max() of an empty sequence');
  let m = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > m) m = values[i];
  }
  return m;
}

function pyMax2(a, b) {
  return b > a ? b : a;
}

function pyMin2(a, b) {
  return b < a ? b : a;
}

function union(...sets) {
  const out = new Set();
  for (const s of sets) {
    for (const x of s) out.add(x);
  }
  return out;
}

function intersects(a, b) {
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

function firstOf(set) {
  return set.values().next().value;
}

function pyFloat(t) {  // float() of a token
  if (/^(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(t)) return Number(t);
  throw new PyValueError(`could not convert string to float: ${t}`);
}

function pyIntHex(t) {  // int(t, 16)
  const s = pyStrip(t);
  if (!/^[+-]?(?:0[xX])?_?[0-9a-fA-F](?:_?[0-9a-fA-F])*$/.test(s)) {
    throw new PyValueError(`invalid literal for int() with base 16: ${t}`);
  }
  const neg = s.startsWith('-');
  const digits = s.replace(/^[+-]/, '').replace(/^0[xX]/, '').replaceAll('_', '');
  const v = BigInt('0x' + digits);
  return neg ? -v : v;
}

function pyIntDec(t) {  // int(t)
  if (!/^\d+$/.test(t)) throw stop(`ValueError: invalid literal for int(): ${t}`);
  return parseInt(t, 10);
}

const F32 = new DataView(new ArrayBuffer(4));

function f32FromBits(w) {  // struct.unpack('<f', struct.pack('<I', w))[0]
  if (w < 0n || w > 0xffffffffn) throw stop('struct.error: argument out of range');
  F32.setUint32(0, Number(w));
  return F32.getFloat32(0);
}

function f32Bits(x) {
  F32.setFloat32(0, x);
  return F32.getUint32(0);
}

function pyStrRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += ch;
  }
  return out + q;
}

// The shortest digits of a positive finite double, and the exponent of the first: value = 0.d1d2... * 10^(e + 1).
function decimalDigits(x) {
  const s = String(x);
  const k = s.indexOf('e');
  const mant = k >= 0 ? s.slice(0, k) : s;
  const dot = mant.indexOf('.');
  const intPart = dot >= 0 ? mant.slice(0, dot) : mant;
  let digits = intPart + (dot >= 0 ? mant.slice(dot + 1) : '');
  let e = (k >= 0 ? parseInt(s.slice(k + 1), 10) : 0) + intPart.length - 1;
  const lead = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(lead).replace(/0+$/, '');
  e -= lead;
  return [digits, e];
}

function formatDigits(sign, digits, e, positional) {
  if (positional) {
    if (e >= 0) {
      if (digits.length <= e + 1) return sign + digits + '0'.repeat(e + 1 - digits.length) + '.0';
      return sign + digits.slice(0, e + 1) + '.' + digits.slice(e + 1);
    }
    return sign + '0.' + '0'.repeat(-e - 1) + digits;
  }
  return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') +
    String(Math.abs(e)).padStart(2, '0');
}

function pyFloatRepr(x) {  // repr() of a Python float
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [digits, e] = decimalDigits(Math.abs(x));
  return formatDigits(x < 0 ? '-' : '', digits, e, e >= -4 && e < 16);
}

function npStr(x) {  // str() of a numpy float32 (numpy 2: positional from 1e-4 up to 1e6)
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const ax = Math.abs(x);
  let shortest = ax;
  for (let p = 1; p <= 9; p++) {
    const c = Number(ax.toPrecision(p));
    if (Math.fround(c) === ax) {
      shortest = c;
      // An exact tie at the last digit: toPrecision rounds it up, numpy's Dragon4 to the even digit.
      const [mant, exp] = ax.toExponential(100).split('e');
      const exact = mant.replace('.', '');
      if (exact[p] === '5' && /^0*$/.test(exact.slice(p + 1)) && Number(exact[p - 1]) % 2 === 0) {
        const down = Number(`${exact.slice(0, p)}e${Number(exp) - p + 1}`);
        if (Math.fround(down) === ax) shortest = down;
      }
      break;
    }
  }
  const [digits, e] = decimalDigits(shortest);
  return formatDigits(x < 0 ? '-' : '', digits, e, ax < 1e6 && ax >= 1e-4);
}

function npRepr(x) {  // repr() of a numpy float32 (numpy 2)
  return `np.float32(${npStr(x)})`;
}

// The report's dict, as Python prints it.
export function formatInfo(info) {
  return '{' + Object.entries(info).map(([k, v]) => `${pyStrRepr(k)}: ${typeof v === 'string' ? pyStrRepr(v) : String(v)}`)
    .join(', ') + '}';
}

// ---------------------------------------------------------------------------------------------------------------------
// CPython's random.Random (MT19937, init_by_array seeding of an int), zlib.crc32, and its set of ints (setobject.c:
// linear probes, then perturbation) for the order its iteration gives.
class PyRandom {
  constructor(seed) {
    let n = BigInt(seed);
    if (n < 0n) n = -n;
    const key = [];
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    if (!key.length) key.push(0);
    this.mt = new Uint32Array(624);
    this.index = 624;
    this.initByArray(key);
  }

  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.index = 624;
  }

  initByArray(key) {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  next32() {
    const mt = this.mt;
    if (this.index >= 624) {
      let kk = 0;
      let y;
      for (; kk < 624 - 397; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < 623; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.next32() >>> 5;
    const b = this.next32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  getrandbits(k) {  // 1 <= k <= 32
    return this.next32() >>> (32 - k);
  }

  randbelow(n) {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice(seq) {
    return seq[this.randbelow(seq.length)];
  }

  uniform(a, b) {
    return a + (b - a) * this.random();
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const UTF8 = new TextEncoder();

function crc32(text) {  // zlib.crc32(text.encode())
  let c = 0xffffffff;
  for (const b of UTF8.encode(text)) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class PyIntSet {  // a set of small non-negative ints (hash = the int)
  constructor() {
    this.table = new Array(8).fill(null);
    this.mask = 7;
    this.fill = 0;
    this.used = 0;
  }

  add(key) {
    const mask = this.mask;
    let i = key & mask;
    let perturb = key;
    for (;;) {
      const probes = i + 9 <= mask ? 9 : 0;
      for (let p = 0; p <= probes; p++) {
        const e = this.table[i + p];
        if (e === null) {
          this.table[i + p] = key;
          this.fill++;
          this.used++;
          if (this.fill * 5 >= mask * 3) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
          return;
        }
        if (e === key) return;
      }
      perturb = Math.floor(perturb / 32);
      i = (i * 5 + 1 + perturb) & mask;
    }
  }

  resize(minused) {
    let size = 8;
    while (size <= minused) size *= 2;
    const old = this.table;
    this.table = new Array(size).fill(null);
    this.mask = size - 1;
    this.fill = this.used;
    for (const key of old) {
      if (key !== null) this.insertClean(key);
    }
  }

  insertClean(key) {
    const mask = this.mask;
    let i = key & mask;
    let perturb = key;
    for (;;) {
      if (this.table[i] === null) {
        this.table[i] = key;
        return;
      }
      if (i + 9 <= mask) {
        for (let j = 1; j <= 9; j++) {
          if (this.table[i + j] === null) {
            this.table[i + j] = key;
            return;
          }
        }
      }
      perturb = Math.floor(perturb / 32);
      i = (i * 5 + 1 + perturb) & mask;
    }
  }

  *[Symbol.iterator]() {
    for (const key of this.table) {
      if (key !== null) yield key;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Renut's forms (renut_early_alpha.py's patches of early_alpha.py)
const CONST_RE = /g_C\((\d+)\)/g;

function constText(n) {
  return `g_C(${n})`;
}

// Renut's per-draw values main() reads directly (shared constants).
const UNIFORM_WIDTHS = new Map([['g_ResolutionScale', 1], ['g_ViewportSize', 2], ['g_ScreenOffset', 2],
  ['g_ScreenScale', 2], ['g_PixelOrigin', 2]]);
const UNIFORM_VECTORS = new Set(['ColorFactor', 'SolidColor', ...UNIFORM_WIDTHS.keys()]);
// Futari's named samplers' slot macros.
const SAMPLER_SLOT_RE = /^(?:\w+_(?:Texture2D|Texture3D|TextureCube|Sampler)DescriptorIndex$|\w+_InvSize$)/;

// ---------------------------------------------------------------------------------------------------------------------
// Expressions
const TOKEN_RE = pyRe(String.raw`\s*(?:(?<hex>0x[0-9A-Fa-f]+u?)|(?<num>(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)|` +
  String.raw`(?<id>[A-Za-z_]\w*)|(?<op>&&|\|\||==|!=|<=|>=|[-+*/?:<>!(),.]))`, 'y');
const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/']];
const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const FETCHES = new Set(['tfetch1D', 'tfetch2D', 'tfetch3D', 'tfetchCube', 'tfetch2DBicubic', 'getWeights2D']);
const COMPONENTWISE = new Set(['saturate', 'abs', 'rsqrt', 'rcp', 'sqrt', 'exp2', 'log2', 'frac', 'floor', 'ceil',
  'trunc', 'round', 'sign', 'sin', 'cos', 'clamp', 'min', 'max', 'select', 'isnan']);
const CONSTRUCTORS = new Map([['float', 1], ['float2', 2], ['float3', 3], ['float4', 4], ['bool', 1]]);
const SCALAR_NAMES = new Map([['FLT_MIN', -3.4028234663852886e38], ['FLT_MAX', 3.4028234663852886e38],
  ['BANJO_FLT_LO', -3.4028234663852886e38], ['BANJO_FLT_HI', 3.4028234663852886e38]]);
const EMPTY = new Set();  // a frozenset(): never added to

function tokenize(s) {
  const out = [];
  let pos = 0;
  s = pyRstrip(s);
  while (pos < s.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(s);
    if (!m) throw new Unsupported('token: ' + s.slice(pos, pos + 24));
    pos = m.index + m[0].length;
    const g = m.groups;
    const kind = g.hex !== undefined ? 'hex' : g.num !== undefined ? 'num' : g.id !== undefined ? 'id' : 'op';
    out.push([kind, g[kind]]);
  }
  return out;
}

function pyNone(v) {
  return v === null ? 'None' : v;
}

class Parser {
  constructor(text) {
    this.t = tokenize(text);
    this.i = 0;
  }

  peek() {
    return this.i < this.t.length ? this.t[this.i] : [null, null];
  }

  at(v) {
    const [k, x] = this.peek();
    return k === 'op' && x === v;
  }

  take(v = null) {
    const [k, x] = this.peek();
    if (k === null || (v !== null && x !== v)) throw new Unsupported(`expected ${pyNone(v)}, found ${pyNone(x)}`);
    this.i++;
    return [k, x];
  }

  whole() {
    const n = this.expr();
    if (this.i !== this.t.length) {
      const [k, x] = this.peek();
      throw new Unsupported(`trailing (${pyStrRepr(k)}, ${pyStrRepr(x)})`);
    }
    return n;
  }

  expr() {
    const c = this.binary(0);
    if (this.at('?')) {
      this.take('?');
      const a = this.expr();
      this.take(':');
      return ['tern', c, a, this.expr()];
    }
    return c;
  }

  binary(level) {
    if (level === LEVELS.length) return this.unary();
    let a = this.binary(level + 1);
    while (this.peek()[0] === 'op' && LEVELS[level].includes(this.peek()[1])) {
      const op = this.take()[1];
      a = ['bin', op, a, this.binary(level + 1)];
    }
    return a;
  }

  unary() {
    if (this.at('-') || this.at('!')) {
      const op = this.take()[1];
      return ['un', op, this.unary()];
    }
    let n = this.primary();
    while (this.at('.')) {
      this.take('.');
      const [k, v] = this.take();
      if (k !== 'id' || !/^[xyzw]{1,4}$/.test(v)) throw new Unsupported('member ' + v);
      n = ['swz', n, v];
    }
    return n;
  }

  primary() {
    const [k, v] = this.peek();
    // renut_early_alpha.py: asfloat(0x...u), a literal, as early_alpha's own literal declarations hold them.
    if (k === 'id' && v === 'asfloat' && this.i + 3 < this.t.length && this.t[this.i + 1][0] === 'op' &&
        this.t[this.i + 1][1] === '(' && this.t[this.i + 2][0] === 'hex' && this.t[this.i + 3][0] === 'op' &&
        this.t[this.i + 3][1] === ')') {
      const word = this.t[this.i + 2][1];
      this.i += 4;
      return ['num', `asfloat(${word.endsWith('u') ? word : word + 'u'})`];
    }
    if (k === 'op' && v === '(') {
      this.take();
      const n = this.expr();
      this.take(')');
      return n;
    }
    if (k === 'num' || k === 'hex') {
      this.take();
      return ['num', v];
    }
    if (k === 'id') {
      this.take();
      if (this.at('(')) {
        this.take('(');
        const args = [];
        if (!this.at(')')) {
          args.push(this.expr());
          while (this.at(',')) {
            this.take(',');
            args.push(this.expr());
          }
        }
        this.take(')');
        // The translator's branch-free forms (shader_common.h): the same trees as && / || / ?: before.
        if (['and', 'or', 'banjoAnd', 'banjoOr'].includes(v) && args.length === 2) {
          return ['bin', v === 'and' || v === 'banjoAnd' ? '&&' : '||', args[0], args[1]];
        }
        if (v === 'banjoSel' && args.length === 3) return ['tern', args[0], args[1], args[2]];
        if (v === 'banjoSel0' && args.length === 2) return ['tern', args[0], ['num', '0.0'], args[1]];
        return ['call', v, args];
      }
      const m = /^__C(\d+)$/.exec(v);
      if (m) return ['const', parseInt(m[1], 10)];
      if (v === 'true' || v === 'false') return ['num', v === 'true' ? '1.0' : '0.0'];
      return ['var', v];
    }
    throw new Unsupported(`primary ${pyNone(k)} ${pyNone(v)}`);
  }
}

function isUniformName(name) {
  // Texture slot macros, cubeMapData and the per-draw constant vectors (early_alpha.py), and Futari's named samplers'
  // slot macros (renut_early_alpha.py).
  return /^s\d+_/.test(name) || name === 'cubeMapData' || UNIFORM_VECTORS.has(name) || SAMPLER_SLOT_RE.test(name);
}

function varWidth(name) {
  // renut_early_alpha.py's
  if (UNIFORM_WIDTHS.has(name)) return UNIFORM_WIDTHS.get(name);
  if (name === 'lod' || /^pb\d+$/.test(name)) return 1;
  if (/^i(?:Normal|Tangent|Binormal)\d$/.test(name)) return 4;
  if (name === 'iPointCoord') return 2;
  // early_alpha.py's
  if (name.endsWith('_InvSize') && isUniformName(name)) return 2;
  if (UNIFORM_VECTORS.has(name)) return 4;
  if (name === 'ps' || name === 'p0' || name === 'iFace' || SCALAR_NAMES.has(name) || name.startsWith('banjoTmp') ||
      name.startsWith('me_alu_') || isUniformName(name)) {
    return 1;
  }
  if (/^(?:r\d+|c\d+|oC\d|iTexCoord\d+|iColor\d+|iPos)$/.test(name)) return 4;
  throw new Unsupported('variable ' + name);
}

function width(n) {
  const t = n[0];
  if (t === 'num') return 1;
  if (t === 'var') return varWidth(n[1]);
  if (t === 'const') return 4;
  if (t === 'swz') {
    width(n[1]);
    return n[2].length;
  }
  if (t === 'un') return width(n[2]);
  if (t === 'bin') {
    if (n[1] === '&&' || n[1] === '||') {
      if (width(n[2]) !== 1 || width(n[3]) !== 1) throw new Unsupported('vector logic');
      return 1;
    }
    return Math.max(width(n[2]), width(n[3]));
  }
  if (t === 'tern') {
    if (width(n[1]) !== 1) throw new Unsupported('vector condition');
    return Math.max(width(n[2]), width(n[3]));
  }
  if (t === 'call') {
    const [, f, args] = n;
    if (FETCHES.has(f)) return f !== 'getWeights2D' ? 4 : 2;
    if (f === 'dot' || f === 'max4' || f === 'BANJO_BOOL') return 1;
    if (CONSTRUCTORS.has(f)) {
      let sum = 0;
      for (const a of args) sum += width(a);
      if (sum !== CONSTRUCTORS.get(f) && !(args.length === 1 && width(args[0]) === 1)) {
        throw new Unsupported('constructor');
      }
      return CONSTRUCTORS.get(f);
    }
    if (COMPONENTWISE.has(f)) return pyMax(args.map(width));
    return 4;  // an unknown call (cube, dst, ...): opaque, never copied
  }
  throw new Unsupported('node ' + t);
}

function bc(n, i) {  // component i of n, a scalar broadcast
  return width(n) === 1 ? comp(n, 0) : comp(n, i);
}

// The scalar expression of component i of n. Leaves: ['vc', var, c], ['sv', var], ['cc', const, c], ['num', t],
// ['bb', n]; opaque: ['opq', call node, i] (fetches and unknown calls).
function comp(n, i) {
  const t = n[0];
  if (t === 'num') return n;
  if (t === 'var') return varWidth(n[1]) === 1 ? ['sv', n[1]] : ['vc', n[1], pyIndex('xyzw', i)];
  if (t === 'const') return ['cc', n[1], pyIndex('xyzw', i)];
  if (t === 'swz') return comp(n[1], 'xyzw'.indexOf(pyIndex(n[2], i)));
  if (t === 'un') return ['un', n[1], bc(n[2], i)];
  if (t === 'bin') return ['bin', n[1], bc(n[2], i), bc(n[3], i)];
  if (t === 'tern') return ['tern', comp(n[1], 0), bc(n[2], i), bc(n[3], i)];
  if (t === 'call') {
    const [, f, args] = n;
    if (f === 'BANJO_BOOL') {
      if (args.length !== 1 || args[0][0] !== 'num') throw new Unsupported('BANJO_BOOL');
      return ['bb', pyIntDec(args[0][1])];
    }
    if (f === 'dot') {
      if (args.length !== 2) throw stop('ValueError: dot() of ' + args.length);
      const [a, b] = args;
      const w = width(a);
      if (width(b) !== w) throw new Unsupported('dot widths');
      const ca = [];
      for (let j = 0; j < w; j++) ca.push(comp(a, j));
      const cb = [];
      for (let j = 0; j < w; j++) cb.push(comp(b, j));
      return ['dot', ca, cb];
    }
    if (f === 'max4') {
      const a = pyIndex(args, 0);
      const out = [];
      for (let j = 0; j < 4; j++) out.push(bc(a, j));
      return ['max4', out];
    }
    if (CONSTRUCTORS.has(f)) {
      if (args.length === 1 && width(args[0]) === 1) return comp(args[0], 0);
      const flat = [];
      for (const a of args) {
        const w = width(a);
        for (let j = 0; j < w; j++) flat.push(comp(a, j));
      }
      return pyIndex(flat, i);
    }
    if (COMPONENTWISE.has(f)) return ['call', f, args.map((a) => bc(a, i))];
    return ['opq', n, i];
  }
  throw new Unsupported('node ' + t);
}

function fullReads(n) {  // every component a (vector) node reads
  const out = new Set();
  const w = width(n);
  for (let i = 0; i < w; i++) {
    for (const r of reads(comp(n, i))) out.add(r);
  }
  return out;
}

function reads(s) {
  const t = s[0];
  if (t === 'vc') return isUniformName(s[1]) ? new Set() : new Set([`${s[1]}.${s[2]}`]);
  if (t === 'sv') return SCALAR_NAMES.has(s[1]) || isUniformName(s[1]) ? new Set() : new Set([s[1]]);
  if (t === 'cc' || t === 'num' || t === 'bb') return new Set();
  if (t === 'opq') return union(...s[1][2].map(fullReads));
  if (t === 'un') return reads(s[2]);
  if (t === 'bin') return union(reads(s[2]), reads(s[3]));
  if (t === 'tern') return union(reads(s[1]), reads(s[2]), reads(s[3]));
  if (t === 'call') return union(...s[2].map(reads));
  if (t === 'dot') return union(...[...s[1], ...s[2]].map(reads));
  if (t === 'max4') return union(...s[1].map(reads));
  throw new Unsupported('reads ' + t);
}

// Fetches a copy may repeat (see markFetchOk): the same texture, sampler and coordinates give the same texels.
const HOISTABLE = new Set(['tfetch1D', 'tfetch2D', 'tfetch3D']);

function copyable(s, fetchOk = false) {
  const t = s[0];
  if (t === 'opq') {
    if (!(fetchOk && HOISTABLE.has(s[1][1]))) return false;
    for (const a of s[1][2]) {
      const w = width(a);
      for (let j = 0; j < w; j++) {
        if (!copyable(comp(a, j), fetchOk)) return false;
      }
    }
    return true;
  }
  if (t === 'vc' || t === 'sv' || t === 'cc' || t === 'num' || t === 'bb') return true;
  if (t === 'un') return copyable(s[2], fetchOk);
  if (t === 'bin') return copyable(s[2], fetchOk) && copyable(s[3], fetchOk);
  if (t === 'tern') return copyable(s[1], fetchOk) && copyable(s[2], fetchOk) && copyable(s[3], fetchOk);
  if (t === 'call') return s[2].every((a) => copyable(a, fetchOk));
  if (t === 'dot') return [...s[1], ...s[2]].every((a) => copyable(a, fetchOk));
  if (t === 'max4') return s[1].every((a) => copyable(a, fetchOk));
  return false;
}

function emitVector(n) {
  if (n[0] === 'var' && isUniformName(n[1])) return n[1];
  const w = width(n);
  if (w === 1) return emit(comp(n, 0));
  const parts = [];
  for (let j = 0; j < w; j++) parts.push(emit(comp(n, j)));
  return `float${w}(${parts.join(', ')})`;
}

// A fetch can be repeated earlier, with the same implicit derivatives, when every if around it tests uniform values
// only and no lane can have left before it (no kill, no alpha clip, no return under a per-pixel condition).
function markFetchOk(stmts, enclosingUniform, state) {
  for (const s of stmts) {
    s.fetchOk = enclosingUniform && !state.blocked;
    if (s.kind === 'kill' || s.kind === 'aclip') {
      state.blocked = true;
    } else if (s.kind === 'if') {
      const uniform = reads(s.cond).size === 0;
      markFetchOk(s.body, enclosingUniform && uniform, state);
      if (!uniform && [...walk(s.body)].some((x) => x.kind === 'ret' || x.kind === 'aclip' || x.kind === 'kill')) {
        state.blocked = true;
      }
    }
  }
}

function emit(s) {
  const t = s[0];
  if (t === 'num') return s[1];
  if (t === 'vc') return `${s[1]}.${s[2]}`;
  if (t === 'sv') return s[1];
  if (t === 'cc') return `__C${s[1]}.${s[2]}`;
  if (t === 'bb') return `BANJO_BOOL(${s[1]})`;
  if (t === 'un') return `(${s[1]}${emit(s[2])})`;
  if (t === 'bin') {
    if (s[1] === '&&' || s[1] === '||') {  // no short-circuit branch (see banjoSel in shader_common.h)
      return `${s[1] === '&&' ? 'banjoAnd' : 'banjoOr'}(${emit(s[2])}, ${emit(s[3])})`;
    }
    return `(${emit(s[2])} ${s[1]} ${emit(s[3])})`;
  }
  if (t === 'tern') return `banjoSel(${emit(s[1])}, ${emit(s[2])}, ${emit(s[3])})`;
  if (t === 'call') return `${s[1]}(${s[2].map(emit).join(', ')})`;
  if (t === 'dot') {
    const w = s[1].length;
    if (w === 1) return `(${emit(s[1][0])} * ${emit(s[2][0])})`;
    return `dot(float${w}(${s[1].map(emit).join(', ')}), float${w}(${s[2].map(emit).join(', ')}))`;
  }
  if (t === 'max4') return `max4(float4(${s[1].map(emit).join(', ')}))`;
  if (t === 'opq' && HOISTABLE.has(s[1][1])) {
    return `${s[1][1]}(${s[1][2].map(emitVector).join(', ')}).${pyIndex('xyzw', s[2])}`;
  }
  throw new Unsupported('emit ' + t);
}

// ---------------------------------------------------------------------------------------------------------------------
// Statements
const ALPHA_CLIP_RE = pyRe(String.raw`^\[branch\] if \(g_SpecConstants\(\) & SPEC_CONSTANT_ALPHA_TEST\)\s*\{\s*` +
  String.raw`clip\(alphaTestValue\(oC0\.w\)\);$`);
const BLEND_SKIP_RE = pyRe(String.raw`^if \(\(g_SpecConstants\(\) & SPEC_CONSTANT_BLEND_SKIP_(ALPHA|ZERO)\) != 0 && .*\) ` +
  String.raw`discard;$`, 's');
const KILL_RE = pyRe(String.raw`^clip\((?:banjoSel\((.*), -1, 1\)|(.*) \? -1 : 1)\);$`, 's');
const DECL_RE = pyRe(String.raw`^(float4|float|bool|int|uint|CubeMapData)\s+(\w+)\s*=\s*(.*);$`, 's');
// renut_early_alpha.py's: the block predicates are assigned in the copies too (`pbN = p0;`).
const ASSIGN_RE = pyRe(String.raw`^(r\d+|oC\d|ps|p0|banjoTmp\d+|pb\d+)(?:\.([xyzw]{1,4}))?\s*=\s*(.*);$`, 's');
const LITERAL_RE = new RegExp(String.raw`^(?:asfloat\(uint4\(|BANJO_LITERAL_(?:PS|VS)\(\d+, )(0x[0-9A-Fa-f]+), ` +
  String.raw`(0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+), (0x[0-9A-Fa-f]+)(?:\)\)|, \d+\))$`);

class Stmt {
  constructor(kind, line, kw = {}) {
    this.kind = kind;
    this.line = line;
    this.end = line;
    this.dest = null;
    this.comps = null;  // Map component ('' for a scalar) -> scalar expression
    this.cond = null;
    this.body = null;
    this.pre = null;
    this.literal = null;
    this.decl = false;
    this.fetchOk = false;
    Object.assign(this, kw);
  }
}

function compName(dest, c) {
  return dest + (c ? '.' + c : '');
}

function makeAssign(dest, mask, text, line) {
  const node = new Parser(text).whole();
  const w = width(node);
  if (mask === null || mask === undefined) mask = varWidth(dest) === 1 ? '' : 'xyzw';
  if (mask === '') {
    if (w !== 1) throw new Unsupported('scalar from vector');
    return new Stmt('assign', line, { dest, comps: new Map([['', comp(node, 0)]]) });
  }
  if (w !== 1 && w < mask.length) throw new Unsupported(`width ${w} into .${mask}`);
  // (a wider value is truncated to its first components, as HLSL does)
  const comps = new Map();
  for (let j = 0; j < mask.length; j++) comps.set(mask[j], bc(node, j));
  return new Stmt('assign', line, { dest, comps });
}

// The statements of lines[first:last] (the inside of main's braces): the top-level list.
function parseBody(lines, first, last) {
  const root = [];
  const stack = [];
  let pendingIf = null;
  let i = first;
  let current = root;
  while (i < last) {
    const raw = pyIndex(lines, i);
    const s = pyStrip(raw).replace(CONST_RE, (m, n) => `__C${n}`);
    if (s === '' || s.startsWith('//')) {
      i++;
      continue;
    }
    if (pendingIf !== null) {
      if (s !== '{') throw new Unsupported('if without brace');
      stack.push([current, pendingIf]);
      current = pendingIf.body;
      pendingIf = null;
    } else if (s === '{' && i + 1 < last && pyStrip(lines[i + 1]).startsWith('// banjo_gpu_pred_select')) {
      // The translator's flattened predicated block (banjo-nx's banjoFlattenPredicated): read as the `if (p0) { ... }`
      // it replaces.
      const pm = /^const bool banjoPred = (!?)p0;$/.exec(pyStrip(pyIndex(lines, i + 2)));
      if (!pm || !pyStrip(pyIndex(lines, i + 3)).startsWith('[branch] if (or(banjoPred, (g_SpecConstants() & ' +
                                                            'SPEC_CONSTANT_PRED_BRANCHES') ||
          pyStrip(pyIndex(lines, i + 4)) !== '{') {
        throw new Unsupported('pred_select block');
      }
      let firstBody = i + 5;
      while (firstBody < last && pyStrip(lines[firstBody]).startsWith('const ') && lines[firstBody].includes('banjoKeep_')) {
        firstBody++;
      }
      let k = firstBody;
      while (k < last && !/^\w+ = select\((?:bool4\()?banjoPred\b/.test(pyStrip(lines[k])) && pyStrip(lines[k]) !== '}') {
        k++;
      }
      let depth = 0;
      let end = null;
      for (let e = i; e < last; e++) {
        const t = pyStrip(lines[e]);
        depth += countChar(t, '{') - countChar(t, '}');
        if (depth === 0) {
          end = e;
          break;
        }
      }
      if (end === null) throw new Unsupported('pred_select block not closed');
      const cond = new Parser((pm[1] ? '!' : '') + 'p0').whole();
      const condComp = comp(cond, 0);
      const st = new Stmt('if', i, { cond: condComp, body: parseBody(lines, firstBody, k) });
      st.end = end;
      current.push(st);
      i = end;
    } else if (s === '{') {  // a scope for the translator's temporaries: its statements stay in this list
      stack.push([current, null]);
    } else if (s === '}') {
      if (!stack.length) throw new Unsupported('unbalanced');
      const [outer, owner] = stack.pop();
      current = outer;
      if (owner !== null) owner.end = i;
    } else if (ALPHA_CLIP_RE.test(s)) {
      let j = i + 1;
      while (pyStrip(pyIndex(lines, j)) === '') j++;
      if (pyStrip(lines[j]) !== '}') throw new Unsupported('alpha clip block');
      current.push(new Stmt('aclip', i));
      current[current.length - 1].end = j;
      i = j;
    } else if (BLEND_SKIP_RE.test(s)) {
      current.push(new Stmt('kill', i, { cond: null }));
    } else if (KILL_RE.test(s)) {
      const km = KILL_RE.exec(s);
      current.push(new Stmt('kill', i, { cond: comp(new Parser(km[1] || km[2]).whole(), 0) }));
    } else if (s === 'return;' || s === 'return false;') {
      current.push(new Stmt('ret', i));
    } else if (s === 'return banjoAlphaFailsEarly(oC0.w);') {  // in a copy
      current.push(new Stmt('aclip', i));
    } else if (s.startsWith('if (') && s.endsWith(')')) {
      const cond = new Parser(s.slice(3)).whole();
      if (width(cond) !== 1) throw new Unsupported('vector if');
      pendingIf = new Stmt('if', i, { cond: comp(cond, 0), body: [] });
      current.push(pendingIf);
    } else if (DECL_RE.test(s)) {
      const [, ty, name, text] = DECL_RE.exec(s);
      if (ty === 'int' || ty === 'uint' || ty === 'CubeMapData') {
        if (!['a0', 'banjoNextA0', 'aL', 'cubeMapData'].includes(name)) throw new Unsupported('declaration ' + name);
      } else if (ty === 'float4' && LITERAL_RE.test(text)) {
        const words = LITERAL_RE.exec(text).slice(1, 5).map((x) => pyIntHex(x));
        const comps = new Map();
        words.forEach((w, k) => comps.set('xyzw'[k], ['num', `asfloat(0x${w.toString(16)}u)`]));
        const st = new Stmt('assign', i, { dest: name, comps });
        st.literal = words.map(f32FromBits);
        st.decl = !stack.length;
        current.push(st);
      } else {
        const st = makeAssign(name, null, text, i);
        st.decl = !stack.length && !name.startsWith('me_alu_');
        current.push(st);
      }
    } else if (ASSIGN_RE.test(s)) {
      const [, dest, mask, text] = ASSIGN_RE.exec(s);
      current.push(makeAssign(dest, mask ?? null, text, i));
    } else {
      throw new Unsupported('statement: ' + s.slice(0, 60));
    }
    i++;
  }
  if (stack.length || pendingIf !== null) throw new Unsupported('unclosed block');
  return root;
}

function findMain(lines) {
  const start = lines.findIndex((l) => l.startsWith('void main('));
  if (start < 0) throw new Unsupported('no main');
  const open = nextIndex(lines, start, (l) => pyStrip(l) === '{');
  let depth = 0;
  for (let i = open; i < lines.length; i++) {
    const s = pyStrip(lines[i]);
    depth += countChar(s, '{') - countChar(s, '}');
    if (depth === 0) return [start, open, i];
  }
  throw new Unsupported('main not closed');
}

function* walk(stmts) {
  for (const s of stmts) {
    yield s;
    if (s.kind === 'if') yield* walk(s.body);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Forward facts: per component, the pixel shader constant it holds (if it is exactly one) and a bound on its magnitude
// (with the constants that bound relies on). Guards: 'zero:N:c', 'abs:N:c', 'literal'.
class Fact {
  constructor(uniform = null, bound = null, guards = EMPTY, fetchy = false, value = null) {
    this.uniform = uniform;  // [n, c] or null
    this.bound = bound;
    this.guards = guards;
    this.fetchy = fetchy;
    this.value = value;  // the literal it holds, when the shader's own constants (or a literal) put one there
  }
}

function numValue(t) {  // float(t), or the float of asfloat(0x...u)
  if (!t.startsWith('asfloat')) return pyFloat(t);
  return f32FromBits(pyIntHex(t.slice(8, -2)));
}

function stateFact(s, st) {  // st.get(reads(s).pop()) for a variable component
  const r = reads(s);
  return r.size ? st.get(firstOf(r)) : undefined;
}

function literalOf(s, st) {
  if (s[0] === 'num') {
    try {
      return numValue(s[1]);
    } catch (e) {
      if (e instanceof PyValueError) return null;
      throw e;
    }
  }
  if (s[0] === 'vc' || s[0] === 'sv') {
    const f = stateFact(s, st);
    return f !== undefined ? f.value : null;
  }
  return null;
}

// Whether scalar expression s depends on a texture fetch (or another call the copy cannot repeat).
function fetchy(s, st) {
  for (const x of iterNodes(s)) {
    if (x[0] === 'opq') return true;
  }
  for (const r of reads(s)) {
    if (st.has(r) && st.get(r).fetchy) return true;
  }
  return false;
}

const NO_BOUND = [null, EMPTY];

// [bound or null, guards] of scalar expression s in state st.
function bound(s, st) {
  const t = s[0];
  if (t === 'num') {
    let v;
    try {
      v = Math.abs(numValue(s[1]));
    } catch (e) {
      if (e instanceof PyValueError) return NO_BOUND;
      throw e;
    }
    return Number.isFinite(v) ? [v, EMPTY] : NO_BOUND;
  }
  if (t === 'bb') return [1.0, EMPTY];
  if (t === 'cc') return [BIG, new Set([`abs:${s[1]}:${s[2]}`])];
  if (t === 'vc' || t === 'sv') {
    if (t === 'sv' && SCALAR_NAMES.has(s[1])) return [Math.abs(SCALAR_NAMES.get(s[1])), EMPTY];
    const r = reads(s);
    const f = st.get(r.size ? firstOf(r) : '');
    return f !== undefined ? [f.bound, f.guards] : NO_BOUND;
  }
  if (t === 'un') return s[1] === '!' ? [1.0, EMPTY] : bound(s[2], st);
  if (t === 'bin') {
    if (COMPARISONS.has(s[1]) || s[1] === '&&' || s[1] === '||') return [1.0, EMPTY];
    const [a, ga] = bound(s[2], st);
    const [b, gb] = bound(s[3], st);
    if (a === null || b === null || s[1] === '/') return NO_BOUND;
    return ['+-'.includes(s[1]) ? a + b : a * b, union(ga, gb)];
  }
  if (t === 'tern') {
    const [a, ga] = bound(s[2], st);
    const [b, gb] = bound(s[3], st);
    return a === null || b === null ? NO_BOUND : [pyMax2(a, b), union(ga, gb)];
  }
  if (t === 'dot') {
    let total = 0.0;
    let g = EMPTY;
    const n = Math.min(s[1].length, s[2].length);
    for (let k = 0; k < n; k++) {
      const [a, ga] = bound(s[1][k], st);
      const [b, gb] = bound(s[2][k], st);
      if (a === null || b === null) return NO_BOUND;
      total = total + a * b;
      g = union(g, ga, gb);
    }
    return [total, g];
  }
  if (t === 'call') {
    const f = s[1];
    const parts = s[2].map((a) => bound(a, st));
    if (parts.some((p) => p[0] === null)) return NO_BOUND;
    const g = union(...parts.map((p) => p[1]));
    if (f === 'saturate' || f === 'frac') return [1.0, g];
    if (['abs', 'min', 'max', 'clamp', 'select'].includes(f)) return [pyMax(parts.map((p) => p[0])), g];
    if (['floor', 'ceil', 'trunc', 'round'].includes(f)) return [pyIndex(parts, 0)[0] + 1.0, g];
    if (f === 'sign' || f === 'isnan') return [1.0, g];
    return NO_BOUND;
  }
  if (t === 'max4') {
    const parts = s[1].map((a) => bound(a, st));
    if (parts.some((p) => p[0] === null)) return NO_BOUND;
    return [pyMax(parts.map((p) => p[0])), union(...parts.map((p) => p[1]))];
  }
  return NO_BOUND;
}

function uniformOf(s, st) {
  if (s[0] === 'cc') return [s[1], s[2]];
  if (s[0] === 'vc' || s[0] === 'sv') {
    const f = stateFact(s, st);
    return f !== undefined ? f.uniform : null;
  }
  return null;
}

function sameUniform(a, b) {
  return a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);
}

function copysign1(v) {
  return v < 0 || Object.is(v, -0) ? -1 : 1;
}

// Annotates every assignment with its pre-state (for the zero rule); returns the state after stmts.
function forward(stmts, st) {
  for (const s of stmts) {
    if (s.kind === 'assign') {
      s.pre = st;
      const next = new Map(st);
      for (const [c, node] of s.comps) {
        const name = compName(s.dest, c);
        if (s.literal !== null) {
          const v = s.literal['xyzw'.indexOf(c)];
          next.set(name, new Fact(null, Number.isFinite(v) ? Math.abs(v) : null, EMPTY, false, v));
          continue;
        }
        const [b, g] = bound(node, st);
        const u = uniformOf(node, st);
        const fy = fetchy(node, st);
        next.set(name, new Fact(u, b, g, fy, literalOf(node, st)));
      }
      st = next;
    } else if (s.kind === 'if') {
      const inner = forward(s.body, st);
      const merged = new Map();
      const condFetchy = fetchy(s.cond, st);
      for (const k of union(st.keys(), inner.keys())) {
        const a = st.get(k);
        const b = inner.get(k);
        if (a === undefined || b === undefined) {
          merged.set(k, new Fact(null, null, EMPTY, true));
          continue;
        }
        if (a === b) {
          merged.set(k, a);
          continue;
        }
        const u = sameUniform(a.uniform, b.uniform) ? a.uniform : null;
        const bd = a.bound === null || b.bound === null ? null : pyMax2(a.bound, b.bound);
        const v = a.value !== null && b.value !== null && a.value === b.value &&
          copysign1(a.value) === copysign1(b.value) ? a.value : null;
        merged.set(k, new Fact(u, bd, bd !== null ? union(a.guards, b.guards) : EMPTY,
                               a.fetchy || b.fetchy || condFetchy, v));
      }
      st = merged;
    }
  }
  return st;
}

function initialState() {
  const st = new Map();
  for (let r = 0; r < 32; r++) {
    for (const c of 'xyzw') st.set(`r${r}.${c}`, new Fact());
  }
  st.set('ps', new Fact(null, 0.0));
  st.set('p0', new Fact(null, 1.0));
  return st;
}

// ---------------------------------------------------------------------------------------------------------------------
// Backward slice
class Ctx {
  constructor(allowed) {
    this.allowed = allowed;  // the zero keys (line, component) that may be zeroed; null: every candidate
    this.guards = new Set();
    this.zeroed = new Map();  // zero key -> [stmt line, component name]
  }
}

function zeroKey(line, name) {
  return `${line}\u0000${name}`;
}

// The guards under which this product is +-0, for a constant factor times a finite value that depends on a texture
// fetch (only those can move the early point), or null.
function zeroRule(s, name, node, ctx) {
  if (node[0] !== 'bin' || node[1] !== '*' || s.pre === null) return null;
  if (ctx.allowed !== null && !ctx.allowed.has(zeroKey(s.line, name))) return null;
  for (const [k, y] of [[node[2], node[3]], [node[3], node[2]]]) {
    if (!fetchy(y, s.pre)) continue;
    const [b, g] = bound(y, s.pre);
    if (b === null || b > FINITE) continue;
    if (literalOf(k, s.pre) === 0) return union(['literal'], g);  // a literal 0: no run-time guard for it
    const u = uniformOf(k, s.pre);
    if (u !== null) return union([`zero:${u[0]}:${u[1]}`], g);
  }
  return null;
}

function sliceBlock(stmts, liveOut, ctx) {
  let live = new Set(liveOut);
  const out = [];
  for (let idx = stmts.length - 1; idx >= 0; idx--) {
    const s = stmts[idx];
    if (s.kind === 'ret') {
      live = new Set();
      out.push([s, null]);
    } else if (s.kind === 'aclip') {
      live = union(live, ['oC0.w']);
      out.push([s, null]);
    } else if (s.kind === 'kill') {
      continue;
    } else if (s.kind === 'assign') {
      const needed = new Map();
      for (const [c, node] of s.comps) {
        if (live.has(compName(s.dest, c))) needed.set(c, node);
      }
      if (!needed.size) continue;
      for (const c of needed.keys()) live.delete(compName(s.dest, c));
      const kept = new Map();
      for (const [c, node] of needed) {
        const name = compName(s.dest, c);
        const z = zeroRule(s, name, node, ctx);
        if (z !== null) {
          kept.set(c, ['zero', node]);
          for (const g of z) {
            if (g !== 'literal') ctx.guards.add(g);
          }
          ctx.zeroed.set(zeroKey(s.line, name), [s.line, name]);
        } else {
          kept.set(c, node);
          for (const r of reads(node)) live.add(r);
        }
      }
      out.push([s, kept]);
    } else if (s.kind === 'if') {
      const [innerLive, inner] = sliceBlock(s.body, live, ctx);
      if (inner.length) {
        live = union(live, innerLive, reads(s.cond));
        out.push([s, inner]);
      }
    }
  }
  out.reverse();
  return [live, out];
}

function itemCopyable([s, extra]) {
  if (s.kind === 'assign') {
    for (const n of extra.values()) {
      if (n[0] !== 'zero' && !copyable(n, s.fetchOk)) return false;
    }
    return true;
  }
  if (s.kind === 'if') return copyable(s.cond, s.fetchOk) && extra.every(itemCopyable);
  return true;
}

function itemNodes(s, extra) {
  if (s.kind === 'assign') return [...extra.values()].filter((x) => x[0] !== 'zero');
  return s.kind === 'if' ? [s.cond] : [];
}

function copyFetches(items) {
  let n = 0;
  for (const [s, extra] of walkItems(items)) {
    const seen = new Set();
    for (const node of itemNodes(s, extra)) {
      for (const x of iterNodes(node)) {
        if (x[0] === 'opq' && !seen.has(x[1])) {
          seen.add(x[1]);
          n++;
        }
      }
    }
  }
  return n;
}

function countCopy(items) {
  let n = 0;
  for (const [s, extra] of items) n += s.kind !== 'if' ? 1 : 1 + countCopy(extra);
  return n;
}

// Operations a runtime zero may pass through on its way to the alpha (where +0 and -0 give the same test).
const SIGN_SAFE_CALLS = new Set(['saturate', 'abs', 'min', 'max', 'clamp', 'select']);

// True when the tainted components s reads reach its value only through sign-insensitive operations.
function signSafe(s, tainted) {
  if (!intersects(reads(s), tainted)) return true;
  const t = s[0];
  if (t === 'vc' || t === 'sv') return true;
  if (t === 'un') return (s[1] === '-' && signSafe(s[2], tainted)) || (s[1] === '!' && signSafe(s[2], tainted));
  if (t === 'bin') {
    if (['+', '-', '*'].includes(s[1]) || COMPARISONS.has(s[1]) || s[1] === '&&' || s[1] === '||') {
      return signSafe(s[2], tainted) && signSafe(s[3], tainted);
    }
    return false;
  }
  if (t === 'tern') return signSafe(s[1], tainted) && signSafe(s[2], tainted) && signSafe(s[3], tainted);
  if (t === 'call') return SIGN_SAFE_CALLS.has(s[1]) && s[2].every((a) => signSafe(a, tainted));
  if (t === 'dot') return [...s[1], ...s[2]].every((a) => signSafe(a, tainted));
  if (t === 'max4') return s[1].every((a) => signSafe(a, tainted));
  return false;
}

function checkTaint(items, tainted) {
  for (const [s, extra] of items) {
    if (s.kind === 'assign') {
      for (const [c, node] of extra) {
        const name = compName(s.dest, c);
        if (node[0] === 'zero') {
          tainted.add(name);
        } else if (intersects(reads(node), tainted)) {
          if (!signSafe(node, tainted)) return false;
          tainted.add(name);
        } else {
          tainted.delete(name);
        }
      }
    } else if (s.kind === 'if') {
      if (!signSafe(s.cond, tainted)) return false;
      const inner = new Set(tainted);
      if (!checkTaint(extra, inner)) return false;
      for (const x of inner) tainted.add(x);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Emission
function emitItems(items, out, indent) {
  const pad = '\t'.repeat(indent);
  for (const [s, extra] of items) {
    if (s.kind === 'ret') {
      out.push(`${pad}return false;`);
      return;  // the rest of the block is not reached
    } else if (s.kind === 'aclip') {
      out.push(`${pad}return banjoAlphaFailsEarly(oC0.w);`);
      return;
    } else if (s.kind === 'if') {
      out.push(`${pad}if (${emit(s.cond)})`);
      out.push(`${pad}{`);
      emitItems(extra, out, indent + 1);
      out.push(`${pad}}`);
    } else if (s.kind === 'assign') {
      const names = new Map();
      for (const c of extra.keys()) names.set(c, compName(s.dest, c));
      const written = new Set();
      let conflict = false;
      for (const [c, node] of extra) {
        if (node[0] !== 'zero' && intersects(reads(node), written)) conflict = true;
        written.add(names.get(c));
      }
      if (!conflict) {
        for (const [c, node] of extra) out.push(`${pad}${names.get(c)} = ${emitValue(node)};`);
      } else {
        const temps = [];
        for (const [c, node] of extra) {
          const t = `banjoTmp${s.line}_${temps.length}`;
          temps.push([names.get(c), t]);
          out.push(`${pad}float ${t} = ${emitValue(node)};`);
        }
        for (const [name, t] of temps) out.push(`${pad}${name} = ${t};`);
      }
    }
  }
}

function emitValue(node) {
  return node[0] === 'zero' ? '0.0' : emit(node);
}

function paramDecl(name) {
  if (name === 'p0' || name === 'iFace') return `bool ${name}`;
  if (varWidth(name) === 1) return `float ${name}`;
  return `float4 ${name}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-check: an interpreter for the same statement forms, float32 (numpy's, see the header).
const fround = Math.fround;

function fmax(a, b) {  // np.fmax: NaN-ignoring, +0 over -0
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (a === 0 && b === 0) return Object.is(a, -0) && Object.is(b, -0) ? -0 : 0;
  return a > b ? a : b;
}

function fmin(a, b) {  // np.fmin: NaN-ignoring, -0 under +0
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (a === 0 && b === 0) return Object.is(a, 0) && Object.is(b, 0) ? 0 : -0;
  return a < b ? a : b;
}

function rint(x) {  // round half to even
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}

class Run {
  constructor(seed, consts, bools) {
    this.seed = seed;
    this.consts = consts;
    this.bools = bools;
    this.v = new Map();
  }

  get(name) {
    if (SCALAR_NAMES.has(name)) return fround(SCALAR_NAMES.get(name));
    if (UNIFORM_VECTORS.has(name.split('.')[0])) {
      return fround(new PyRandom((crc32(name) ^ this.seed) >>> 0).uniform(-2, 2));
    }
    if (!this.v.has(name)) return NaN;  // never written: undefined in the shader too
    return this.v.get(name);
  }

  opaque(node, i) {
    const vals = [];
    for (const a of node[2]) {
      const w = width(a);
      for (let j = 0; j < w; j++) vals.push(this.ev(comp(a, j)));
    }
    const slot = node[2].length && node[2][0][0] === 'var' ? node[2][0][1] : null;  // the texture argument
    const key = `(${pyStrRepr(node[1])}, ${slot === null ? 'None' : pyStrRepr(slot)}, ` +
      `[${vals.map(pyFloatRepr).join(', ')}])`;
    const rnd = new PyRandom((crc32(key) ^ this.seed) >>> 0);
    const k = rnd.random();
    const out = [];
    for (let q = 0; q < 4; q++) out.push(rnd.choice([0.0, 1.0, rnd.random(), rnd.random(), rnd.uniform(-2, 2)]));
    return k > 0.02 ? fround(pyIndex(out, i)) : 0;
  }

  ev(s) {
    const t = s[0];
    if (t === 'num') {
      const x = s[1];
      if (x.startsWith('asfloat(')) return f32FromBits(pyIntHex(x.slice(8, -2)));
      if (x.startsWith('0x')) return fround(Number(pyIntHex(x.replace(/u+$/, ''))));
      return fround(pyFloat(x));
    }
    if (t === 'vc') return this.get(`${s[1]}.${s[2]}`);
    if (t === 'sv') return this.get(s[1]);
    if (t === 'cc') {
      if (!this.consts.has(s[1])) throw stop(`KeyError: ${s[1]}`);
      return this.consts.get(s[1])['xyzw'.indexOf(s[2])];
    }
    if (t === 'bb') {
      if (!this.bools.has(s[1])) throw stop(`KeyError: ${s[1]}`);
      return this.bools.get(s[1]) ? 1 : 0;
    }
    if (t === 'opq') return this.opaque(s[1], s[2]);
    if (t === 'un') {
      const x = this.ev(s[2]);
      return s[1] === '-' ? -x : x === 0 ? 1 : 0;
    }
    if (t === 'bin') {
      const op = s[1];
      if (op === '&&') return this.ev(s[2]) !== 0 && this.ev(s[3]) !== 0 ? 1 : 0;
      if (op === '||') return this.ev(s[2]) !== 0 || this.ev(s[3]) !== 0 ? 1 : 0;
      const a = this.ev(s[2]);
      const b = this.ev(s[3]);
      switch (op) {
        case '+': return fround(a + b);
        case '-': return fround(a - b);
        case '*': return fround(a * b);
        case '/': return fround(a / b);
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        default: throw stop(`KeyError: ${op}`);
      }
    }
    if (t === 'tern') return this.ev(s[1]) !== 0 ? this.ev(s[2]) : this.ev(s[3]);
    if (t === 'dot') {
      let acc = 0;
      const n = Math.min(s[1].length, s[2].length);
      for (let j = 0; j < n; j++) {
        const p = fround(this.ev(s[1][j]) * this.ev(s[2][j]));
        acc = j === 0 ? p : fround(acc + p);
      }
      return acc;
    }
    if (t === 'max4') {
      const [a, b, c, d] = s[1].map((x) => this.ev(x));
      return fmax(fmax(a, b), fmax(c, d));
    }
    if (t === 'call') {
      const f = s[1];
      const a = s[2].map((x) => this.ev(x));
      const x = pyIndex(a, 0);
      let r;
      switch (f) {
        case 'saturate': r = Number.isNaN(x) ? 0 : pyMin2(pyMax2(x, 0.0), 1.0); break;
        case 'abs': r = Math.abs(x); break;
        case 'rsqrt': r = 1 / fround(Math.sqrt(x)); break;
        case 'rcp': r = 1 / x; break;
        case 'sqrt': r = Math.sqrt(x); break;
        case 'exp2': r = 2 ** x; break;
        case 'log2': r = Math.log2(x); break;
        case 'frac': r = x - Math.floor(x); break;
        case 'floor': r = Math.floor(x); break;
        case 'ceil': r = Math.ceil(x); break;
        case 'trunc': r = Math.trunc(x); break;
        case 'round': r = rint(x); break;
        case 'sign': r = x > 0 ? 1 : x < 0 ? -1 : x === 0 ? 0 : x; break;
        case 'sin': r = Math.sin(x); break;
        case 'cos': r = Math.cos(x); break;
        case 'isnan': r = Number.isNaN(x) ? 1 : 0; break;
        case 'clamp': r = a.length === 3 ? fmin(fmax(x, a[1]), a[2]) : NaN; break;
        case 'min': r = a.length === 2 ? fmin(x, a[1]) : NaN; break;
        case 'max': r = a.length === 2 ? fmax(x, a[1]) : NaN; break;
        case 'select': r = x !== 0 ? pyIndex(a, 1) : pyIndex(a, 2); break;
        default: throw stop(`KeyError: ${f}`);
      }
      return fround(r);
    }
    throw new Unsupported('ev ' + t);
  }

  block(stmts, snapAt = null, snaps = null) {
    for (let idx = 0; idx < stmts.length; idx++) {
      const s = stmts[idx];
      if (snapAt !== null && idx === snapAt) snaps.push(new Map(this.v));
      if (s.kind === 'assign') {
        const vals = [];
        for (const [c, node] of s.comps) vals.push([c, this.ev(node)]);
        for (const [c, v] of vals) this.v.set(compName(s.dest, c), fround(v));
      } else if (s.kind === 'if') {
        if (this.ev(s.cond) !== 0) {
          const r = this.block(s.body);
          if (r !== null) return r;
        }
      } else if (s.kind === 'aclip') {
        return ['clip', this.get('oC0.w')];
      } else if (s.kind === 'kill') {
        if (s.cond !== null && this.ev(s.cond) !== 0) return ['kill'];
      } else if (s.kind === 'ret') {
        return ['ret'];
      }
    }
    if (snapAt !== null && snapAt === stmts.length) snaps.push(new Map(this.v));
    return null;
  }
}

function same(a, b) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === 0 && b === 0) return true;
  return a === b;
}

function resultRepr(r) {
  return r === null ? 'None' : `(${pyStrRepr(r[0])},)`;
}

function parseGuard(g) {
  const [kind, n, c] = g.split(':');
  return [kind, parseInt(n, 10), c];
}

// [null, checked] if the copy agrees with main() on every trial where its guards hold, else [a description, checked].
function selfCheck(body, point, copyStmts, params, guards, trials, name, trace) {
  const constsUsed = new PyIntSet();
  const boolsUsed = new PyIntSet();
  for (const kind of ['cc', 'bb']) {
    for (const s of walk(body)) {
      const nodes = s.kind === 'assign' ? [...s.comps.values()] : s.cond !== null ? [s.cond] : [];
      for (const n of nodes) {
        for (const x of iterNodes(n)) {
          if (x[0] === kind) (kind === 'cc' ? constsUsed : boolsUsed).add(x[1]);
        }
      }
    }
  }
  const zeroConsts = [...guards].map(parseGuard).filter((g) => g[0] === 'zero');
  const nameCrc = crc32(name);
  let checked = 0;
  for (let trial = 0; trial < trials; trial++) {
    const rnd = new PyRandom(nameCrc * 1000 + trial);
    const consts = new Map();
    for (const n of constsUsed) {
      const c = [];
      for (let q = 0; q < 4; q++) {
        c.push(fround(rnd.choice([0.0, 1.0, -1.0, 0.5, rnd.uniform(-2, 2), rnd.uniform(-2, 2), rnd.uniform(0, 1)])));
      }
      consts.set(n, c);
    }
    const force = trial % 4 !== 3;
    for (const [, n, c] of zeroConsts) {
      if (force) {
        if (!consts.has(n)) consts.set(n, [0, 0, 0, 0]);
        consts.get(n)['xyzw'.indexOf(c)] = 0;
      }
    }
    const bools = new Map();
    for (const b of boolsUsed) bools.set(b, rnd.random() < 0.5);
    const run = new Run(rnd.getrandbits(31), consts, bools);
    for (let r = 0; r < 16; r++) {
      const vals = [];
      for (let q = 0; q < 4; q++) vals.push(rnd.choice([0.0, 1.0, rnd.uniform(-2, 2), rnd.uniform(-2, 2), rnd.uniform(0, 1)]));
      vals.forEach((v, q) => run.v.set(`iTexCoord${r}.${'xyzw'[q]}`, fround(v)));
    }
    for (const c of 'xyzw') {
      run.v.set(`iPos.${c}`, fround(rnd.uniform(0, 1280)));
      for (let k = 0; k < 6; k++) run.v.set(`iColor${k}.${c}`, fround(rnd.uniform(0, 1)));
    }
    run.v.set('iFace', rnd.random() < 0.5 ? 1 : 0);
    const snaps = [];
    const result = run.block(body, point, snaps);
    if (trace) trace(result);
    if (!snaps.length) continue;  // the original ended before the point
    const holds = [...guards].map(parseGuard).every(([kind, n, c]) => {
      if (!consts.has(n)) throw stop(`KeyError: ${n}`);
      const v = consts.get(n)['xyzw'.indexOf(c)];
      return kind === 'zero' ? v === 0 : Math.abs(v) <= BIG;
    });
    if (!holds) continue;
    const early = new Run(run.seed, consts, bools);
    early.v = new Map([...snaps[0]].filter(([k]) => params.some((p) => k === p || k.startsWith(p + '.'))));
    const copyResult = early.block(copyStmts);
    if (trace) trace(copyResult);
    checked++;
    if (result === null || result[0] === 'ret') {
      if (copyResult !== null && copyResult[0] === 'clip') {
        return [`trial ${trial}: the copy clips where main() does not`, checked];
      }
    } else if (result[0] === 'clip') {
      if (copyResult === null || copyResult[0] !== 'clip') {
        return [`trial ${trial}: main() clips with alpha ${npStr(result[1])}, the copy returns ${resultRepr(copyResult)}`,
          checked];
      }
      if (!same(result[1], copyResult[1])) {
        return [`trial ${trial}: alpha ${npRepr(result[1])} in main(), ${npRepr(copyResult[1])} in the copy`, checked];
      }
    }
  }
  return [null, checked];
}

function* iterNodes(n) {
  yield n;
  const t = n[0];
  if (t === 'un') {
    yield* iterNodes(n[2]);
  } else if (t === 'bin') {
    yield* iterNodes(n[2]);
    yield* iterNodes(n[3]);
  } else if (t === 'tern') {
    yield* iterNodes(n[1]);
    yield* iterNodes(n[2]);
    yield* iterNodes(n[3]);
  } else if (t === 'call') {
    for (const x of n[2]) yield* iterNodes(x);
  } else if (t === 'dot') {
    for (const x of n[1]) yield* iterNodes(x);
    for (const x of n[2]) yield* iterNodes(x);
  } else if (t === 'max4') {
    for (const x of n[1]) yield* iterNodes(x);
  } else if (t === 'opq') {
    for (const a of n[1][2]) {
      const w = width(a);
      for (let j = 0; j < w; j++) yield* iterNodes(comp(a, j));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
function countFetches(stmts) {
  let n = 0;
  for (const s of walk(stmts)) {
    const nodes = s.kind === 'assign' ? [...s.comps.values()] : s.cond !== null ? [s.cond] : [];
    const seen = new Set();
    for (const node of nodes) {
      for (const x of iterNodes(node)) {
        if (x[0] === 'opq' && FETCHES.has(x[1][1]) && !seen.has(x[1])) {
          seen.add(x[1]);
          n++;
        }
      }
    }
  }
  return n;
}

// The earliest top-level point after which the alpha's slice can be copied (zeroing the products `allowed` lets),
// and the slice after it: [point, live there, items, ctx].
function plan(body, allowed) {
  const ctx = new Ctx(allowed);
  const [, items] = sliceBlock(body, new Set(), ctx);
  const byStmt = new Map(items);
  let lastBlocked = -1;
  body.forEach((s, idx) => {
    if (byStmt.has(s) && !itemCopyable([s, byStmt.get(s)])) lastBlocked = idx;
  });
  const point = Math.max(lastBlocked + 1, firstReal(body));  // never inside the register declarations
  const ctx2 = new Ctx(allowed);
  const [liveAt, copyItems] = sliceBlock(body.slice(point), new Set(), ctx2);
  return [point, liveAt, copyItems, ctx2];
}

// Without runtime zeros, or with the fewest that give the earliest point.
function bestPlan(body) {
  const none = plan(body, new Set());
  const full = plan(body, null);
  if (full[0] >= none[0] || !checkTaint(full[2], new Set())) return none;
  const zeros = new Map(full[3].zeroed);
  const order = [...zeros].sort(([, a], [, b]) => a[0] - b[0] || cmpStr(a[1], b[1]));
  for (const [z] of order) {
    const allowed = new Set(zeros.keys());
    allowed.delete(z);
    const trial = plan(body, allowed);
    if (trial[0] <= full[0] && checkTaint(trial[2], new Set())) zeros.delete(z);
  }
  const best = plan(body, new Set(zeros.keys()));
  return checkTaint(best[2], new Set()) ? best : none;
}

function firstReal(body) {  // the first statement that is not one of main()'s declarations
  let i = 0;
  while (i < body.length && body[i].decl) i++;
  return i;
}

function guardText(guards) {
  const sorted = [...guards].map(parseGuard)
    .sort((a, b) => (a[0] !== 'zero') - (b[0] !== 'zero') || a[1] - b[1] || cmpStr(a[2], b[2]));
  const parts = sorted.map(([kind, n, c]) => {
    const v = `${constText(n)}.${c}`;
    return kind === 'zero' ? `${v} == 0.0` : `abs(${v}) <= 1099511627776.0`;
  });
  let text = pyIndex(parts, 0);
  for (const p of parts.slice(1)) text = `banjoAnd(${text}, ${p})`;  // no short-circuit branches
  return text;
}

// The file as the translator wrote it: without an earlier run's copy and call site.
function stripEarlier(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith(`// ${MARK} (tools/early_alpha.py)`)) {
      while (pyIndex(lines, i) !== '}') i++;
      i += i + 1 < lines.length && lines[i + 1] === '' ? 2 : 1;
      continue;
    }
    if (l === `\t// ${MARK}: a 2x2 quad whose pixels all fail the alpha test stops here.`) {
      while (pyIndex(lines, i) !== '\t}') i++;
      i++;
      continue;
    }
    out.push(l);
    i++;
  }
  return out.join('\n');
}

function* walkItems(items) {
  for (const [s, extra] of items) {
    yield [s, extra];
    if (s.kind === 'if') yield* walkItems(extra);
  }
}

function paramKey(v) {
  return [v.replace(/\d/g, ''), parseInt(v.replace(/\D/g, '') || '0', 10)];
}

// early_alpha.py's process() on the text of one file: { outcome, info, text (the file's new text, when copied) }.
function eaProcess(text, trials, fileName, trace) {
  if (text.includes('bool banjoEarlyAlphaFails(')) {
    text = stripEarlier(text);
    if (pyIndex(text.split('void main('), 1).includes('banjoEarlyAlpha')) {
      throw new Unsupported('could not strip the earlier copy');
    }
  }
  const lines = text.split('\n');
  const [start, open, close] = findMain(lines);
  const body = parseBody(lines, open + 1, close);
  forward(body, initialState());
  markFetchOk(body, true, { blocked: false });
  if (![...walk(body)].some((s) => s.kind === 'aclip')) throw new Unsupported('no alpha clip');
  const [point, liveAt, copyItems, ctx] = bestPlan(body);
  if (![...walkItems(copyItems)].some(([s]) => s.kind === 'aclip')) throw new Unsupported('no clip in the copy');
  const after = body.slice(point);
  const statementsAfter = [...walk(after)].length;
  const hoisted = copyFetches(copyItems);
  const fetchesAfter = countFetches(after) - hoisted;
  const size = countCopy(copyItems);
  if (size > MAX_COPY) throw new Unsupported(`copy of ${size} statements`);
  if (fetchesAfter < MIN_FETCHES_SKIPPED && statementsAfter < MIN_STATEMENTS_SKIPPED) {
    return { outcome: 'little', info: { point, fetches: fetchesAfter, statements: statementsAfter } };
  }
  // oC0 read before main() writes it (the final clip after the return paths, which no path reaches): a local.
  const ocWritten = [...walk(body.slice(0, point))].some((s) => s.kind === 'assign' && s.dest.startsWith('oC'));
  const params = [...new Set([...liveAt].filter((n) => ocWritten || !n.startsWith('oC')).map((n) => n.split('.')[0]))]
    .map((v) => [paramKey(v), v])
    .sort(([a], [b]) => cmpStr(a[0], b[0]) || a[1] - b[1])
    .map(([, v]) => v);
  const written = new Set();
  for (const [s] of walkItems(copyItems)) {
    if (s.kind === 'assign') written.add(s.dest);
  }
  const paramSet = new Set(params);
  const locals = [...union(written, [...liveAt].map((n) => n.split('.')[0]))].filter((x) => !paramSet.has(x))
    .sort(cmpStr);
  const bodyOut = [];
  emitItems(copyItems, bodyOut, 1);
  const func = ['', `// ${MARK} (tools/early_alpha.py): the alpha main() clips with, from its registers after line ` +
                `${point ? body[point - 1].end + 1 : open + 1}`, '// (a slice of the statements after it; see ' +
                'banjoAlphaFailsEarly / banjoEarlyAlphaQuad).',
                `bool banjoEarlyAlphaFails(${params.map(paramDecl).join(', ')})`, '{'];
  for (const l of locals) {
    if (l === 'oC0' || /^r\d+$/.test(l)) func.push(`\tfloat4 ${l} = 0.0;`);
    else if (l === 'ps') func.push('\tfloat ps = 0.0;');
    else if (l === 'p0') func.push('\tbool p0 = false;');
    else if (l.startsWith('banjoTmp')) continue;
    else if (l.startsWith('me_alu_')) func.push(`\tfloat ${l} = 0.0;`);
    else if (/^pb\d+$/.test(l)) func.push(`\tbool ${l} = false;`);  // Renut's block predicates
    else throw new Unsupported('local ' + l);
  }
  func.push(...bodyOut, '\treturn false;', '}');
  const funcLines = func.join('\n').replace(/__C(\d+)/g, (m, n) => constText(parseInt(n, 10))).split('\n');
  // self-check the emitted copy
  const copyBody = parseBody(funcLines, func.indexOf('{') + 1, func.length - 1);
  const [problem, checked] = selfCheck(body, point, copyBody, params, ctx.guards, trials, fileName, trace);
  if (problem) return { outcome: 'differs', info: { problem } };
  const call = `banjoEarlyAlphaFails(${params.join(', ')})`;
  const insertAt = point ? body[point - 1].end + 1 : open + 1;
  const site = [`\t// ${MARK}: a 2x2 quad whose pixels all fail the alpha test stops here.`,
                '\t[branch] if (g_SpecConstants() & SPEC_CONSTANT_EARLY_ALPHA)', '\t{'];
  if (ctx.guards.size) {
    site.push(`\t\tconst bool banjoEarlyFails = ${call};`, `\t\t[branch] if (${guardText(ctx.guards)})`,
              '\t\t\tbanjoEarlyAlphaQuad(banjoEarlyFails);');
  } else {
    site.push(`\t\tbanjoEarlyAlphaQuad(${call});`);
  }
  site.push('\t}');
  const out = [...lines.slice(0, start), ...funcLines.slice(1), '', ...lines.slice(start, insertAt), ...site,
               ...lines.slice(insertAt)];
  return {
    outcome: 'copied',
    info: { point, fetches: fetchesAfter, hoisted, statements: statementsAfter, size, guards: ctx.guards.size,
            zeroed: ctx.zeroed.size, checked },
    text: out.join('\n'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// renut_early_alpha.py: Renut's shader text in the forms early_alpha.py reads, and the copy back in Renut's forms.
const NAMED_CONST_RE = pyRe(String.raw`^#define (\w+) g_C\((\d+)\)\s*$`);
const ALPHA_TEST = 'alphaTest(oC0.w, g_AlphaTestFunc, g_AlphaThreshold);';
const BLEND_SKIP = 'banjoBlendSkip(oC0);';
const TRIM_RE = /^(?:oC([0-3]) = banjoTrim\(oC\1, \1u\);)$/;  // banjo_gpu_output_trim (package 28)
const CAST_RE = /\((float[234]?|bool)\)\(/g;
const KILL_SELECT_RE = /^(?:clip\(select\((.*), -1\.0, 1\.0\)\);)$/s;

// The tool's forms, and for each of its lines the index of the shader's own line it came from.
function toTool(lines) {
  const out = [];
  const origin = [];
  // Futari's named constants, as the tool reads constants: g_C(N) (in main's lines; the defines stay).
  const named = new Map();
  for (const l of lines) {
    const m = NAMED_CONST_RE.exec(pyStrip(l));
    if (m) named.set(m[1], `g_C(${m[2]})`);
  }
  const namedRe = named.size ? new RegExp(String.raw`\b(` + [...named.keys()].join('|') + String.raw`)\b`, 'g') : null;
  let inMain = false;
  lines.forEach((line, i) => {
    let l = line;
    if (l.startsWith('void main(')) inMain = true;
    if (inMain && namedRe !== null && !pyLstrip(l).startsWith('#')) l = l.replace(namedRe, (m, g) => named.get(g));
    const s = pyStrip(l);
    const indent = l.slice(0, l.length - pyLstrip(l).length);
    if (s === ALPHA_TEST) {
      out.push(indent + '[branch] if (g_SpecConstants() & SPEC_CONSTANT_ALPHA_TEST) { clip(alphaTestValue(oC0.w));',
               indent + '}');
      origin.push(i, i);
      return;
    }
    if (s === BLEND_SKIP) {
      out.push(indent + 'if ((g_SpecConstants() & SPEC_CONSTANT_BLEND_SKIP_ALPHA) != 0 && true) discard;');
      origin.push(i);
      return;
    }
    if (TRIM_RE.test(s)) {
      // After the alpha test: not part of what the alpha needs. A comment for the tool; the shader keeps it.
      out.push(indent + '// ' + s);
      origin.push(i);
      return;
    }
    let t = s.replace(/^const bool (pb\d+) = /, 'bool $1 = ');
    // A kill: clip(select(c, -1.0, 1.0)) is the tool's clip(banjoSel(c, -1, 1)).
    const km = KILL_SELECT_RE.exec(t);
    if (km) t = `clip(banjoSel(${km[1]}, -1, 1));`;
    t = t.replace(CAST_RE, '$1(');
    t = t.replace(/\bBANJO_BOOL_(\d+)\b/g, 'BANJO_BOOL($1)');
    out.push(t !== s ? indent + t : l);
    origin.push(i);
  });
  return [out, origin];
}

// The copy and its call site, from the tool's forms to Renut's.
function toRenut(text) {
  text = text.replaceAll('return banjoAlphaFailsEarly(oC0.w);',
                         'return banjoAlphaFailsEarlyRt(oC0.w, g_AlphaTestFunc, g_AlphaThreshold);');
  text = text.replaceAll('[branch] if (g_SpecConstants() & SPEC_CONSTANT_EARLY_ALPHA)', 'if (g_AlphaTestFunc != 7u)');
  // A constructor of one scalar is a broadcast: HLSL writes it as a cast.
  text = text.replace(/\b(float[234])\(([^(),]+)\)/g, (m, f, x) => (x.includes(',') ? m : `((${f})(${x}))`));
  if (text.includes('g_SpecConstants') || text.includes('SPEC_CONSTANT')) {
    throw new Unsupported('banjo-nx form left in the copy');
  }
  return text;
}

function isStackOverflow(e) {
  return (e instanceof RangeError && /call stack|recursion/i.test(e.message)) || e?.name === 'InternalError';
}

// One pixel shader through renut_early_alpha.py. options: trials (the self-check's, 24 as the build runs it), trace
// (a callback for each result of the self-check's runs: main()'s, then the copy's where it is compared; tests only).
export function renutEarlyAlpha(name, hlsl, { trials = 24, trace = null } = {}) {
  const fileName = name.endsWith('.hlsl') ? name : name + '.hlsl';
  const own = hlsl.replace(/\r\n?/g, '\n');  // the tool reads the file in text mode (universal newlines)
  const lines = own.split('\n');
  const [toolLines, origin] = toTool(lines);
  try {
    const r = eaProcess(toolLines.join('\n'), trials, fileName, trace);
    if (r.outcome !== 'copied') {
      // No copy: the shader's own text back (not the tool's forms, which only the tool reads).
      return { hlsl: own, status: r.outcome, info: r.info };
    }
    const done = r.text.split('\n');
    // The copy: from the marker line to the closing brace (and its blank line); the site: its marker to '\t}'.
    const f0 = nextIndex(done, 0, (l) => l.startsWith(`// ${MARK} (tools/early_alpha.py)`));
    const f1 = nextIndex(done, f0, (l) => l === '}');
    const s0 = nextIndex(done, 0, (l) => l === `\t// ${MARK}: a 2x2 quad whose pixels all fail the alpha test stops here.`);
    const s1 = nextIndex(done, s0, (l) => l === '\t}');
    const func = toRenut(done.slice(f0, f1 + 1).join('\n'));
    const site = toRenut(done.slice(s0, s1 + 1).join('\n'));
    // Where the site went in the tool's lines: after s0 - (lines added before it: the copy and its blank line).
    const toolInsert = s0 - (f1 + 1 - f0) - 1;
    const start = nextIndex(lines, 0, (l) => l.startsWith('void main('));
    let ownInsert = toolInsert < origin.length ? pyIndex(origin, toolInsert) : lines.length;
    // The tool's insertion point falls after a whole statement; an alpha test's two lines map to one.
    if (toolInsert > 0 && pyIndex(origin, toolInsert - 1) === ownInsert) ownInsert++;
    const out = [...lines.slice(0, start), ...func.split('\n'), '', ...lines.slice(start, ownInsert), ...site.split('\n'),
                 ...lines.slice(ownInsert)];
    return { hlsl: out.join('\n'), status: r.outcome, info: r.info };
  } catch (e) {
    let reason;
    if (e instanceof Unsupported) reason = e.message;
    else if (e instanceof PyIndexError) reason = 'IndexError';
    else if (e instanceof PyStopIteration) reason = 'StopIteration';
    else if (isStackOverflow(e)) reason = 'RecursionError';
    else throw e;
    return { hlsl: own, status: 'unsupported', info: { reason } };
  }
}

// For test/early_alpha_node.mjs: the primitives the self-check's random trials rest on.
export const _internals = { PyRandom, PyIntSet, crc32, pyFloatRepr, npStr };
