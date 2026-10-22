import { optionState } from './option-state.js';

/**
 * The assistant's model: any OpenAI-compatible chat API the user points the
 * app at, with a key kept in this browser. Nothing is sent anywhere until the
 * user asks the assistant something, and the key never leaves this device
 * except to that endpoint.
 */

const CONFIG_KEY = 'sheets:ai:v1';
export const AI_SETTINGS_EVENT = 'sheets:ai-settings';

const DEFAULTS = {
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  key: '',
};

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function aiConfig() {
  try {
    const saved = JSON.parse(storage()?.getItem(CONFIG_KEY) || 'null');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAIConfig(patch) {
  const next = { ...aiConfig(), ...patch };
  try { storage()?.setItem(CONFIG_KEY, JSON.stringify(next)); } catch { /* storage refused */ }
  try { globalThis.window?.dispatchEvent(new CustomEvent(AI_SETTINGS_EVENT, { detail: next })); } catch { /* no window */ }
  return next;
}

export function canAI() {
  return !!aiConfig().key && optionState.aiFeatures !== false;
}

function chatURL(config) {
  const base = String(config.endpoint || DEFAULTS.endpoint).replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function authHeaders(config) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.key}`,
  };
}

function readableError(status, body) {
  const message = body?.error?.message || body?.message || (typeof body === 'string' ? body : '');
  const hint = status === 401 ? ' Check the API key in Settings.' : status === 404 ? ' Check the endpoint and model in Settings.' : '';
  return new Error(`${message || `The AI service answered ${status}`}${hint}`.trim());
}

async function post(config, payload) {
  let res;
  try {
    res = await fetch(chatURL(config), { method: 'POST', headers: authHeaders(config), body: JSON.stringify(payload) });
  } catch {
    throw new Error('Could not reach the AI service. Check your connection and the endpoint in Settings.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw readableError(res.status, body);
  if (!body) throw new Error('The AI service did not answer.');
  return body;
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
  return '';
};

/** Anthropic-shaped blocks (text, image, document) become the OpenAI shapes. */
function openAIContent(content) {
  if (!Array.isArray(content)) return content;
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text') parts.push({ type: 'text', text: String(block.text ?? '') });
    else if (block.type === 'image' && block.source?.data) {
      parts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type || 'image/png'};base64,${block.source.data}` } });
    } else if (block.type === 'document' && block.source?.data) {
      parts.push({ type: 'file', file: { filename: block.name || 'attachment.pdf', file_data: `data:${block.source.media_type || 'application/pdf'};base64,${block.source.data}` } });
    }
  }
  return parts.length ? parts : '';
}

function openAIMessages(messages) {
  return messages.map((m) => {
    const out = { role: m.role };
    if (m.role === 'tool') {
      out.tool_call_id = m.tool_call_id;
      out.content = typeof m.content === 'string' ? m.content : textOf(m.content);
      return out;
    }
    out.content = openAIContent(m.content);
    if (m.tool_calls) out.tool_calls = m.tool_calls;
    if (m.name) out.name = m.name;
    return out;
  });
}

/** Ask one question; the answer as plain text. */
export async function aiChat(prompt, { feature = 'formula', model } = {}) {
  const config = aiConfig();
  if (!config.key) throw new Error('AI is not set up. Add an API key in Settings.');
  const body = await post(config, {
    model: model || config.model,
    messages: [{ role: 'user', content: openAIContent(prompt) }],
  });
  const answer = textOf(body.choices?.[0]?.message?.content);
  if (answer.trim()) trackAI(feature);
  return answer;
}

/** One streamed reply, in the pieces the assistant loop understands. */
export async function* aiChatStream(messages, { model, tools, maxTokens } = {}) {
  const config = aiConfig();
  if (!config.key) throw new Error('AI is not set up. Add an API key in Settings.');
  const payload = {
    model: model || config.model,
    messages: openAIMessages(messages),
    stream: true,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
  let res;
  try {
    res = await fetch(chatURL(config), { method: 'POST', headers: authHeaders(config), body: JSON.stringify(payload) });
  } catch {
    throw new Error('Could not reach the AI service. Check your connection and the endpoint in Settings.');
  }
  if (!res.ok) throw readableError(res.status, await res.json().catch(() => null));
  if (!res.body?.getReader) throw new Error('The AI service cannot stream in this browser.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cut = false;
  const calls = new Map();
  let sawText = false;

  const handle = (event) => {
    const choice = event.choices?.[0];
    if (!choice) return [];
    const out = [];
    const delta = choice.delta || {};
    if (delta.reasoning_content && !sawText) out.push({ type: 'reasoning' });
    if (typeof delta.content === 'string' && delta.content) {
      sawText = true;
      out.push({ type: 'text', text: delta.content });
    } else if (Array.isArray(delta.content)) {
      const text = textOf(delta.content);
      if (text) { sawText = true; out.push({ type: 'text', text }); }
    }
    for (const call of delta.tool_calls || []) {
      const index = call.index ?? 0;
      const entry = calls.get(index) || { id: '', name: '', arguments: '' };
      if (call.id) entry.id = call.id;
      if (call.function?.name) entry.name = call.function.name;
      if (call.function?.arguments) entry.arguments += call.function.arguments;
      calls.set(index, entry);
    }
    if (choice.finish_reason === 'length') cut = true;
    return out;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          let event;
          try { event = JSON.parse(data); } catch { continue; }
          if (event.error) throw readableError(0, event);
          for (const part of handle(event)) yield part;
        }
      }
    }
    for (const call of calls.values()) {
      if (!call.name) continue;
      yield { type: 'tool', id: call.id || `call_${crypto.randomUUID().slice(0, 8)}`, name: call.name, input: parseArgs(call.arguments) };
    }
    if (cut) yield { type: 'cut' };
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

function parseArgs(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { __unreadable: raw }; }
}

function trackAI(feature) { void feature; }
