// Minimal dependency-free MD5 (RFC 1321). SubtleCrypto deliberately does not
// implement MD5, and pulling in node:crypto's polyfill just for this one hash
// isn't worth the type/runtime compat surface — Subsonic's legacy token auth
// (t = md5(password + salt)) is the only thing that needs it.

function rotateLeft(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function toHexLE(num: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ((num >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return s;
}

const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

export function md5Hex(message: string): string {
  const utf8 = new TextEncoder().encode(message);
  const bitLen = utf8.length * 8;

  const paddedLen = (((utf8.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(utf8);
  buf[utf8.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunkStart = 0; chunkStart < paddedLen; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getInt32(chunkStart + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotateLeft(F, S[i])) | 0;
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0].map(toHexLE).join("");
}

// For Subsonic's "p=enc:<hex>" obfuscated-password form.
export function hexDecodeUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}
