import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

const cwd = mkdtempSync(join(tmpdir(), 'sandbox-media-'));
const run = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 130000, maxBuffer: 4 * 1024 * 1024 });
const fail = (command, args) => assert.notEqual(spawnSync(command, args, { cwd, timeout: 130000, stdio: 'pipe' }).status, 0, command + ' must reject ' + args.join(' '));
try {
  assert.notEqual(process.getuid(), 0, 'Acceptance must exercise the sandbox user');
  assert.equal(run('node', ['--version']).trim(), 'v26.1.0');
  const text = 'Synthetic sandbox document';
  const stream = `BT /F1 18 Tf 20 60 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(join(cwd, 'input.pdf'), pdf);
  assert.match(run('clawpdf', ['input.pdf']), new RegExp(text));
  run('clawpdf', ['render', 'input.pdf', '--page', '1', '-o', 'page.png']);
  assert.equal(readFileSync(join(cwd, 'page.png')).subarray(1, 4).toString(), 'PNG');
  run('convert', ['-size', '64x48', 'gradient:red-blue', 'source.png']);
  for (const format of ['png', 'jpeg', 'webp', 'heic', 'avif']) {
    const input = `source.${format}`;
    if (format !== 'png') run('convert', ['source.png', input]);
    const info = JSON.parse(run('sandbox-image', ['probe', input]));
    assert.equal(info.width, 64, format); assert.equal(info.height, 48, format);
    const output = `converted-${format}.png`;
    run('sandbox-image', ['encode', input, output, '--format', 'png', '--max-side', '32']);
    const small = JSON.parse(run('sandbox-image', ['probe', output]));
    assert.equal(small.width, 32, format); assert.equal(small.height, 24, format);
  }
  // Dimensions are readable from the header before allocating a large raster.
  const oversized = Buffer.from(readFileSync(join(cwd, 'source.png')));
  oversized.writeUInt32BE(10000, 16); oversized.writeUInt32BE(10000, 20);
  oversized.writeUInt32BE(crc32(oversized.subarray(12, 29)), 29);
  writeFileSync(join(cwd, 'oversized.png'), oversized);
  assert.throws(() => run('sandbox-image', ['encode', 'oversized.png', 'oversized-out.png', '--format', 'png']), /pixel|limit/i);
  run('sandbox-image', ['encode', 'source.png', 'opaque.jpg', '--format', 'jpeg', '--quality', '80']);
  fail('sandbox-image', ['encode', 'source.png', 'opaque.jpg', '--format', 'jpeg']);
  fail('sandbox-image', ['encode', 'source.png', 'bad.png', '--format', 'png', '--max-side', '-1']);
  writeFileSync(join(cwd, 'invalid'), 'not a media file');
  fail('sandbox-image', ['probe', 'invalid']); fail('clawpdf', ['invalid']); fail('ffprobe-wasm', ['invalid']);
  run('ffmpeg-wasm', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=5:duration=1', '-c:v', 'mpeg4', 'video.mp4']);
  run('ffmpeg-wasm', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', 'audio.mp3']);
  run('ffmpeg-wasm', ['-v', 'error', '-i', 'audio.mp3', '-ac', '1', '-ar', '16000', 'audio.wav']);
  const audio = JSON.parse(run('ffprobe-wasm', ['-v', 'error', '-show_streams', '-of', 'json', 'audio.wav'])).streams[0];
  assert.equal(audio.sample_rate, '16000'); assert.equal(audio.channels, 1);
  run('ffmpeg-wasm', ['-v', 'error', '-i', 'video.mp4', '-frames:v', '1', 'thumb.png']);
  assert.equal(JSON.parse(run('sandbox-image', ['probe', 'thumb.png'])).width, 32);
  run('ffmpeg-wasm', ['-v', 'error', '-ss', '0', '-i', 'video.mp4', '-t', '0.4', '-c', 'copy', 'clip.mp4']);
  const clip = JSON.parse(run('ffprobe-wasm', ['-v', 'error', '-show_format', '-of', 'json', 'clip.mp4']));
  assert.ok(Number(clip.format.duration) > 0 && Number(clip.format.duration) < 1);
  for (const [file, runner] of [['imports.mjs', 'sandbox-node'], ['imports.mts', 'sandbox-tsx']]) {
    writeFileSync(join(cwd, file), `import { probe } from 'rastermill'; import { openPdf } from 'clawpdf'; import { runFfprobe } from '@steipete/ffmpeg-wasm-local'; import { readFileSync } from 'node:fs'; ${file.endsWith('.mts') ? 'const answer: number = 42;' : 'const answer = 42;'} const pdf = await openPdf('input.pdf'); console.log(JSON.stringify({answer,width:(await probe(readFileSync('source.png'))).width,text:pdf.text(),media:(await runFfprobe(['-v','error','-show_format','video.mp4'])).exitCode})); await pdf[Symbol.asyncDispose]();`);
    const result = JSON.parse(run(runner, [file]));
    assert.equal(result.answer, 42); assert.equal(result.width, 64); assert.match(result.text, new RegExp(text)); assert.equal(result.media, 0);
  }
  assert.ok(statSync(join(cwd, 'audio.wav')).size > 1000);
  console.log(JSON.stringify({status:'passed',pdf:true,images:['png','jpeg','webp','heic','avif'],media:true,javascript:true,typescript:true,externalWrites:0}));
} finally { rmSync(cwd, { recursive:true, force:true }); }
