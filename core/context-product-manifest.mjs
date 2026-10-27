// Checkpointable SHA-256, used only by the maintenance Worker. The persisted
// compression state lets deep verification yield without re-scanning a corpus.
// Publication records contain only the final standard SHA-256 digest.
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate = (x, n) => (x >>> n) | (x << (32 - n));
export class ManifestHash {
  constructor(state) {
    this.h = state?.h.slice() ?? [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    this.bytes = state?.bytes ?? 0;
    this.pending = Buffer.from(state?.pending ?? '', 'base64');
  }
  update(bytes) {
    const data = Buffer.concat([this.pending, Buffer.from(bytes)]);
    this.bytes += Buffer.byteLength(bytes);
    let offset = 0;
    for (; offset + 64 <= data.length; offset += 64) {
      const w = new Uint32Array(64);
      for (let i = 0; i < 16; i++) w[i] = data.readUInt32BE(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i-15], b = w[i-2];
        w[i] = w[i-16] + (rotate(a,7) ^ rotate(a,18) ^ (a >>> 3)) + w[i-7] + (rotate(b,17) ^ rotate(b,19) ^ (b >>> 10));
      }
      let [a,b,c,d,e,f,g,h] = this.h;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      this.h = this.h.map((v,i) => (v + [a,b,c,d,e,f,g,h][i]) >>> 0);
    }
    this.pending = Buffer.from(data.subarray(offset));
    return this;
  }
  state() { return { h: this.h.slice(), bytes: this.bytes, pending: this.pending.toString('base64') }; }
  digest() {
    const copy = new ManifestHash(this.state()), padding = Buffer.alloc((64 - (this.bytes + 9) % 64) % 64 + 9);
    padding[0] = 128; padding.writeBigUInt64BE(BigInt(this.bytes) * 8n, padding.length - 8);
    copy.update(padding);
    const output = Buffer.alloc(32); copy.h.forEach((v,i) => output.writeUInt32BE(v, i*4));
    return output.toString('base64url');
  }
}
