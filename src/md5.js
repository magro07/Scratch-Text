// Minimal MD5 implementation operating on a UTF-8-encoded Uint8Array.
// Returns the lowercase hex digest (32 chars). Public-domain style port
// of the RFC 1321 reference algorithm.

(function (global) {
'use strict';

function md5Bytes(bytes) {
  const len = bytes.length;
  const bitLen = len * 8;

  // Pad: append 0x80, then zeros until length % 64 === 56, then 8-byte length.
  const padLen = (len % 64 < 56) ? 56 - (len % 64) : 120 - (len % 64);
  const total = len + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[len] = 0x80;
  // little-endian 64-bit bit length (we only store low 32 since sources are small)
  msg[total - 8] = bitLen & 0xff;
  msg[total - 7] = (bitLen >>> 8) & 0xff;
  msg[total - 6] = (bitLen >>> 16) & 0xff;
  msg[total - 5] = (bitLen >>> 24) & 0xff;

  const K = new Int32Array([
    -680876936, -389564586,  606105819, -1044525330,
    -176418897, 1200080426, -1473231341,  -45705983,
    1770035416, -1958414417,     -42063, -1990404162,
    1804603682,  -40341101, -1502002290, 1236535329,
    -165796510, -1069501632,  643717713, -373897302,
    -701558691,   38016083, -660478335, -405537848,
      568446438, -1019803690, -187363961, 1163531501,
    -1444681467,  -51403784, 1735328473, -1926607734,
     -378558,  -2022574463, 1839030562, -35309556,
    -1530992060, 1272893353, -155497632, -1094730640,
      681279174, -358537222, -722521979,   76029189,
    -640364487, -421815835,  530742520, -995338651,
    -198630844, 1126891415, -1416354905,  -57434055,
    1700485571, -1894986606,   -1051523, -2054922799,
    1873313359,  -30611744, -1560198380, 1309151649,
     -145523070, -1120210379,  718787259, -343485551
  ]);
  const S = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];

  let a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;

  const block = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      block[i] = (msg[j]) | (msg[j + 1] << 8) | (msg[j + 2] << 16) | (msg[j + 3] << 24);
    }

    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)       { F = (B & C) | (~B & D);          g = i; }
      else if (i < 32)  { F = (D & B) | (~D & C);          g = (5 * i + 1) % 16; }
      else if (i < 48)  { F = B ^ C ^ D;                   g = (3 * i + 5) % 16; }
      else              { F = C ^ (B | ~D);                g = (7 * i) % 16; }
      const temp = D;
      D = C;
      C = B;
      const sum = (A + F + K[i] + block[g]) | 0;
      const sh = S[(Math.floor(i / 16) * 4) + (i % 4)];
      B = (B + ((sum << sh) | (sum >>> (32 - sh)))) | 0;
      A = temp;
    }

    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  function toHex(n) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      const byte = (n >>> (i * 8)) & 0xff;
      s += (byte < 16 ? '0' : '') + byte.toString(16);
    }
    return s;
  }
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

function md5Str(str) {
  return md5Bytes(new TextEncoder().encode(str));
}

global.MD5 = { md5Bytes, md5Str };

})(window);
