// Task 7 measurements: node track-report.mjs <wav> [<wav> ...]
// Prints format + analyzeFullTrack report (before/after use the same path).
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import { readFileSync } from 'node:fs';
import { SpectralAnalyzer } from './docs/modules/analyzer.js';

function decodeWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(path + ' not RIFF');
  let off = 12, fmt = null, dataOff = 0, dataSize = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { dataOff = off + 8; dataSize = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error('no fmt in ' + path);
  const bps = fmt.bits / 8;
  const frames = Math.floor(dataSize / (fmt.ch * bps));
  const chans = [];
  for (let c = 0; c < fmt.ch; c++) chans.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.ch; c++) {
      const p = dataOff + (i * fmt.ch + c) * bps;
      let v = 0;
      if (fmt.format === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
      else if (fmt.bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (fmt.bits === 24) v = buf.readIntLE(p, 3) / 8388608;
      else if (fmt.bits === 32) v = buf.readInt32LE(p) / 2147483648;
      chans[c][i] = v;
    }
  }
  return { chans, sr: fmt.sr, frames, fmt };
}

for (const f of process.argv.slice(2)) {
  const dec = decodeWav(f);
  const left = dec.chans[0];
  const right = dec.chans.length > 1 ? dec.chans[1] : left;
  const buffer = { sampleRate: dec.sr, duration: dec.frames / dec.sr, length: dec.frames, numberOfChannels: dec.chans.length, getChannelData: (ch) => (ch === 0 ? left : right) };
  const r = SpectralAnalyzer.analyzeFullTrack(buffer);
  console.log('=== ' + f + ' ===');
  console.log('fmt ' + JSON.stringify(dec.fmt) + ' frames ' + dec.frames + ' duration ' + (dec.frames / dec.sr).toFixed(2) + 's');
  console.log(JSON.stringify(r, (k, v) => (typeof v === 'number' && !Number.isFinite(v)) ? String(v) : v, 1));
}