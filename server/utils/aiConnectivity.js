/**
 * Multi-provider AI connectivity: validate reachability and list models.
 * Supports OpenAI-compatible APIs (incl. Ollama / OpenRouter) and Anthropic.
 */

import {
  getAiProviderPreset,
  inferAiProvider
} from '../constants/aiProviders.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function normalizeAiBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * @param {object} opts
 * @param {string} [opts.provider]
 * @param {string} opts.baseUrl
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]
 */
export async function validateAiConnectivity(opts) {
  const prepared = prepareRequest(opts);
  if (!prepared.ok) return prepared;

  const { provider, normalized, key, modelId, preset, timeoutMs } = prepared;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (preset.apiStyle === 'anthropic') {
      return await validateAnthropic({
        normalized,
        key,
        modelId,
        signal: controller.signal
      });
    }
    return await validateOpenAiCompatible({
      provider,
      normalized,
      key,
      modelId,
      apiKeyRequired: preset.apiKeyRequired,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s reaching ${normalized}`
      };
    }
    return {
      ok: false,
      error: `Could not reach AI API: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @returns {Promise<{ ok: true, models: Array<{ id: string, name?: string }>, provider: string } | { ok: false, error: string, status?: number }>}
 */
export async function listAiModels(opts) {
  const prepared = prepareRequest(opts);
  if (!prepared.ok) return prepared;

  const { provider, normalized, key, preset, timeoutMs } = prepared;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (preset.apiStyle === 'anthropic') {
      const result = await fetchAnthropicModels({
        normalized,
        key,
        signal: controller.signal
      });
      if (!result.ok) return result;
      return { ok: true, provider, models: result.models };
    }

    const result = await fetchOpenAiModels({
      normalized,
      key,
      signal: controller.signal
    });
    if (!result.ok) return result;
    return { ok: true, provider, models: result.models };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        error: `Timed out after ${Math.round(timeoutMs / 1000)}s reaching ${normalized}`
      };
    }
    return {
      ok: false,
      error: `Could not list models: ${err?.message || String(err)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

function prepareRequest({
  provider: providerIn,
  baseUrl,
  apiKey = '',
  model = '',
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const key = String(apiKey || '').trim();
  let normalized = normalizeAiBaseUrl(baseUrl);
  const modelId = String(model || '').trim();

  const provider =
    String(providerIn || '').trim() ||
    inferAiProvider({ apiKey: key, baseUrl: normalized });
  const preset = getAiProviderPreset(provider);

  if (!normalized && preset.suggestedBaseUrl) {
    normalized = normalizeAiBaseUrl(preset.suggestedBaseUrl);
  }

  if (!normalized) {
    return {
      ok: false,
      error: 'AI API base URL is required. Choose a provider preset or enter a …/v1 URL.'
    };
  }
  if (!/^https?:\/\//i.test(normalized)) {
    return { ok: false, error: 'AI API base URL must start with http:// or https://' };
  }

  if (/^crsr_/i.test(key) || /api\.cursor\.com/i.test(normalized)) {
    return {
      ok: false,
      error:
        'Cursor dashboard / team API keys are not usable here. Pick OpenAI, Anthropic, OpenRouter, Ollama, or another OpenAI-compatible endpoint.'
    };
  }

  if (preset.apiKeyRequired && !key) {
    return {
      ok: false,
      error: `${preset.label} requires an API key. Paste it above (or save it first), then test again.`
    };
  }

  // Anthropic keys must not be sent as OpenAI Bearer against openai.com
  if (preset.apiStyle === 'openai' && /^sk-ant-/i.test(key)) {
    return {
      ok: false,
      error:
        'This looks like an Anthropic key (sk-ant-…). Select provider “Anthropic (Claude)” and base URL https://api.anthropic.com/v1.'
    };
  }

  if (preset.apiStyle === 'anthropic' && key && !/^sk-ant-/i.test(key)) {
    return {
      ok: false,
      error:
        'Anthropic keys usually start with sk-ant-. If you are using an OpenAI-compatible proxy for Claude, choose OpenRouter or Custom instead.'
    };
  }

  return {
    ok: true,
    provider: preset.id,
    preset,
    normalized,
    key,
    modelId,
    timeoutMs
  };
}

async function validateOpenAiCompatible({
  provider,
  normalized,
  key,
  modelId,
  apiKeyRequired,
  signal
}) {
  const modelsResult = await fetchOpenAiModels({ normalized, key, signal });

  if (modelsResult.ok) {
    const ids = modelsResult.models.map((m) => m.id);
    if (modelId && ids.length > 0 && !ids.includes(modelId)) {
      return {
        ok: false,
        error: `Connected to ${provider}, but model "${modelId}" was not in the list. Pick one from the dropdown or type a custom id your server accepts.`
      };
    }
    const sample = ids.slice(0, 5).join(', ');
    return {
      ok: true,
      provider,
      models: modelsResult.models,
      detail: ids.length
        ? `Reachable (${ids.length} model${ids.length === 1 ? '' : 's'}${sample ? `: ${sample}${ids.length > 5 ? '…' : ''}` : ''})`
        : 'Reachable (GET /models succeeded)'
    };
  }

  if (modelsResult.status === 401 || modelsResult.status === 403) {
    return {
      ok: false,
      status: modelsResult.status,
      error: modelsResult.error
    };
  }

  // Local servers sometimes omit /models — try chat completions when model is set
  if (
    (modelsResult.status === 404 || modelsResult.status === 405) &&
    modelId
  ) {
    const chat = await probeOpenAiChat({ normalized, key, modelId, signal });
    if (chat.ok) {
      return {
        ok: true,
        provider,
        models: [{ id: modelId }],
        detail: chat.detail
      };
    }
    return chat;
  }

  if (!apiKeyRequired && (modelsResult.status === 401 || modelsResult.status === 403)) {
    // already handled
  }

  return {
    ok: false,
    status: modelsResult.status,
    error: modelsResult.error
  };
}

async function validateAnthropic({ normalized, key, modelId, signal }) {
  const modelsResult = await fetchAnthropicModels({ normalized, key, signal });
  if (!modelsResult.ok) return modelsResult;

  const ids = modelsResult.models.map((m) => m.id);
  if (modelId && ids.length > 0 && !ids.includes(modelId)) {
    return {
      ok: false,
      error: `Connected to Anthropic, but model "${modelId}" was not in the list. Pick one from the dropdown or enter a valid Claude model id.`
    };
  }

  // Optional tiny messages probe when a model is selected
  if (modelId) {
    const probe = await probeAnthropicMessage({
      normalized,
      key,
      modelId,
      signal
    });
    if (!probe.ok) return probe;
  }

  const sample = ids.slice(0, 5).join(', ');
  return {
    ok: true,
    provider: 'anthropic',
    models: modelsResult.models,
    detail: ids.length
      ? `Reachable (Anthropic, ${ids.length} models${sample ? `: ${sample}${ids.length > 5 ? '…' : ''}` : ''})`
      : 'Reachable (Anthropic GET /models succeeded)'
  };
}

async function fetchOpenAiModels({ normalized, key, signal }) {
  const headers = {
    Accept: 'application/json'
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${normalized}/models`, {
    method: 'GET',
    headers,
    signal
  });

  if (!res.ok) {
    const hint = await safeErrorText(res);
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 401 || res.status === 403
          ? `Authentication failed (${res.status}). Check the API key.${hint ? ` ${hint}` : ''}`
          : `Provider returned HTTP ${res.status} for GET /models.${hint ? ` ${hint}` : ''}`
    };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  /** @type {Array<{ id: string, name?: string }>} */
  let models = [];
  if (Array.isArray(body?.data)) {
    models = body.data
      .map((m) => ({
        id: m?.id || m?.name,
        name: m?.name || m?.id
      }))
      .filter((m) => m.id);
  } else if (Array.isArray(body?.models)) {
    // Some local servers
    models = body.models
      .map((m) =>
        typeof m === 'string'
          ? { id: m, name: m }
          : { id: m?.id || m?.name, name: m?.name || m?.id }
      )
      .filter((m) => m.id);
  }

  models.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { ok: true, models };
}

async function fetchAnthropicModels({ normalized, key, signal }) {
  const base = normalized.replace(/\/v1$/i, '') + '/v1';
  const res = await fetch(`${base}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      Accept: 'application/json'
    },
    signal
  });

  if (!res.ok) {
    const hint = await safeErrorText(res);
    return {
      ok: false,
      status: res.status,
      error:
        res.status === 401 || res.status === 403
          ? `Anthropic authentication failed (${res.status}). Use a key from platform.claude.com (sk-ant-…).${hint ? ` ${hint}` : ''}`
          : `Anthropic returned HTTP ${res.status} for GET /models.${hint ? ` ${hint}` : ''}`
    };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const models = Array.isArray(body?.data)
    ? body.data
        .map((m) => ({
          id: m?.id,
          name: m?.display_name || m?.id
        }))
        .filter((m) => m.id)
    : [];

  models.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { ok: true, models };
}

async function probeOpenAiChat({ normalized, key, modelId, signal }) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${normalized}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0
    }),
    signal
  });

  if (res.ok) {
    return {
      ok: true,
      detail: `Reachable (POST /chat/completions with model "${modelId}")`
    };
  }

  const hint = await safeErrorText(res);
  return {
    ok: false,
    status: res.status,
    error: `Provider returned HTTP ${res.status} for POST /chat/completions.${hint ? ` ${hint}` : ''}`
  };
}

async function probeAnthropicMessage({ normalized, key, modelId, signal }) {
  const base = normalized.replace(/\/v1$/i, '') + '/v1';
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }]
    }),
    signal
  });

  if (res.ok) {
    return { ok: true, detail: `Reachable (Anthropic /messages with "${modelId}")` };
  }

  // Some accounts may block tiny probes; models list success is enough
  if (res.status === 400 || res.status === 429) {
    return { ok: true, detail: `Reachable (Anthropic models list OK; message probe returned ${res.status})` };
  }

  const hint = await safeErrorText(res);
  return {
    ok: false,
    status: res.status,
    error: `Anthropic returned HTTP ${res.status} for POST /messages.${hint ? ` ${hint}` : ''}`
  };
}

/**
 * Chat completion for Help Assistant (OpenAI-compatible or Anthropic).
 * @param {object} opts
 * @param {string} [opts.provider]
 * @param {string} opts.baseUrl
 * @param {string} [opts.apiKey]
 * @param {string} opts.model
 * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} opts.messages
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string, status?: number }>}
 */
export async function completeAiChat(opts) {
  const prepared = prepareRequest({
    provider: opts.provider,
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    model: opts.model,
    timeoutMs: opts.timeoutMs || 25_000
  });
  if (!prepared.ok) return prepared;
  if (!prepared.modelId) {
    return { ok: false, error: 'AI model is not configured' };
  }

  const { preset, normalized, key, modelId, timeoutMs } = prepared;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const maxTokens = Math.min(Math.max(Number(opts.maxTokens) || 700, 64), 2000);

  try {
    if (preset.apiStyle === 'anthropic') {
      return await completeAnthropicChat({
        normalized,
        key,
        modelId,
        messages: opts.messages,
        maxTokens,
        signal: controller.signal
      });
    }
    return await completeOpenAiChat({
      normalized,
      key,
      modelId,
      messages: opts.messages,
      maxTokens,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: `Timed out after ${Math.round(timeoutMs / 1000)}s` };
    }
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function completeOpenAiChat({
  normalized,
  key,
  modelId,
  messages,
  maxTokens,
  signal
}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${normalized}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3
    }),
    signal
  });

  if (!res.ok) {
    const hint = await safeErrorText(res);
    return {
      ok: false,
      status: res.status,
      error: `Provider returned HTTP ${res.status}.${hint ? ` ${hint}` : ''}`
    };
  }

  const body = await res.json();
  const text = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!text) return { ok: false, error: 'Empty model response' };
  return { ok: true, text };
}

async function completeAnthropicChat({
  normalized,
  key,
  modelId,
  messages,
  maxTokens,
  signal
}) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const base = normalized.replace(/\/v1$/i, '') + '/v1';
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: rest
    }),
    signal
  });

  if (!res.ok) {
    const hint = await safeErrorText(res);
    return {
      ok: false,
      status: res.status,
      error: `Anthropic returned HTTP ${res.status}.${hint ? ` ${hint}` : ''}`
    };
  }

  const body = await res.json();
  const text = Array.isArray(body?.content)
    ? body.content
        .filter((b) => b?.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
    : '';
  if (!text) return { ok: false, error: 'Empty model response' };
  return { ok: true, text };
}

async function safeErrorText(res) {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const json = JSON.parse(text);
      const msg =
        json?.error?.message ||
        json?.message ||
        (typeof json?.error === 'string' ? json.error : '') ||
        (typeof json === 'string' ? json : '');
      return msg ? String(msg).slice(0, 240) : '';
    } catch {
      return text.slice(0, 240);
    }
  } catch {
    return '';
  }
}
