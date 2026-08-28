import type { TFunction } from 'i18next';

const TICKET_TOKEN_RE = /\b([A-Z][A-Z0-9]*-\d+)\b/gi;

export type ActivityImpactInput = {
  action: string;
  details: string;
  taskTicket?: string | null;
  projectId?: string | null;
};

type ImpactKind =
  | 'moved'
  | 'deleted'
  | 'created'
  | 'updated'
  | 'restored'
  | 'copied'
  | 'archived'
  | 'sprintAssociated'
  | 'sprintRemoved'
  | 'tagAssociated'
  | 'tagRemoved'
  | 'commented'
  | 'agentDone'
  | 'agentFailed';

/** Kanban column / status moves (logged as update_task with moved-task copy). */
export function isColumnMoveActivity(action: string, details: string): boolean {
  const d = details.toLowerCase();
  if (d.includes('between columns') || d.includes('entre colonnes')) return true;
  if (d.includes('undid column move') || d.includes('annulé le déplacement de colonne')) return true;
  if (d.includes('from board') || (d.includes('du tableau') && d.includes('vers le tableau'))) {
    return false;
  }
  if (action.includes('move_task')) return true;
  if (
    (d.includes('moved task') || d.includes('a déplacé la tâche')) &&
    (d.includes(' from ') || d.includes(' de ')) &&
    (d.includes(' to ') || d.includes(' à '))
  ) {
    return true;
  }
  return false;
}

export function extractActivityTaskTickets(
  details: string,
  taskTicket: string | null | undefined,
  projectId: string | null | undefined,
  knownProjectIds: Set<string>
): string[] {
  const projectUpper = projectId?.toUpperCase();
  const found = new Set<string>();
  if (taskTicket) {
    found.add(taskTicket.toUpperCase());
  }
  TICKET_TOKEN_RE.lastIndex = 0;
  let match = TICKET_TOKEN_RE.exec(details);
  while (match) {
    const token = match[1].toUpperCase();
    if (!knownProjectIds.has(token) && token !== projectUpper) {
      found.add(token);
    }
    match = TICKET_TOKEN_RE.exec(details);
  }
  return Array.from(found);
}

function classifyActivityImpact(
  action: string,
  details: string,
  tickets: string[]
): { kind: ImpactKind; sprintName?: string; tagName?: string } | null {
  const l = details.toLowerCase();

  if (
    action.includes('member_joined') ||
    action.includes('account_activated') ||
    l.includes('joined the team') ||
    l.includes("a rejoint l'équipe") ||
    l.includes('a rejoint la équipe')
  ) {
    return null;
  }

  let m =
    details.match(/associated sprint "([^"]+)" with/i) ||
    details.match(/a associé le sprint "([^"]+)" à/i);
  if (m) return { kind: 'sprintAssociated', sprintName: m[1] };

  m =
    details.match(/removed sprint "([^"]+)" from/i) ||
    details.match(/a retiré le sprint "([^"]+)" de/i);
  if (m) return { kind: 'sprintRemoved', sprintName: m[1] };

  m =
    details.match(/associated tag "([^"]+)" with/i) ||
    details.match(/a associé l'étiquette "([^"]+)" à/i);
  if (m) return { kind: 'tagAssociated', tagName: m[1] };

  m =
    details.match(/removed tag "([^"]+)" from/i) ||
    details.match(/a retiré l'étiquette "([^"]+)" de/i);
  if (m) return { kind: 'tagRemoved', tagName: m[1] };

  if (
    l.includes('changed sprint to') ||
    l.includes('a modifié le sprint à') ||
    l.includes('cleared sprint on') ||
    l.includes('a retiré le sprint sur')
  ) {
    m =
      details.match(/changed sprint to "([^"]+)"/i) ||
      details.match(/a modifié le sprint à "([^"]+)"/i);
    return { kind: 'sprintAssociated', sprintName: m?.[1] ?? '' };
  }

  if (l.includes('comment') || l.includes('commentaire')) {
    return tickets.length > 0 ? { kind: 'commented' } : null;
  }

  if (
    action.includes('agent_job_done') ||
    l.includes('finished agent work') ||
    l.includes("a terminé le travail de l'agent")
  ) {
    return tickets.length > 0 ? { kind: 'agentDone' } : null;
  }
  if (
    action.includes('agent_job_failed') ||
    l.includes('agent job failed') ||
    l.includes("échec du travail de l'agent")
  ) {
    return tickets.length > 0 ? { kind: 'agentFailed' } : null;
  }

  if (
    action.includes('delete') ||
    l.includes('deleted task') ||
    l.includes('a supprimé la tâche') ||
    l.includes('to trash') ||
    l.includes('vers la corbeille') ||
    l.includes('bulkdeleted')
  ) {
    return { kind: 'deleted' };
  }

  if (
    action.includes('create') ||
    l.includes('created a new task') ||
    l.includes('a créé une nouvelle tâche') ||
    (l.includes('created task') && tickets.length > 0) ||
    (l.includes('a créé la tâche') && tickets.length > 0)
  ) {
    return { kind: 'created' };
  }

  if (
    action.includes('restore') ||
    l.includes('restored task') ||
    l.includes('a restauré la tâche')
  ) {
    return { kind: 'restored' };
  }

  if (
    action.includes('copy') ||
    l.includes('copied task') ||
    l.includes('a copié la tâche') ||
    l.includes('bulkcopied')
  ) {
    return { kind: 'copied' };
  }

  if (
    l.includes('archived') ||
    l.includes('a archivé') ||
    l.includes('undid archive') ||
    l.includes("annulé l'archivage")
  ) {
    return { kind: 'archived' };
  }

  if (isColumnMoveActivity(action, details)) {
    return { kind: 'moved' };
  }

  if (action.includes('move')) {
    return { kind: 'moved' };
  }

  if (action.includes('associate_tag') || action.includes('disassociate_tag')) {
    return tickets.length > 0 ? { kind: 'updated' } : null;
  }

  if (action.includes('update') && tickets.length > 0) {
    return { kind: 'updated' };
  }

  return tickets.length > 0 ? { kind: 'updated' } : null;
}

