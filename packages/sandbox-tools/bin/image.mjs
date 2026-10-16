import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createRastermill } from '../runtime/node_modules/rastermill/dist/index.js';

export async function main(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    format: { type: 'string' }, 'max-side': { type: 'string' }, quality: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('sandbox-image probe INPUT\nsandbox-image encode INPUT OUTPUT --format jpeg|png|webp [--max-side N] [--quality 1..100]');
    return;
  }
  const [operation, input, output] = positionals;
  if (!input || !['probe', 'encode'].includes(operation) || positionals.length !== (operation === 'probe' ? 2 : 3)) throw new Error('Use sandbox-image --help');
  if (operation === 'encode' && !['jpeg', 'png', 'webp'].includes(values.format)) throw new Error('--format must be jpeg, png, or webp');
  const integer = (key, max) => {
    if (values[key] === undefined) return undefined;
    const n = Number(values[key]);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`--${key} must be an integer from 1 to ${max}`);
    return n;
  };
  const maxSide = integer('max-side', 20000);
  const quality = integer('quality', 100);
  const rastermill = createRastermill({ limits: { inputPixels: 50_000_000, outputPixels: 50_000_000 } });
  const bytes = await readFile(input);
  if (operation === 'probe') {
    const info = await rastermill.probe(bytes);
    if (!info) throw new Error('Unsupported or invalid image');
    console.log(JSON.stringify(info));
  }
  else {
    const result = await rastermill.encode(bytes, { format: values.format, ...(maxSide ? { resize: { maxSide } } : {}), ...(quality ? { quality } : {}) });
    await writeFile(output, result.data, { flag: 'wx' });
    const { data, ...metadata } = result;
    console.log(JSON.stringify(metadata));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
