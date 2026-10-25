import { createHash } from 'node:crypto';

// SHA-256 namespaced seeds; xoshiro128** with rejection sampling for integers.
export function random(seed) {
  const digest = createHash('sha256').update(String(seed)).digest();
  let a = digest.readUInt32LE(0), b = digest.readUInt32LE(4);
  let c = digest.readUInt32LE(8), d = digest.readUInt32LE(12);
  const rotl = (x, k) => (x << k | x >>> (32 - k)) >>> 0;
  function uint32() {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
    return result;
  }
  function int(n) {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw Error('Invalid integer range');
    const limit = Math.floor(0x100000000 / n) * n;
    let v; do { v = uint32(); } while (v >= limit);
    return v % n;
  }
  const uniform = () => uint32() / 0x100000000;
  const normal = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uint32, int, uniform, normal };
}
