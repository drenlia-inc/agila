import type { TFunction } from 'i18next';
import axios from 'axios';

export type RelationshipConflictCode =
  | 'RELATIONSHIP_ALREADY_EXISTS'
  | 'PARENT_CHILD_EXISTS'
  | 'RELATED_EXISTS';

export interface RelationshipCreateErrorInfo {
  title: string;
  message: string;
  isConflict: boolean;
}

type RelationshipErrorPayload = {
  code?: string;
  error?: string;
  message?: string;
  status?: number;
};

function payloadFromUnknown(error: unknown): RelationshipErrorPayload {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const body =
      data && typeof data === 'object'
        ? (data as { code?: string; error?: string; message?: string })
        : {};
    return {
      status: error.response?.status,
      code: body.code,
      error: body.error,
      message: body.message,
    };
  }

  if (error && typeof error === 'object') {
    const e = error as {
      status?: number;
      code?: string;
      message?: string;
      response?: { data?: { code?: string; error?: string; message?: string } };
    };
    const body = e.response?.data;
    return {
      status: e.status ?? undefined,
      code: e.code ?? body?.code,
      error: body?.error,
      message: body?.message ?? (error instanceof Error ? error.message : undefined),
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return {};
}

export function getRelationshipCreateErrorInfo(
  error: unknown,
  t: TFunction<'tasks'>
): RelationshipCreateErrorInfo {
  const payload = payloadFromUnknown(error);
  const serverMessage = payload.error || payload.message;

  if (payload.code === 'PARENT_CHILD_EXISTS') {
    return {
      title: t('relationships.linkConflictTitle'),
      message: t('relationships.parentChildAlreadyExists'),
      isConflict: true,
    };
  }

  if (payload.code === 'RELATED_EXISTS') {
    return {
      title: t('relationships.linkConflictTitle'),
      message: t('relationships.relatedAlreadySet'),
      isConflict: true,
    };
  }

  if (
    payload.code === 'RELATIONSHIP_ALREADY_EXISTS' ||
    (payload.status === 409 &&
      /already exists|existe déjà|parent-child|parent-enfant|already linked|déjà liées/i.test(
        serverMessage || ''
      ))
  ) {
    return {
      title: t('relationships.linkAlreadyExistsTitle'),
      message: serverMessage || t('relationships.relationshipAlreadyExists'),
      isConflict: true,
    };
  }

  return {
    title: t('relationships.linkFailedTitle'),
    message: serverMessage || t('relationships.linkFailedTitle'),
    isConflict: false,
  };
}

export function showRelationshipCreateErrorToast(
  error: unknown,
  t: TFunction<'tasks'>,
  toastFn: {
    warning: (title: string, message: string) => void;
    error: (title: string, message: string) => void;
  }
): void {
  const info = getRelationshipCreateErrorInfo(error, t);
  if (info.isConflict) {
    toastFn.warning(info.title, info.message);
  } else {
    toastFn.error(info.title, info.message);
  }
}
