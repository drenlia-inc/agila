import { completeAiChat } from './aiConnectivity.js';
import { getDecryptedSetting } from './settingsSecrets.js';
import { helpers } from './sqlManager/index.js';
import { HELP_ASSISTANT_FACTS } from '../config/helpAssistantFacts.js';
import {
  findHelpUiTarget,
  formatRetrievedLines,
  targetToGoThere
} from '../config/helpUiIndex.js';
import { retrieveHelpUiScored, isWeakHelpUiRetrieval } from './helpUiRetrieve.js';

const MAX_HISTORY = 10;

function looksLikeTaskPageQuestion(text) {
  const f = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /task\s*page|full[-\s]?page|entire task|whole task|page view|vue page|page tache|tache entiere/.test(f);
}

function looksLikeArchivedColumns(text) {
  const f = String(text || '').toLowerCase();
  if (!/archiv/.test(f)) return false;
  if (/trash|corbeille|vs|versus|ou la/.test(f) && /trash|corbeille/.test(f)) return false;
  return true;
}

function looksLikeFeedQuestion(text) {
  return /(activity\s*feed|\bfeed\b|fil d['’ ]?activit)/i.test(text);
}

function looksLikeNewUserDefault(text) {
  return /(new users?|default for|instance default|nouveaux utilisateurs|par d[eé]faut)/i.test(text);
}

function looksLikeDismissNow(text) {
  return /(\bx\b|dismiss|close the feed|fermer|masquer maintenant)/i.test(text) &&
    !/(profile|profil|preference|pr[eé]f[eé]rence|turn off|disable|désactiv)/i.test(text);
}

function resolveFeedIntent({ text, language, isAdmin }) {
  if (!looksLikeFeedQuestion(text)) return null;

  const lang = language === 'fr' ? 'fr' : 'en';
  if (looksLikeNewUserDefault(text) && isAdmin) {
    return {
      targetId: 'setting:SHOW_ACTIVITY_FEED',
      answer:
        lang === 'fr'
          ? 'Cela ne concerne que les nouveaux utilisateurs (Paramètres → Interface). Pour vous, c’est Profil → Fil d’activité.'
          : 'That Settings toggle is only the default for new users. To hide it for you, use Profile → Activity feed.'
    };
  }

  if (looksLikeDismissNow(text)) {
    return {
      targetId: 'help:activity-feed-close',
      answer:
        lang === 'fr'
          ? 'Cliquez sur le X du fil d’activité.'
          : 'Click the X on the activity feed.'
    };
  }

  return {
    targetId: 'help:profile-activity-feed',
    answer:
      lang === 'fr'
        ? 'Ouvrez Profil et désactivez Fil d’activité.'
        : 'Open Profile and turn off Activity feed.'
  };
}

function looksLikeFeatureDenial(text) {
  const f = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /doesn['’]?t exist|does not exist|there isn['’]?t|there is no |no [a-z].{0,40} in agila|not (a |an )?feature|n['’]existe pas|il n['’]y a pas|pas de .{0,50} dans agila/.test(
    f
  );
}

function helpTabsHint(lang, isAdmin) {
  if (lang === 'fr') {
    return isAdmin
      ? 'Aperçu, Livraison, Kanban, Liste, Gantt'
      : 'Aperçu, Raccourcis, Kanban, Liste, Gantt';
  }
  return isAdmin
    ? 'Overview, Delivery, Kanban, List, Gantt'
    : 'Overview, Shortcuts, Kanban, List, Gantt';
}

function unsureReply(lang, isAdmin) {
  const tabs = helpTabsHint(lang, isAdmin);
  return {
    targetId: null,
    answer:
      lang === 'fr'
        ? `Je ne suis pas sûr. Cherchez dans les onglets d’aide (${tabs}).`
        : `I’m not sure. Try the Help tabs (${tabs}).`
  };
}

function parseModelJson(text) {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { answer: trimmed.slice(0, 4000), targetId: null };
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const answer = String(parsed.answer || parsed.text || '').trim() || trimmed.slice(0, 4000);
    const targetId =
      parsed.targetId == null || parsed.targetId === '' || parsed.targetId === 'null'
        ? null
        : String(parsed.targetId).trim();
    return { answer: answer.slice(0, 4000), targetId };
  } catch {
    return { answer: trimmed.slice(0, 4000), targetId: null };
  }
}

async function loadAiOpts(db) {
  const provider = (await helpers.getSetting(db, 'AI_PROVIDER')) || '';
  const baseUrl = (await helpers.getSetting(db, 'AI_API_BASE_URL')) || '';
  const model = (await helpers.getSetting(db, 'AI_MODEL')) || '';
  const apiKey = await getDecryptedSetting(db, 'AI_API_KEY');
  return { provider, baseUrl, apiKey, model };
}

export async function runHelpAssistantChat({ db, isAdmin, language, messages }) {
  const lang = language === 'fr' ? 'fr' : 'en';
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return { ok: false, error: 'A user message is required', status: 400 };
  }

  const scored = retrieveHelpUiScored(lastUser.content, isAdmin, 14);
  const retrieved = scored.map((s) => s.row);
  const allowedIds = new Set(retrieved.map((r) => r.id));
  const weak = isWeakHelpUiRetrieval(scored);

  const feedOverride = resolveFeedIntent({
    text: lastUser.content,
    language: lang,
    isAdmin
  });
  const archiveOverride = looksLikeArchivedColumns(lastUser.content)
    ? {
        targetId: 'help:kanban-column-filter',
        answer:
          lang === 'fr'
            ? 'Ouvrez Filtre, puis le menu Colonnes pour afficher les colonnes archivées.'
            : 'Open Filter, then the Columns menu to show archived columns.'
      }
    : null;
  const taskPageOverride = looksLikeTaskPageQuestion(lastUser.content)
    ? {
        targetId: 'help:task-page-link',
        answer:
          lang === 'fr'
            ? 'Cliquez sur l’identifiant du ticket (ex. TASK-00001) sur la carte, dans la liste ou en haut du panneau : cela ouvre la page tâche. Un clic sur le corps de la carte n’ouvre que le panneau latéral.'
            : 'Click the ticket ID (e.g. TASK-00001) on the card, in list view, or at the top of the side panel to open the full task page. Clicking the card body only opens the side panel.'
      }
    : null;
  const override = feedOverride || archiveOverride || taskPageOverride;

  if (!override && weak) {
    const unsure = unsureReply(lang, isAdmin);
    return { ok: true, answer: unsure.answer, targetId: null, target: null };
  }

  const roleLine = isAdmin
    ? 'This user is an admin. Mention Settings (Profile → Settings) defaults only if they ask about new users or instance-wide defaults. For “how do I…”, send them to the user control first.'
    : 'This user is not an admin. Never mention Settings instance pages. Only user actions (board, profile, feed panel).';

  const system = `You are the in-app Help Assistant for Agila (Kanban board).
Reply in ${lang === 'fr' ? 'French' : 'English'} only.
Be brief: 1–2 short sentences. No preamble.
${roleLine}
Do not invent features. Never say a feature does not exist, is missing, or that Agila has no such view/page/control.
If the retrieved list does not clearly answer, set targetId to null and say you are not sure; tell the user to use the Help tabs (${helpTabsHint(lang, isAdmin)}). Never mention Delivery or Settings tabs unless this user is an admin.
Do not output CSS, selectors, HTML, or JavaScript.
Do not reveal secrets.

${HELP_ASSISTANT_FACTS}

Return ONLY JSON:
{"answer":"one or two short sentences","targetId":"<id from retrieved list or null>"}
targetId MUST be one of the retrieved ids below, or null.

Retrieved UI targets:
${formatRetrievedLines(retrieved)}`;

  const aiOpts = await loadAiOpts(db);
  const completion = await completeAiChat({
    ...aiOpts,
    messages: [{ role: 'system', content: system }, ...history],
    maxTokens: 280
  });

  if (!completion.ok) {
    return { ok: false, error: completion.error || 'AI request failed', status: completion.status || 502 };
  }

  const parsed = parseModelJson(completion.text);
  let targetId = override?.targetId ?? parsed.targetId;
  if (targetId && !override && !allowedIds.has(targetId)) {
    targetId = retrieved[0]?.id || null;
  }
  let answer = override?.answer ?? parsed.answer;
  if (!override && looksLikeFeatureDenial(answer)) {
    const unsure = unsureReply(lang, isAdmin);
    answer = unsure.answer;
    targetId = null;
  }
  const row = findHelpUiTarget(targetId, isAdmin);
  return {
    ok: true,
    answer,
    targetId: row ? row.id : null,
    target: row ? targetToGoThere(row) : null
  };
}
