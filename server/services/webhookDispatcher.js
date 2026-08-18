import { postJsonHttps, postAllowlistedJson } from '../utils/webhookSsrf.js';
import { buildWebhookText } from '../utils/webhookPayload.js';
import { webhooks as webhookQueries } from '../utils/sqlManager/index.js';

function slackBody(text) {
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: text.replace(/&/g, '&amp;') },
      },
    ],
  };
}

function teamsBody(text) {
  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: text.split('\n')[0] || 'Agila',
    themeColor: '2563EB',
    text: text.replace(/\n/g, '<br/>'),
  };
}

export async function dispatchWebhook(db, webhook, { queueRow = null, commentContent = null, isTest = false } = {}) {
  const text = await buildWebhookText({
    db,
    webhook,
    queueRow: queueRow || { task_data: '{}', participants_data: '{}', actor_data: '{}', action: 'test' },
    commentContent,
    isTest,
  });
  const platform = String(webhook.platform || '').toLowerCase();

  if (platform === 'telegram') {
    const token = webhook.telegramBotToken;
    const chatId = webhook.telegramChatId;
    if (!token || !chatId) throw new Error('Telegram bot token and chat ID are required');
    return postAllowlistedJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  if (platform === 'whatsapp') {
    const token = webhook.whatsappAccessToken;
    const phoneId = webhook.whatsappPhoneNumberId;
    const to = String(webhook.whatsappTo || '').replace(/[^\d]/g, '');
    const ver = webhook.whatsappGraphVersion || 'v21.0';
    if (!token || !phoneId || !to) throw new Error('WhatsApp token, phone number ID, and destination are required');
    return postAllowlistedJson(`https://graph.facebook.com/${ver}/${phoneId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.slice(0, 4096) },
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  const url = webhook.endpointUrl;
  if (!url) throw new Error('Webhook URL is required');
  if (platform === 'slack') {
    return postJsonHttps(url, slackBody(text));
  }
  if (platform === 'teams') {
    return postJsonHttps(url, teamsBody(text));
  }
  return postJsonHttps(url, { text });
}

export async function dispatchWebhookById(db, webhookId, opts = {}) {
  const webhook = await webhookQueries.getWebhookById(db, webhookId);
  if (!webhook) throw new Error('Webhook not found');
  return dispatchWebhook(db, webhook, opts);
}
