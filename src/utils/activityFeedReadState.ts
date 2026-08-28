/** True when an activity should show as unread in the feed. */
export function isActivityUnread(
  activityId: number,
  lastSeenActivityId: number,
  readActivityIds: ReadonlySet<number>
): boolean {
  if (activityId <= lastSeenActivityId) return false;
  if (readActivityIds.has(activityId)) return false;
  return true;
}
