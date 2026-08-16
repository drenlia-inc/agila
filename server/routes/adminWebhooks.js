import crypto from 'crypto';
import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getRequestDatabase } from '../middleware/tenantRouting.js';
import { parseBody, webhookUpsertBodySchema, webhookEnabledBodySchema } from '../utils/requestValidation.js';
import { webhooks as webhookQueries } from '../utils/sqlManager/index.js';
import { dispatchWebhook } from '../services/webhookDispatcher.js';
import { normalizeWebhookEventTypes } from '../constants/webhookEvents.js';
import { assertSafeHttpsUrl, looksLikeMaskedWebhookUrl, sanitizeWebhookUrlInput } from '../utils/webhookSsrf.js';

const router = express.Router();

const URL_PLATFORMS = new Set(['slack', 'mattermost', 'teams']);

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function isMasked(value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  if (looksLikeMaskedWebhookUrl(v)) return true;
  if (v.includes('••••')) return true;
  return false;
}

async function resolveEndpointUrl(platform, incoming, existingUrl) {
  if (!URL_PLATFORMS.has(platform)) return existingUrl || null;
  const sanitized = sanitizeWebhookUrlInput(incoming);
  if (isMasked(sanitized)) return existingUrl || null;
  await assertSafeHttpsUrl(sanitized);
  return sanitized;
}

function toPublic(row) {
  const platform = String(row.platform || '');
  const rawUrl = URL_PLATFORMS.has(platform) ? String(row.endpointUrl || '') : '';
  const urlOk = Boolean(rawUrl && !looksLikeMaskedWebhookUrl(rawUrl));
  return {
    id: row.id,
    name: row.name,
    platform,
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === '1',
    eventTypes: normalizeWebhookEventTypes(parseJson(row.eventTypes, {})),
    projectIds: parseJson(row.projectIds, []),
    minPriorityId: row.minPriorityId || null,
    locale: row.locale || '',
    endpointUrl: urlOk ? rawUrl : '',
    hasEndpointUrl: Boolean(row.endpointUrl),
    telegramChatId: row.telegramChatId || '',
    telegramBotToken: maskSecret(row.telegramBotToken),
    hasTelegramBotToken: Boolean(row.telegramBotToken),
    whatsappPhoneNumberId: row.whatsappPhoneNumberId || '',
    whatsappTo: row.whatsappTo || '',
    whatsappGraphVersion: row.whatsappGraphVersion || 'v21.0',
    whatsappAccessToken: maskSecret(row.whatsappAccessToken),
    hasWhatsappAccessToken: Boolean(row.whatsappAccessToken),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stringifyTypes(eventTypes) {
  return JSON.stringify(normalizeWebhookEventTypes(eventTypes));
}

router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const rows = await webhookQueries.getAllWebhooks(db);
    res.json((rows || []).map(toPublic));
  } catch (error) {
    console.error('List webhooks error:', error);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const parsed = parseBody(webhookUpsertBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;
    const db = getRequestDatabase(req);
    const id = crypto.randomUUID();
    const endpointUrl = await resolveEndpointUrl(data.platform, data.endpointUrl, null);
    if (URL_PLATFORMS.has(data.platform) && !endpointUrl) {
      return res.status(400).json({ error: 'Incoming webhook URL is required' });
    }
    await webhookQueries.insertWebhook(db, {
      id,
      name: data.name,
      platform: data.platform,
      enabled: data.enabled !== false,
      eventTypes: stringifyTypes(data.eventTypes),
      projectIds: JSON.stringify(data.projectIds || []),
      minPriorityId: data.minPriorityId || null,
      locale: data.locale || null,
      endpointUrl,
      telegramBotToken: isMasked(data.telegramBotToken) ? null : data.telegramBotToken || null,
      telegramChatId: data.telegramChatId || null,
      whatsappAccessToken: isMasked(data.whatsappAccessToken) ? null : data.whatsappAccessToken || null,
      whatsappPhoneNumberId: data.whatsappPhoneNumberId || null,
      whatsappTo: data.whatsappTo || null,
      whatsappGraphVersion: data.whatsappGraphVersion || 'v21.0',
    });
    const row = await webhookQueries.getWebhookById(db, id);
    res.status(201).json(toPublic(row));
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg.includes('webhook URL') || msg.includes('Webhook URL') || msg.includes('Invalid webhook')) {
      return res.status(400).json({ error: msg });
    }
    console.error('Create webhook error:', error);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const parsed = parseBody(webhookUpsertBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const db = getRequestDatabase(req);
    const existing = await webhookQueries.getWebhookById(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    const data = parsed.data;
    const endpointUrl = await resolveEndpointUrl(
      data.platform,
      data.endpointUrl,
      existing.endpointUrl
    );
    await webhookQueries.updateWebhook(db, req.params.id, {
      name: data.name,
      platform: data.platform,
      enabled: data.enabled !== false,
      eventTypes: stringifyTypes(data.eventTypes),
      projectIds: JSON.stringify(data.projectIds || []),
      minPriorityId: data.minPriorityId || null,
      locale: data.locale || null,
      endpointUrl,
      telegramBotToken: isMasked(data.telegramBotToken)
        ? existing.telegramBotToken
        : data.telegramBotToken || null,
      telegramChatId: data.telegramChatId || null,
      whatsappAccessToken: isMasked(data.whatsappAccessToken)
        ? existing.whatsappAccessToken
        : data.whatsappAccessToken || null,
      whatsappPhoneNumberId: data.whatsappPhoneNumberId || null,
      whatsappTo: data.whatsappTo || null,
      whatsappGraphVersion: data.whatsappGraphVersion || 'v21.0',
    });
    const row = await webhookQueries.getWebhookById(db, req.params.id);
    res.json(toPublic(row));
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg.includes('webhook URL') || msg.includes('Webhook URL') || msg.includes('Invalid webhook')) {
      return res.status(400).json({ error: msg });
    }
    console.error('Update webhook error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

router.patch('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const parsed = parseBody(webhookEnabledBodySchema, req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const db = getRequestDatabase(req);
    const existing = await webhookQueries.getWebhookById(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    await webhookQueries.updateWebhookEnabled(db, req.params.id, parsed.data.enabled);
    const row = await webhookQueries.getWebhookById(db, req.params.id);
    res.json(toPublic(row));
  } catch (error) {
    console.error('Patch webhook error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const existing = await webhookQueries.getWebhookById(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });
    await webhookQueries.deleteWebhook(db, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete webhook error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

router.post('/:id/test', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const db = getRequestDatabase(req);
    const webhook = await webhookQueries.getWebhookById(db, req.params.id);
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    await dispatchWebhook(db, webhook, { isTest: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Test webhook error:', error);
    const msg = String(error?.message || '');
    const http = msg.match(/\bHTTP (\d{3})\b/i);
    let publicError = 'Webhook test failed';
    if (http) publicError = `HTTP ${http[1]}`;
    else if (error?.name === 'AbortError' || /aborted|timeout/i.test(msg)) publicError = 'Request timed out';
    else if (msg && msg.length <= 80 && !/<|>|DOCTYPE/i.test(msg)) publicError = msg;
    res.status(400).json({ error: publicError });
  }
});

export default router;
