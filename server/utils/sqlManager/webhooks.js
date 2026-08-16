import { wrapQuery } from '../queryLogger.js';

const COLS = `
  id, name, platform, enabled, event_types as "eventTypes",
  project_ids as "projectIds", min_priority_id as "minPriorityId", locale,
  endpoint_url as "endpointUrl",
  telegram_bot_token as "telegramBotToken",
  telegram_chat_id as "telegramChatId",
  whatsapp_access_token as "whatsappAccessToken",
  whatsapp_phone_number_id as "whatsappPhoneNumberId",
  whatsapp_to as "whatsappTo",
  whatsapp_graph_version as "whatsappGraphVersion",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

export async function getAllWebhooks(db) {
  const stmt = wrapQuery(
    db.prepare(`SELECT ${COLS} FROM webhooks ORDER BY created_at ASC`),
    'SELECT'
  );
  return await stmt.all();
}

export async function getWebhookById(db, id) {
  const stmt = wrapQuery(db.prepare(`SELECT ${COLS} FROM webhooks WHERE id = $1`), 'SELECT');
  return await stmt.get(id);
}

export async function getEnabledWebhooks(db) {
  const stmt = wrapQuery(
    db.prepare(`SELECT ${COLS} FROM webhooks WHERE enabled <> 0`),
    'SELECT'
  );
  return await stmt.all();
}

export async function insertWebhook(db, row) {
  const stmt = wrapQuery(
    db.prepare(`
      INSERT INTO webhooks (
        id, name, platform, enabled, event_types, project_ids, min_priority_id, locale,
        endpoint_url, telegram_bot_token, telegram_chat_id,
        whatsapp_access_token, whatsapp_phone_number_id, whatsapp_to, whatsapp_graph_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `),
    'INSERT'
  );
  return stmt.run(
    row.id,
    row.name,
    row.platform,
    row.enabled ? 1 : 0,
    row.eventTypes,
    row.projectIds,
    row.minPriorityId,
    row.locale,
    row.endpointUrl,
    row.telegramBotToken,
    row.telegramChatId,
    row.whatsappAccessToken,
    row.whatsappPhoneNumberId,
    row.whatsappTo,
    row.whatsappGraphVersion
  );
}

export async function updateWebhook(db, id, row) {
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE webhooks SET
        name = $1,
        platform = $2,
        enabled = $3,
        event_types = $4,
        project_ids = $5,
        min_priority_id = $6,
        locale = $7,
        endpoint_url = $8,
        telegram_bot_token = $9,
        telegram_chat_id = $10,
        whatsapp_access_token = $11,
        whatsapp_phone_number_id = $12,
        whatsapp_to = $13,
        whatsapp_graph_version = $14,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
    `),
    'UPDATE'
  );
  return stmt.run(
    row.name,
    row.platform,
    row.enabled ? 1 : 0,
    row.eventTypes,
    row.projectIds,
    row.minPriorityId,
    row.locale,
    row.endpointUrl,
    row.telegramBotToken,
    row.telegramChatId,
    row.whatsappAccessToken,
    row.whatsappPhoneNumberId,
    row.whatsappTo,
    row.whatsappGraphVersion,
    id
  );
}

export async function updateWebhookEnabled(db, id, enabled) {
  const stmt = wrapQuery(
    db.prepare(`
      UPDATE webhooks SET enabled = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
    `),
    'UPDATE'
  );
  return stmt.run(enabled ? 1 : 0, id);
}

export async function deleteWebhook(db, id) {
  const stmt = wrapQuery(db.prepare(`DELETE FROM webhooks WHERE id = $1`), 'DELETE');
  return stmt.run(id);
}
