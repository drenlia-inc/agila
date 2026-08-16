/**
 * Utility function to truncate member display names for dropdowns
 * Limits names to 30 characters with ellipsis if longer
 */
export const truncateMemberName = (name: string, maxLength: number = 30): string => {
  if (name.length <= maxLength) {
    return name;
  }
  return name.substring(0, maxLength) + '...';
};

export function memberIsViewer(member?: { isViewer?: boolean } | null): boolean {
  return Boolean(member?.isViewer);
}

