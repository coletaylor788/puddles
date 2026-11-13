import { readFileSync } from 'node:fs';
import { registerBrowser } from './register.mjs';
const tools = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url), 'utf8'));
const instructions = readFileSync(new URL('./instructions.txt', import.meta.url), 'utf8');
export default {
  id: 'agent-browser', name: 'Vercel browser',
  register(api) { registerBrowser(api, tools, undefined, undefined, instructions); },
};
