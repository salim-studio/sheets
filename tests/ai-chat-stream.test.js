// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aiChat, aiChatStream } from '../src/lib/ai.js';

beforeEach(() => {
  localStorage.setItem('sheets:ai:v1', JSON.stringify({ endpoint: 'https://ai.test/v1', model: 'gpt-4o-mini', key: 'test-key' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const collect = async (iterable) => { const out = []; for await (const part of iterable) out.push(part); return out; };
const sse = (events) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('reads a streamed tool call whose arguments come as JSON text, as a whole reply\'s are read', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'read_range', arguments: '{"range":"A1:B2"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'read_range', arguments: '{"range":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 2, id: 'c', function: { name: 'get_workbook_info', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 3, id: 'd', function: { name: 'find', arguments: '{"query":"x"}' } }] } }] },
  ])));
  expect(await collect(aiChatStream([], { tools: [{}] }))).toEqual([
    { type: 'tool', id: 'a', name: 'read_range', input: { range: 'A1:B2' } },
    { type: 'tool', id: 'b', name: 'read_range', input: { __unreadable: '{"range":' } },
    { type: 'tool', id: 'c', name: 'get_workbook_info', input: {} },
    { type: 'tool', id: 'd', name: 'find', input: { query: 'x' } },
  ]);
});

it('says a reply was cut off when its closing token count reaches the limit', async () => {
  const stream = (usage) => vi.fn(async () => sse([{ choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: {} }], usage }]));
  vi.stubGlobal('fetch', stream({ prompt_tokens: 900, completion_tokens: 32000 }));
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }, { type: 'cut' }]);
  vi.stubGlobal('fetch', stream({ input_tokens: 900, output_tokens: 32000 }));
  expect((await collect(aiChatStream([], { maxTokens: 32000 }))).at(-1)).toEqual({ type: 'cut' });
  vi.stubGlobal('fetch', stream({ completion_tokens: 31999 }));
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }]);
  // Without a limit asked for, nothing is taken for one.
  vi.stubGlobal('fetch', stream({ completion_tokens: 32000 }));
  expect(await collect(aiChatStream([], {}))).toEqual([{ type: 'text', text: 'Hi' }]);
});

it('says a reply handed back whole was cut off by its finish reason', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: 'Hi' }, finish_reason: 'length' }] })));
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }, { type: 'cut' }]);
  vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }] })));
  expect(await collect(aiChatStream([], { maxTokens: 32000 }))).toEqual([{ type: 'text', text: 'Hi' }]);
});

it('asks the service for the output limit given', async () => {
  const fetchMock = vi.fn(async () => sse([{ choices: [{ delta: { content: '' } }] }]));
  vi.stubGlobal('fetch', fetchMock);
  await collect(aiChatStream([], { maxTokens: 32000 }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(32000);
});

// The formula helper's one-shot ask was shown the service's failures as they came: thrown as a plain
// object it read "unknown error", and handed back as the reply it was offered to be written into a cell.
it('fails a one-shot ask with the service\'s own words', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'insufficient_funds', message: 'Insufficient funds' } }, 402)));
  await expect(aiChat('hi')).rejects.toMatchObject({ message: 'Insufficient funds', code: 'insufficient_funds' });
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'Model overloaded' } }, 503)));
  await expect(aiChat('hi')).rejects.toMatchObject({ message: 'Model overloaded' });
  vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { content: '=SUM(A1:A3)' } }] })));
  expect(await aiChat('hi')).toBe('=SUM(A1:A3)');
});
