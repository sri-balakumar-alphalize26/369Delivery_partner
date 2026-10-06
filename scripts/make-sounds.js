/**
 * Makes the app's short feedback sounds as WAV files in assets/sounds/.
 *
 * Plain generated tones, so there is no licence to track (the same as
 * new_job.wav and near_customer.wav). Run with `node scripts/make-sounds.js`.
 *
 *   success.wav   two rising notes, bright   - delivered, code accepted
 *   wrong.wav     two low buzzes             - wrong code
 *   job_gone.wav  one falling tone           - a job cancelled or taken by another rider
 */
const fs = require('fs');
const path = require('path');

const RATE = 44100;

/** One note: a sine with a few harmonics, quick attack and a smooth fade. */
function note(freqFrom, freqTo, ms, { gain = 0.5, buzz = false } = {}) {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = freqFrom + (freqTo - freqFrom) * t;
    phase += (2 * Math.PI * f) / RATE;
    let v = Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase);
    if (buzz) v = Math.sign(Math.sin(phase)) * 0.6 + 0.4 * Math.sin(phase); // a rougher edge
    const attack = Math.min(1, i / (RATE * 0.008));
    const release = Math.pow(1 - t, 1.6);
    out[i] = (v / 1.5) * gain * attack * release;
  }
  return out;
}

function silence(ms) {
  return new Float32Array(Math.round((RATE * ms) / 1000));
}

function join(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const dir = path.join(__dirname, '..', 'assets', 'sounds');
const sounds = {
  'success.wav': join([note(880, 880, 120), silence(30), note(1318, 1318, 260)]),
  'wrong.wav': join([note(196, 180, 150, { gain: 0.45, buzz: true }), silence(70), note(196, 170, 200, { gain: 0.45, buzz: true })]),
  'job_gone.wav': join([note(784, 392, 520, { gain: 0.5 })]),
};
for (const [name, samples] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(dir, name), wav(samples));
  console.log('wrote', name);
}
