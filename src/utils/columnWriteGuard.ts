/**
 * Local column moves paint immediately, then POST /tasks/batch-update-positions.
 * A GET /full that started before that commit, or a delayed WebSocket echo of
 * the previous move, will put cards back. Track the write so those snapshots
 * are dropped.
 */

let generation = 0;
let inflight = 0;
/** Client time of the latest local column-position write. */
let ignoreSelfLayoutBeforeMs = 0;
/** Prior move must commit before undo, or the slower request lands last and restores the move. */
let writeChain: Promise<unknown> = Promise.resolve();

const CLOCK_SKEW_MS = 2000;

export function beginColumnWrite(): void {
  inflight += 1;
  ignoreSelfLayoutBeforeMs = Date.now();
  generation += 1;
}

export function endColumnWrite(): void {
  inflight = Math.max(0, inflight - 1);
  generation += 1;
}

/**
 * Run column-position saves in order. Callers paint optimistic state first;
 * the HTTP work waits so an undo cannot commit and then be overwritten by the
 * move it undoes.
 */
export function enqueueColumnWrite<T>(work: () => Promise<T>): Promise<T> {
  beginColumnWrite();
  const run = writeChain.then(work, work);
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    endColumnWrite();
  });
}

export function columnWriteGeneration(): number {
  return generation;
}

export function columnWriteInFlight(): boolean {
  return inflight > 0;
}

type LayoutEcho = {
  timestamp?: string;
  task?: {
    updatedBy?: string;
    columnId?: string;
    position?: unknown;
    previousColumnId?: string;
  };
  updatedBy?: string;
};

/**
 * Ignore this client's own column/position echoes that predate the latest
 * local move (or arrive while that move is still saving).
 */
export function shouldIgnoreSelfLayoutEcho(
  data: LayoutEcho | null | undefined,
  currentUserId: string | null | undefined
): boolean {
  if (!currentUserId || !data?.task) return false;
  const updatedBy = data.task.updatedBy || data.updatedBy;
  if (!updatedBy || updatedBy !== currentUserId) return false;

  const task = data.task;
  const isLayout =
    task.columnId != null || task.position != null || task.previousColumnId != null;
  if (!isLayout) return false;

  if (inflight > 0) return true;
  if (!ignoreSelfLayoutBeforeMs || !data.timestamp) return false;

  const eventMs = Date.parse(data.timestamp);
  if (!Number.isFinite(eventMs)) return false;
  return eventMs < ignoreSelfLayoutBeforeMs - CLOCK_SKEW_MS;
}