function formatTicketSubjects(
  tickets: string[],
  details: string,
  t: TFunction
): { subjects: string; count: number } | null {
  if (tickets.length > 0) {
    const count = tickets.length;
    if (tickets.length <= 4) {
      return { subjects: tickets.join(', '), count };
    }
    return {
      subjects: t('activityFeed.compact.ticketListTruncated', {
        shown: tickets.slice(0, 3).join(', '),
        count: tickets.length - 3,
      }),
      count,
    };
  }
  const countMatch =
    details.match(/(\d+)\s+tasks?\b/i) ||
    details.match(/(\d+)\s+tâches?\b/i);
  if (countMatch) {
    const count = Number(countMatch[1]);
    return {
      subjects: t('activityFeed.compact.taskCount', { count }),
      count,
    };
  }
  return null;
}

/** Short task-impact line for compact feed view; null hides the row. */
export function summarizeActivityImpact(
  activity: ActivityImpactInput,
  knownProjectIds: Set<string>,
  t: TFunction
): string | null {
  const details = activity.details || '';
  const tickets = extractActivityTaskTickets(
    details,
    activity.taskTicket,
    activity.projectId,
    knownProjectIds
  );
  const classified = classifyActivityImpact(activity.action, details, tickets);
  if (!classified) return null;

  const { kind, sprintName, tagName } = classified;

  const formatted = formatTicketSubjects(tickets, details, t);
  if (!formatted) return null;

  const { subjects, count } = formatted;
  const compactKey = (key: string, extra: Record<string, string> = {}) =>
    t(`activityFeed.compact.${key}`, { tickets: subjects, count, ...extra });

  switch (kind) {
    case 'moved':
      return compactKey('moved');
    case 'deleted':
      return compactKey('deleted');
    case 'created':
      return compactKey('created');
    case 'updated':
      return compactKey('updated');
    case 'restored':
      return compactKey('restored');
    case 'copied':
      return compactKey('copied');
    case 'archived':
      return compactKey('archived');
    case 'sprintAssociated':
      return compactKey('associatedToSprint', {
        sprintName: sprintName || t('activityFeed.compact.unknownSprint'),
      });
    case 'sprintRemoved':
      return compactKey('removedFromSprint', {
        sprintName: sprintName || t('activityFeed.compact.unknownSprint'),
      });
    case 'tagAssociated':
      return compactKey('associatedTag', {
        tagName: tagName || t('activityFeed.compact.unknownTag'),
      });
    case 'tagRemoved':
      return compactKey('removedTag', {
        tagName: tagName || t('activityFeed.compact.unknownTag'),
      });
    case 'commented':
      return compactKey('commented');
    case 'agentDone':
      return compactKey('agentDone');
    case 'agentFailed':
      return compactKey('agentFailed');
    default:
      return null;
  }
}
