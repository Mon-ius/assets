'use strict';

/* =====================================================================
   ziputil.js — dependency-free ZIP writer.

   Builds a standard PKZIP archive (APPNOTE 6.3.9 local file header +
   central directory + end-of-central-directory record) from an array
   of { name, data } entries. `data` may be a string, Uint8Array,
   ArrayBuffer, or Blob. Keeps the project's "no frameworks / no
   dependencies" promise — uses the browser's built-in CompressionStream
   ('deflate-raw') for DEFLATE, which is available in Chrome 80+,
   Firefox 113+, and Safari 16.4+ (all "any modern browser").

   Per-entry compression is decided by the caller: PNG, JPEG, and other
   already-compressed payloads are passed as { compress: false } so we
   do not burn CPU for zero size reduction; text payloads (JSON,
   manifests) compress meaningfully and go through deflate. When
   CompressionStream is unavailable every entry is stored uncompressed
   — the archive still opens in every unzipper but grows.
   ===================================================================== */

const Zip = (() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function toBytes(data) {
    if (data == null) return new Uint8Array(0);
    if (data instanceof Uint8Array)   return data;
    if (data instanceof ArrayBuffer)  return new Uint8Array(data);
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return new Uint8Array(await data.arrayBuffer());
    }
    if (typeof data === 'string')     return new TextEncoder().encode(data);
    return new Uint8Array(data);
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // Little-endian writers.
  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  // DOS-format time/date — resolution is 2-second steps, year must be
  // ≥ 1980. Produced once per archive so every file shares a stamp.
  function dosStamp(d = new Date()) {
    const time = (d.getSeconds() >>> 1)
               | (d.getMinutes() << 5)
               | (d.getHours() << 11);
    const date = d.getDate()
               | ((d.getMonth() + 1) << 5)
               | ((Math.max(1980, d.getFullYear()) - 1980) << 9);
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  /**
   * Build a ZIP Blob from a list of files.
   *
   * @param {Array<{name: string, data: any, compress?: boolean}>} files
   * @returns {Promise<Blob>} application/zip
   *
   * Each entry's `compress` flag defaults to true. Entries that carry
   * already-compressed data (PNG, JPEG, MP4) should pass `compress:
   * false` so the writer stores them literally — deflating them again
   * costs CPU for no size win and sometimes a few bytes of loss.
   */
  async function build(files) {
    const parts   = []; // raw byte arrays appended in archive order
    const central = []; // central-directory byte arrays
    const stamp   = dosStamp();
    let offset    = 0;  // byte offset of next local file header

    for (const f of files) {
      const bytes = await toBytes(f.data);
      const crc   = crc32(bytes);
      const uncompressed = bytes.length;

      let payload = bytes;
      let method  = 0; // stored
      const wantCompress = f.compress !== false && uncompressed > 0;
      if (wantCompress) {
        const deflated = await deflateRaw(bytes);
        // Only accept deflate if it actually shrank the payload —
        // otherwise the extra bytes of zlib overhead make the archive
        // larger than a stored entry.
        if (deflated && deflated.length < uncompressed) {
          payload = deflated;
          method  = 8; // deflate
        }
      }
      const compressed = payload.length;
      const nameBytes  = new TextEncoder().encode(f.name);

      const lfh = [
        ...u32(0x04034b50), // local file header signature
        ...u16(20),         // version needed (2.0)
        ...u16(0),          // general purpose bit flag
        ...u16(method),     // compression method
        ...u16(stamp.time),
        ...u16(stamp.date),
        ...u32(crc),
        ...u32(compressed),
        ...u32(uncompressed),
        ...u16(nameBytes.length),
        ...u16(0),          // extra field length
      ];
      parts.push(new Uint8Array(lfh));
      parts.push(nameBytes);
      parts.push(payload);

      const cde = [
        ...u32(0x02014b50), // central directory header signature
        ...u16(20),         // version made by
        ...u16(20),         // version needed
        ...u16(0),          // flags
        ...u16(method),
        ...u16(stamp.time),
        ...u16(stamp.date),
        ...u32(crc),
        ...u32(compressed),
        ...u32(uncompressed),
        ...u16(nameBytes.length),
        ...u16(0),          // extra field length
        ...u16(0),          // file comment length
        ...u16(0),          // disk number start
        ...u16(0),          // internal file attributes
        ...u32(0),          // external file attributes
        ...u32(offset),     // offset of local header
      ];
      central.push(new Uint8Array(cde));
      central.push(nameBytes);

      offset += lfh.length + nameBytes.length + payload.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) {
      parts.push(c);
      centralSize += c.length;
    }

    const eocd = [
      ...u32(0x06054b50), // end of central directory signature
      ...u16(0),          // disk number
      ...u16(0),          // disk with central directory
      ...u16(files.length),
      ...u16(files.length),
      ...u32(centralSize),
      ...u32(centralStart),
      ...u16(0),          // zip file comment length
    ];
    parts.push(new Uint8Array(eocd));

    return new Blob(parts, { type: 'application/zip' });
  }

  return { build };
})();
