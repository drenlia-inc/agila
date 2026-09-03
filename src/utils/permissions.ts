import type { CurrentUser } from '../types';

/** Instance-wide board/task mutation rights (admin/user). Viewers are read-only for domain data. */
export function userCanMutate(user: CurrentUser | null | undefined): boolean {
  if (!user?.roles?.length) {
    // Legacy: treat missing roles as full user (should not happen when logged in)
    return Boolean(user);
  }
  if (user.roles.includes('admin') || user.roles.includes('user')) return true;
  return false;
}

export function userIsViewer(user: CurrentUser | null | undefined): boolean {
  if (!user?.roles?.length) return false;
  return user.roles.includes('viewer') && !userCanMutate(user);
}

export function userIsAdmin(user: CurrentUser | null | undefined): boolean {
  return Boolean(user?.roles?.includes('admin'));
}

/** CSV/XLSX export — not available to viewers. */
export function userCanExport(user: CurrentUser | null | undefined): boolean {
  return userCanMutate(user);
}

export type AppRole = 'admin' | 'user' | 'viewer';

export function rolesForAppRole(role: string): string[] {
  if (role === 'admin') return ['admin'];
  if (role === 'viewer') return ['viewer'];
  return ['user'];
}

export function sameRoleList(a?: string[] | null, b?: string[] | null): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  return left.every((role, index) => role === right[index]);
}

export function primaryAppRole(user: CurrentUser | null | undefined): AppRole {
  if (!user?.roles?.length) return 'user';
  if (user.roles.includes('admin')) return 'admin';
  if (user.roles.includes('user')) return 'user';
  if (user.roles.includes('viewer')) return 'viewer';
  return 'user';
}
