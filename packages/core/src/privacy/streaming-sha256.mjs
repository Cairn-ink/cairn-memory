// FIPS 180-4, sections 4.1.2, 5.1.1 and 6.2.2. Web Crypto has no streaming state.
const initial = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** @param {number} word @param {number} bits */
const rotateRight = (word, bits) => (word >>> bits) | (word << (32 - bits));

export class StreamingSha256 {
  #state = initial.slice();
  #buffer = new Uint8Array(64);
  #view = new DataView(this.#buffer.buffer);
  #schedule = new Uint32Array(64);
  #length = 0;

  reset() {
    this.#state.set(initial);
    this.#length = 0;
  }

  /** @param {StreamingSha256} source */
  copyFrom(source) {
    this.#state.set(source.#state);
    this.#buffer.set(source.#buffer);
    this.#length = source.#length;
  }

  /** @param {Uint8Array} bytes */
  update(bytes) {
    let pending = this.#length % 64;
    this.#length += bytes.length;
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(64 - pending, bytes.length - offset);
      this.#buffer.set(bytes.subarray(offset, offset + count), pending);
      pending += count;
      offset += count;
      if (pending === 64) {
        this.#compress();
        pending = 0;
      }
    }
  }

  // Finalize a copy so that the original state can accept more input.
  finish() {
    const pending = this.#length % 64;
    this.#buffer[pending] = 0x80;
    this.#buffer.fill(0, pending + 1);
    if (pending >= 56) {
      this.#compress();
      this.#buffer.fill(0);
    }
    this.#view.setUint32(56, Math.floor(this.#length / 0x20000000));
    this.#view.setUint32(60, this.#length * 8);
    this.#compress();
    return this.#state;
  }

  #compress() {
    const words = this.#schedule;
    for (let i = 0; i < 16; i++) words[i] = this.#view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15];
      const y = words[i - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) | 0;
    }

    const state = this.#state;
    let a = state[0], b = state[1], c = state[2], d = state[3];
    let e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + sum1 + choose + constants[i] + words[i]) | 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  }
}
