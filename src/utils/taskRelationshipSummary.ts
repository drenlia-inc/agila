/** Matches GET /boards/:boardId/relationships rows */
export interface BoardRelationshipEdge {
  id?: string;
  taskId: string;
  toTaskId: string;
  relationship: 'parent' | 'child' | 'related' | string;
  createdAt?: string;
}

export interface TaskRelationshipSummary {
  hasParent: boolean;
  hasChildren: boolean;
  hasRelated: boolean;
  hasAny: boolean;
}

const EMPTY_SUMMARY: TaskRelationshipSummary = {
  hasParent: false,
  hasChildren: false,
  hasRelated: false,
  hasAny: false,
};

function ensureEntry(
  map: Map<string, TaskRelationshipSummary>,
  taskId: string
): TaskRelationshipSummary {
  let entry = map.get(taskId);
  if (!entry) {
    entry = { ...EMPTY_SUMMARY };
    map.set(taskId, entry);
  }
  return entry;
}

/**
 * Build per-task parent/child/related flags from same-board relationship edges.
 * Both directed rows and their inverses (when present) are handled.
 */
export function buildTaskRelationshipSummaryMap(
  relationships: BoardRelationshipEdge[] | null | undefined
): Map<string, TaskRelationshipSummary> {
  const map = new Map<string, TaskRelationshipSummary>();
  if (!relationships?.length) return map;

  for (const rel of relationships) {
    const from = rel.taskId;
    const to = rel.toTaskId;
    if (!from || !to) continue;

    const type = rel.relationship;
    if (type === 'parent') {
      // from is parent of to
      const parent = ensureEntry(map, from);
      parent.hasChildren = true;
      parent.hasAny = true;
      const child = ensureEntry(map, to);
      child.hasParent = true;
      child.hasAny = true;
    } else if (type === 'child') {
      // from is child of to (to is parent)
      const child = ensureEntry(map, from);
      child.hasParent = true;
      child.hasAny = true;
      const parent = ensureEntry(map, to);
      parent.hasChildren = true;
      parent.hasAny = true;
    } else if (type === 'related') {
      const a = ensureEntry(map, from);
      a.hasRelated = true;
      a.hasAny = true;
      const b = ensureEntry(map, to);
      b.hasRelated = true;
      b.hasAny = true;
    }
  }

  return map;
}

export function getTaskRelationshipSummary(
  map: Map<string, TaskRelationshipSummary> | null | undefined,
  taskId: string
): TaskRelationshipSummary {
  return map?.get(taskId) ?? EMPTY_SUMMARY;
}

/** Task ids that participate in at least one same-board relationship edge. */
export function buildLinkedTaskIdSet(
  relationships: BoardRelationshipEdge[] | null | undefined
): Set<string> {
  const map = buildTaskRelationshipSummaryMap(relationships);
  const ids = new Set<string>();
  for (const [taskId, summary] of map.entries()) {
    if (summary.hasAny) ids.add(taskId);
  }
  return ids;
}

/** Normalize board / API relationship row keys (camelCase or snake_case). */
export function normalizeBoardRelationshipEdge(
  rel: BoardRelationshipEdge | Record<string, unknown> | null | undefined
): BoardRelationshipEdge | null {
  if (!rel || typeof rel !== 'object') return null;
  const r = rel as Record<string, unknown>;
  const taskId = String(r.taskId ?? r.task_id ?? '');
  const toTaskId = String(r.toTaskId ?? r.to_task_id ?? '');
  const relationship = String(r.relationship ?? '');
  if (!taskId || !toTaskId || !relationship) return null;
  const id = r.id != null ? String(r.id) : undefined;
  return {
    id,
    taskId,
    toTaskId,
    relationship,
    createdAt: r.createdAt != null ? String(r.createdAt) : r.created_at != null ? String(r.created_at) : undefined,
  };
}

/**
 * Relationship of `otherTaskId` relative to `hoveredTaskId` using board edges.
 * Returns what badge the other card should show (parent/child/related of hovered).
 */
export function getBoardRelationshipType(
  relationships: BoardRelationshipEdge[] | null | undefined,
  hoveredTaskId: string,
  otherTaskId: string
): 'parent' | 'child' | 'related' | null {
  if (!relationships?.length || !hoveredTaskId || !otherTaskId || hoveredTaskId === otherTaskId) {
    return null;
  }

  for (const raw of relationships) {
    const rel = normalizeBoardRelationshipEdge(raw);
    if (!rel) continue;
    const from = rel.taskId;
    const to = rel.toTaskId;
    const type = rel.relationship;

    if (type === 'parent') {
      // hovered is parent of other → other is child
      if (from === hoveredTaskId && to === otherTaskId) return 'child';
      // other is parent of hovered → other is parent
      if (from === otherTaskId && to === hoveredTaskId) return 'parent';
    } else if (type === 'child') {
      // hovered is child of other → other is parent
      if (from === hoveredTaskId && to === otherTaskId) return 'parent';
      // other is child of hovered → other is child
      if (from === otherTaskId && to === hoveredTaskId) return 'child';
    } else if (type === 'related') {
      if (
        (from === hoveredTaskId && to === otherTaskId) ||
        (from === otherTaskId && to === hoveredTaskId)
      ) {
        return 'related';
      }
    }
  }

  return null;
}

/** Find a board edge connecting two tasks (either direction). */
export function findBoardRelationshipEdge(
  relationships: BoardRelationshipEdge[] | null | undefined,
  taskIdA: string,
  taskIdB: string
): BoardRelationshipEdge | null {
  if (!relationships?.length || !taskIdA || !taskIdB || taskIdA === taskIdB) {
    return null;
  }
  for (const raw of relationships) {
    const rel = normalizeBoardRelationshipEdge(raw);
    if (!rel) continue;
    if (
      (rel.taskId === taskIdA && rel.toTaskId === taskIdB) ||
      (rel.taskId === taskIdB && rel.toTaskId === taskIdA)
    ) {
      return rel;
    }
  }
  return null;
}

/** Unique counterpart task IDs linked to `taskId` on this board. */
export function getBoardRelationshipCounterpartIds(
  relationships: BoardRelationshipEdge[] | null | undefined,
  taskId: string
): string[] {
  if (!relationships?.length || !taskId) return [];
  const ids = new Set<string>();
  for (const raw of relationships) {
    const rel = normalizeBoardRelationshipEdge(raw);
    if (!rel) continue;
    if (rel.taskId === taskId) ids.add(rel.toTaskId);
    if (rel.toTaskId === taskId) ids.add(rel.taskId);
  }
  return [...ids];
}

/**
 * Prefer the same row Task Details deletes: parent's "parent" edge, else child's "child", else related.
 */
export function pickBoardRelationshipEdgeToDelete(
  relationships: BoardRelationshipEdge[] | null | undefined,
  taskIdA: string,
  taskIdB: string
): BoardRelationshipEdge | null {
  if (!relationships?.length || !taskIdA || !taskIdB || taskIdA === taskIdB) {
    return null;
  }
  const normalized = relationships
    .map((raw) => normalizeBoardRelationshipEdge(raw))
    .filter((e): e is BoardRelationshipEdge => !!e && !!e.id);

  const involves = (e: BoardRelationshipEdge) =>
    (e.taskId === taskIdA && e.toTaskId === taskIdB) ||
    (e.taskId === taskIdB && e.toTaskId === taskIdA);

  return (
    normalized.find((e) => e.relationship === 'parent' && involves(e)) ||
    normalized.find((e) => e.relationship === 'child' && involves(e)) ||
    normalized.find((e) => e.relationship === 'related' && involves(e)) ||
    null
  );
}
