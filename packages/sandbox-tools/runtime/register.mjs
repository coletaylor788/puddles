import { registerHooks } from 'node:module';
const shared = new Set(['clawpdf', 'rastermill', '@steipete/ffmpeg-wasm-local']);
// Resolve only the documented tool packages from their immutable installation.
// Other imports retain ordinary Node resolution from the caller's workspace.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    return nextResolve(specifier, shared.has(name) ? { ...context, parentURL: import.meta.url } : context);
  },
});
