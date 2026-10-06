import { expect, it } from 'vitest';
import { readerAnswer } from '../src/reader.js';
it('extracts the final answer without exposing reasoning', () => {
  expect(readerAnswer([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'private-reasoning' }, { type: 'text', text: 'Dinner proposed.' }] }])).toBe('Dinner proposed.');
});
it('rejects media and unfinished tool calls rather than returning raw transcript content', () => {
  for (const type of ['image', 'toolCall', 'audio']) expect(() => readerAnswer([{ role: 'assistant', content: [{ type, text: 'unsafe' }] }])).toThrow('invalid');
  expect(() => readerAnswer([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }] }])).toThrow('invalid');
});
