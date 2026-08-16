import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import api, {
  AdminWebhook,
  WebhookPlatform,
  createAdminWebhook,
  deleteAdminWebhook,
  getAdminWebhooks,
  getBoards,
  getPriorities,
  patchAdminWebhookEnabled,
  testAdminWebhook,
  updateAdminWebhook,
} from '../../api';
import { toast } from '../../utils/toast';
import { useEscapeDismiss } from '../../hooks/useEscapeDismiss';
import { createPortal } from 'react-dom';
import { isMultiTenantDeploy } from '../../utils/ownerSetup';
import {
  AdminPageShell,
  AdminSection,
  adminInputBoundedClass,
  adminInputWideClass,
} from './AdminSection';
import { AdminToggle } from './AdminToggle';
import { BetaSup } from '../HelpAssistantTitle';
import { KanbanChromeTooltip } from '../KanbanChromeTooltip';
import {
  AdminNotificationChannelMode,
  ConfirmWebhooksOnlyDialog,
  type TaskNotificationChannel,
} from './AdminNotificationChannelMode';
import {
  WEBHOOK_EVENT_KEYS,
  normalizeWebhookEventTypes,
} from '../../constants/webhookEvents';

const PLATFORMS: WebhookPlatform[] = ['slack', 'mattermost', 'teams', 'telegram', 'whatsapp'];
const URL_PLATFORMS = new Set<WebhookPlatform>(['slack', 'mattermost', 'teams']);
const WEBHOOK_NAME_MAX = 100;

const EVENT_DOT_CLASS: Record<string, string> = {
  taskCreated: 'bg-blue-500',
  taskChanged: 'bg-green-500',
  taskDeleted: 'bg-red-500',
  boardCreated: 'bg-purple-500',
  boardRenamed: 'bg-amber-500',
  boardDeleted: 'bg-rose-500',
};

const URL_PLACEHOLDERS: Record<string, string> = {
  slack: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX',
  mattermost: 'https://mattermost.example.com/hooks/xxxxxxxxxxxxxxxx',
  teams: 'https://outlook.office.com/webhook/xxxxxxxx',
};

function looksLikeMaskedWebhookUrl(value: string): boolean {
  const raw = String(value || '');
  if (!raw.trim()) return false;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (/%E2%80%A2/i.test(raw)) return true;
  if (/[•\u2022]/.test(raw) || /[•\u2022]/.test(decoded)) return true;
  return false;
}

function previewIncomingWebhookUrl(url: string): string {
  const s = String(url || '').trim();
  if (!s || looksLikeMaskedWebhookUrl(s)) {
    try {
      const cleaned = s
        .replace(/%E2%80%A2/gi, '')
        .replace(/[•\u2022]+/g, '')
        .replace(/\/+$/, '');
      const u = new URL(cleaned || s);
      return `${u.origin}/…`;
    } catch {
      return 'https://…';
    }
  }
  try {
    const u = new URL(s);
    const firstSeg = u.pathname.split('/').filter(Boolean)[0];
    return firstSeg ? `${u.origin}/${firstSeg}/…` : `${u.origin}/…`;
  } catch {
    if (s.length <= 24) return s;
    return `${s.slice(0, 18)}…`;
  }
}

function sanitizeIncomingWebhookUrl(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\s\u0000-\u001F\u007F]+/g, '');
}

type Draft = {
  id?: string;
  name: string;
  platform: WebhookPlatform;
  enabled: boolean;
  eventTypes: Record<string, boolean>;
  projectIds: string[];
  minPriorityId: string;
  locale: string;
  endpointUrl: string;
  urlCollapsedPreview?: string;
  hasEndpointUrl?: boolean;
  telegramBotToken: string;
  hasTelegramBotToken?: boolean;
  telegramChatId: string;
  whatsappAccessToken: string;
  hasWhatsappAccessToken?: boolean;
  whatsappPhoneNumberId: string;
  whatsappTo: string;
  whatsappGraphVersion: string;
};

function toDraft(row?: AdminWebhook): Draft {
  return {
    id: row?.id,
    name: row?.name || '',
    platform: row?.platform || 'slack',
    enabled: row?.enabled !== false,
    eventTypes: normalizeWebhookEventTypes(row?.eventTypes || {}),
    projectIds: row?.projectIds || [],
    minPriorityId: row?.minPriorityId || '',
    locale: row?.locale || '',
    endpointUrl: looksLikeMaskedWebhookUrl(row?.endpointUrl || '') ? '' : row?.endpointUrl || '',
    urlCollapsedPreview: previewIncomingWebhookUrl(row?.endpointUrl || ''),
    hasEndpointUrl: Boolean(row?.hasEndpointUrl || row?.endpointUrl),
    telegramBotToken: '',
    hasTelegramBotToken: Boolean(row?.hasTelegramBotToken),
    telegramChatId: row?.telegramChatId || '',
    whatsappAccessToken: '',
    hasWhatsappAccessToken: Boolean(row?.hasWhatsappAccessToken),
    whatsappPhoneNumberId: row?.whatsappPhoneNumberId || '',
    whatsappTo: row?.whatsappTo || '',
    whatsappGraphVersion: row?.whatsappGraphVersion || 'v21.0',
  };
}

/** Stable snapshot for dirty-checking the Add/Edit form. */
function draftFingerprint(d: Draft): string {
  return JSON.stringify({
    name: d.name.trim(),
    platform: d.platform,
    enabled: d.enabled,
    eventTypes: normalizeWebhookEventTypes(d.eventTypes),
    projectIds: [...(d.projectIds || [])].map(String).sort(),
    minPriorityId: d.minPriorityId || '',
    locale: d.locale || '',
    endpointUrl: sanitizeIncomingWebhookUrl(d.endpointUrl),
    telegramBotToken: d.telegramBotToken || '',
    telegramChatId: d.telegramChatId || '',
    whatsappAccessToken: d.whatsappAccessToken || '',
    whatsappPhoneNumberId: d.whatsappPhoneNumberId || '',
    whatsappTo: d.whatsappTo || '',
    whatsappGraphVersion: d.whatsappGraphVersion || 'v21.0',
  });
}

const iconBtnClass =
  'rounded p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50';

const AdminWebhooksTab: React.FC<{
  settings: { [key: string]: string | undefined };
  editingSettings: { [key: string]: string | undefined };
  onSettingsChange: (settings: { [key: string]: string | undefined }) => void;
  onSave: (settings?: { [key: string]: string | undefined }) => Promise<void>;
}> = ({ settings, editingSettings, onSettingsChange, onSave }) => {
  const { t } = useTranslation('admin');
  const [rows, setRows] = useState<AdminWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  /** Fingerprint when the form was opened (edit only). Null = new webhook. */
  const [editingBaseline, setEditingBaseline] = useState<string | null>(null);
  /** -1 = unlimited; Basic SaaS = 1 */
  const [webhookCreateLimit, setWebhookCreateLimit] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AdminWebhook | null>(null);
  const [confirmWebhooksOnly, setConfirmWebhooksOnly] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [priorities, setPriorities] = useState<{ id: string; priority?: string; position?: number }[]>(
    []
  );

  const [urlFieldFocused, setUrlFieldFocused] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editorRef.current;
    if (!el) return;
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'start', behavior: 'smooth', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [editing?.id, editing != null]);

  useEscapeDismiss(
    () => {
      if (confirmDelete) {
        setConfirmDelete(null);
        return;
      }
      if (confirmWebhooksOnly) {
        setConfirmWebhooksOnly(false);
        return;
      }
      if (editing) {
        setEditing(null);
        setEditingBaseline(null);
      }
    },
    { enabled: Boolean(editing || confirmDelete || confirmWebhooksOnly) }
  );

  const channelMode =
    editingSettings.TASK_NOTIFICATION_CHANNELS || settings.TASK_NOTIFICATION_CHANNELS || 'email';

  const load = async () => {
    try {
      setLoading(true);
      const [hooks, boards, pris, licenseRes] = await Promise.all([
        getAdminWebhooks(),
        getBoards().catch(() => []),
        getPriorities().catch(() => []),
        api.get('/auth/license-info').catch(() => null),
      ]);
      setRows(hooks || []);
      const licenseInfo = licenseRes?.data;
      if (
        isMultiTenantDeploy() &&
        licenseInfo?.enabled &&
        String(licenseInfo?.limits?.SUPPORT_LEVEL || '').toLowerCase() === 'basic'
      ) {
        setWebhookCreateLimit(1);
      } else {
        setWebhookCreateLimit(-1);
      }
      const seen = new Map<string, string[]>();
      for (const b of boards || []) {
        const id = String(b.project || '');
        const title = String(b.title || '').trim();
        if (!id) continue;
        const titles = seen.get(id) || [];
        if (title && !titles.includes(title)) titles.push(title);
        seen.set(id, titles);
      }
      setProjects(
        [...seen.entries()].map(([id, titles]) => ({
          id,
          name: titles.join(', '),
        }))
      );
      setPriorities(pris || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('webhooks.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (rows.length > 0) return;
    if (channelMode !== 'both' && channelMode !== 'webhooks') return;
    const next = {
      ...editingSettings,
      TASK_NOTIFICATION_CHANNELS: 'email',
    };
    onSettingsChange(next);
    void onSave(next);
  }, [loading, rows.length, channelMode]);

  const uncoveredProjects = useMemo(() => {
    if (channelMode !== 'webhooks') return [];
    const enabled = rows.filter((r) => r.enabled);
    if (enabled.some((r) => !r.projectIds?.length)) return [];
    const covered = new Set(enabled.flatMap((r) => r.projectIds || []));
    return projects.filter((p) => !covered.has(p.id));
  }, [channelMode, rows, projects]);

  const persistChannel = async (value: TaskNotificationChannel) => {
    if ((value === 'both' || value === 'webhooks') && rows.length === 0) return;
    const next = {
      ...editingSettings,
      TASK_NOTIFICATION_CHANNELS: value,
    };
    onSettingsChange(next);
    try {
      await onSave(next);
      toast.success(t('webhooks.channelSaved'));
    } catch {
      toast.error(t('failedToSaveSettings'));
    }
  };

  const handleChannelSelect = (mode: TaskNotificationChannel) => {
    if (mode === 'webhooks') {
      setConfirmWebhooksOnly(true);
      return;
    }
    void persistChannel(mode);
  };

  const saveDraft = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = {
        name: editing.name.trim().slice(0, WEBHOOK_NAME_MAX),
        platform: editing.platform,
        enabled: editing.enabled,
        eventTypes: editing.eventTypes,
        projectIds: editing.projectIds,
        minPriorityId: editing.minPriorityId || null,
        locale: editing.locale || null,
        endpointUrl: sanitizeIncomingWebhookUrl(editing.endpointUrl),
        telegramBotToken: editing.telegramBotToken,
        telegramChatId: editing.telegramChatId,
        whatsappAccessToken: editing.whatsappAccessToken,
        whatsappPhoneNumberId: editing.whatsappPhoneNumberId,
        whatsappTo: editing.whatsappTo,
        whatsappGraphVersion: editing.whatsappGraphVersion,
      };
      if (editing.id) {
        await updateAdminWebhook(editing.id, body);
      } else {
        await createAdminWebhook(body);
      }
      toast.success(t('webhooks.saved'));
      setUrlFieldFocused(false);
      setEditing(null);
      setEditingBaseline(null);
      await load();
    } catch (e: any) {
      const data = e?.response?.data;
      if (data?.limit === 'WEBHOOK_LIMIT') {
        toast.error(t('webhooks.planLimitBasic'));
      } else {
        toast.error(data?.error || t('webhooks.saveError'));
      }
    } finally {
      setSaving(false);
    }
  };

  const atWebhookCreateLimit =
    webhookCreateLimit !== -1 && rows.length >= webhookCreateLimit;

  const startNewWebhook = () => {
    if (atWebhookCreateLimit) {
      toast.error(t('webhooks.planLimitBasic'));
      return;
    }
    setUrlFieldFocused(false);
    setEditingBaseline(null);
    setEditing(toDraft());
  };

  const startEditWebhook = (row: AdminWebhook) => {
    setUrlFieldFocused(false);
    const draft = toDraft(row);
    setEditingBaseline(draftFingerprint(draft));
    setEditing(draft);
  };

  const draftHasChanges = useMemo(() => {
    if (!editing) return false;
    if (!editing.id || editingBaseline == null) {
      return Boolean(editing.name.trim());
    }
    return draftFingerprint(editing) !== editingBaseline;
  }, [editing, editingBaseline]);

  const toggleRowEnabled = async (row: AdminWebhook, next: boolean) => {
    if (togglingId) return;
    setTogglingId(row.id);
    const previous = row.enabled;
    setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)));
    if (editing?.id === row.id) {
      const nextDraft = { ...editing, enabled: next };
      setEditing(nextDraft);
      setEditingBaseline(draftFingerprint(nextDraft));
    }
    try {
      const saved = await patchAdminWebhookEnabled(row.id, next);
      setRows((cur) => cur.map((r) => (r.id === saved.id ? saved : r)));
    } catch (e: any) {
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, enabled: previous } : r)));
      if (editing?.id === row.id) {
        const reverted = { ...editing, enabled: previous };
        setEditing(reverted);
        setEditingBaseline(draftFingerprint(reverted));
      }
      toast.error(e?.response?.data?.error || t('webhooks.saveError'));
    } finally {
      setTogglingId(null);
    }
  };

  const runTest = async (id: string) => {
    setTestingId(id);
    try {
      await testAdminWebhook(id);
      toast.success(t('webhooks.testOk'));
    } catch (e: any) {
      toast.error(e?.response?.data?.error || t('webhooks.testError'));
    } finally {
      setTestingId(null);
    }
  };

  const testButton = (id: string, compact = false) => {
    const busy = testingId === id;
    return (
      <KanbanChromeTooltip label={t('webhooks.testTooltip')}>
        <button
          type="button"
          className={
            compact
              ? iconBtnClass
              : 'inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 disabled:opacity-50'
          }
          onClick={() => void runTest(id)}
          disabled={Boolean(testingId)}
          aria-label={t('webhooks.test')}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {!compact ? t('webhooks.test') : null}
        </button>
      </KanbanChromeTooltip>
    );
  };

  return (
    <div data-tour-id="admin-webhooks">
      <AdminPageShell width="full">
        <AdminNotificationChannelMode
          radioName="task-notification-channels"
          channelMode={channelMode}
          webhookCount={rows.length}
          uncoveredProjects={uncoveredProjects}
          onSelect={handleChannelSelect}
        />

        <AdminSection
          title={
            <>
              {t('webhooks.listTitle')}
              <BetaSup />
            </>
          }
          dense
          settingKey="WEBHOOKS_LIST"
        >
          {loading ? (
            <p className="text-sm text-gray-500">{t('webhooks.loading')}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <KanbanChromeTooltip
                  label={
                    atWebhookCreateLimit
                      ? t('webhooks.planLimitBasic')
                      : t('webhooks.addTooltip')
                  }
                >
                  <button
                    type="button"
                    onClick={startNewWebhook}
                    disabled={atWebhookCreateLimit}
                    className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t('webhooks.add')}
                  </button>
                </KanbanChromeTooltip>
                {atWebhookCreateLimit ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('webhooks.planLimitBasic')}
                  </p>
                ) : null}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('webhooks.empty')}</p>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-center gap-2 py-2">
                      <div className="flex shrink-0 gap-1">
                        {testButton(row.id, true)}
                        <KanbanChromeTooltip label={t('webhooks.editTooltip')}>
                          <button
                            type="button"
                            className={iconBtnClass}
                            onClick={() => startEditWebhook(row)}
                            aria-label={t('webhooks.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </KanbanChromeTooltip>
                        <KanbanChromeTooltip label={t('webhooks.deleteTooltip')}>
                          <button
                            type="button"
                            className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            onClick={() => setConfirmDelete(row)}
                            aria-label={t('webhooks.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </KanbanChromeTooltip>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {row.name}
                          <span className="ml-2 text-xs font-normal text-gray-500">
                            {t(`webhooks.platforms.${row.platform}`)}
                          </span>
                        </p>
                      </div>
                      <AdminToggle
                        checked={row.enabled}
                        disabled={togglingId === row.id}
                        onChange={(next) => void toggleRowEnabled(row, next)}
                        label={row.enabled ? t('webhooks.enabled') : t('webhooks.disabled')}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </AdminSection>

        {editing && (
          <div ref={editorRef} className="scroll-mt-40">
          <AdminSection title={editing.id ? t('webhooks.edit') : t('webhooks.add')} dense>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('webhooks.name')}
                <input
                  className={adminInputBoundedClass}
                  value={editing.name}
                  maxLength={WEBHOOK_NAME_MAX}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value.slice(0, WEBHOOK_NAME_MAX) })}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('webhooks.platform')}
                <select
                  className={adminInputBoundedClass}
                  value={editing.platform}
                  onChange={(e) =>
                    setEditing({ ...editing, platform: e.target.value as WebhookPlatform })
                  }
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {t(`webhooks.platforms.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('webhooks.language')}
                <select
                  className={adminInputBoundedClass}
                  value={editing.locale}
                  onChange={(e) => setEditing({ ...editing, locale: e.target.value })}
                >
                  <option value="">{t('webhooks.languageSiteDefault')}</option>
                  <option value="en">English</option>
                  <option value="fr">Français</option>
                </select>
              </label>
              <div className="flex items-end">
                <AdminToggle
                  checked={editing.enabled}
                  onChange={(next) => setEditing({ ...editing, enabled: next })}
                  label={editing.enabled ? t('webhooks.enabled') : t('webhooks.disabled')}
                />
              </div>
              {URL_PLATFORMS.has(editing.platform) && (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
                  {t('webhooks.endpointUrl')}
                  {!urlFieldFocused &&
                  (editing.endpointUrl || editing.urlCollapsedPreview || editing.hasEndpointUrl) ? (
                    <button
                      type="button"
                      className={`${adminInputWideClass} text-left font-normal`}
                      onClick={() => setUrlFieldFocused(true)}
                    >
                      {previewIncomingWebhookUrl(editing.endpointUrl) ||
                        editing.urlCollapsedPreview ||
                        'https://…'}
                    </button>
                  ) : (
                    <input
                      className={adminInputWideClass}
                      value={editing.endpointUrl}
                      placeholder={URL_PLACEHOLDERS[editing.platform] || URL_PLACEHOLDERS.slack}
                      autoFocus={urlFieldFocused}
                      onFocus={() => setUrlFieldFocused(true)}
                      onBlur={() => setUrlFieldFocused(false)}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          endpointUrl: sanitizeIncomingWebhookUrl(e.target.value),
                        })
                      }
                      autoComplete="off"
                    />
                  )}
                </label>
              )}
              {editing.platform === 'telegram' && (
                <>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('webhooks.telegramBotToken')}
                    <input
                      className={adminInputBoundedClass}
                      value={editing.telegramBotToken}
                      placeholder={
                        editing.hasTelegramBotToken ? t('webhooks.secretLeaveBlank') : undefined
                      }
                      onChange={(e) => setEditing({ ...editing, telegramBotToken: e.target.value })}
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('webhooks.telegramChatId')}
                    <input
                      className={adminInputBoundedClass}
                      value={editing.telegramChatId}
                      onChange={(e) => setEditing({ ...editing, telegramChatId: e.target.value })}
                    />
                  </label>
                </>
              )}
              {editing.platform === 'whatsapp' && (
                <>
                  <p className="sm:col-span-2 text-xs text-amber-800 dark:text-amber-200">
                    {t('webhooks.whatsappHint')}
                  </p>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2">
                    {t('webhooks.whatsappAccessToken')}
                    <input
                      className={adminInputWideClass}
                      value={editing.whatsappAccessToken}
                      placeholder={
                        editing.hasWhatsappAccessToken ? t('webhooks.secretLeaveBlank') : undefined
                      }
                      onChange={(e) =>
                        setEditing({ ...editing, whatsappAccessToken: e.target.value })
                      }
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('webhooks.whatsappPhoneNumberId')}
                    <input
                      className={adminInputBoundedClass}
                      value={editing.whatsappPhoneNumberId}
                      onChange={(e) =>
                        setEditing({ ...editing, whatsappPhoneNumberId: e.target.value })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('webhooks.whatsappTo')}
                    <input
                      className={adminInputBoundedClass}
                      value={editing.whatsappTo}
                      onChange={(e) => setEditing({ ...editing, whatsappTo: e.target.value })}
                    />
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 sm:col-span-2 max-w-xl">
                {t('webhooks.projects')}
                <select
                  multiple
                  className={`${adminInputWideClass} h-28`}
                  value={editing.projectIds}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      projectIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                    })
                  }
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ? `${p.id} — ${p.name}` : p.id}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-gray-500">{t('webhooks.projectsHint')}</span>
                <span className="text-xs font-normal text-gray-500">{t('webhooks.projectsMultiSelectHint')}</span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('webhooks.minPriority')}
                <select
                  className={adminInputBoundedClass}
                  value={editing.minPriorityId}
                  onChange={(e) => setEditing({ ...editing, minPriorityId: e.target.value })}
                >
                  <option value="">{t('webhooks.anyPriority')}</option>
                  {priorities.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.priority || p.id}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-4 text-xs font-medium text-gray-600 dark:text-gray-400" data-setting-key="WEBHOOK_EVENT_TYPES">
              {t('webhooks.eventTypes')}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-snug">
              {t('webhooks.eventTypesHint')}
            </p>
            <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-x-8 divide-y divide-gray-100 dark:divide-gray-800 lg:divide-y-0">
              {WEBHOOK_EVENT_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 lg:py-2"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <div
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_DOT_CLASS[key] || 'bg-gray-400'}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t(`webhooks.events.${key}`)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {t(`webhooks.events.${key}Description`)}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={editing.eventTypes[key] !== false}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            eventTypes: { ...editing.eventTypes, [key]: e.target.checked },
                          })
                        }
                        className="peer sr-only"
                      />
                      <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800" />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                {editing.id ? t('webhooks.testAfterSaveHint') : t('webhooks.testAfterSaveFirst')}
              </p>
              <div className="flex flex-wrap gap-2">
              <KanbanChromeTooltip
                label={
                  editing.id && !draftHasChanges
                    ? t('noChangesToSave')
                    : t('webhooks.saveTooltip')
                }
              >
                <button
                  type="button"
                  disabled={saving || !draftHasChanges}
                  onClick={() => void saveDraft()}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? t('webhooks.saving') : t('webhooks.save')}
                </button>
              </KanbanChromeTooltip>
              {editing.id ? testButton(editing.id, false) : (
                <KanbanChromeTooltip label={t('webhooks.testAfterSaveFirst')}>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm text-gray-400 dark:border-gray-600 dark:bg-gray-800"
                    aria-label={t('webhooks.test')}
                  >
                    <Send className="h-4 w-4" />
                    {t('webhooks.test')}
                  </button>
                </KanbanChromeTooltip>
              )}
              <KanbanChromeTooltip label={t('webhooks.cancelTooltip')}>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setEditingBaseline(null);
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
                >
                  {t('webhooks.cancel')}
                </button>
              </KanbanChromeTooltip>
              </div>
            </div>
          </AdminSection>
          </div>
        )}
      </AdminPageShell>

      <ConfirmWebhooksOnlyDialog
        open={confirmWebhooksOnly}
        onCancel={() => setConfirmWebhooksOnly(false)}
        onConfirm={() => {
          setConfirmWebhooksOnly(false);
          void persistChannel('webhooks');
        }}
      />

      {confirmDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/40 p-4"
            onClick={() => setConfirmDelete(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="my-auto w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md bg-white p-4 shadow-lg dark:bg-gray-800"
              onClick={(e) => e.stopPropagation()}
            >
            <p className="text-sm text-gray-800 dark:text-gray-100">
              {t('webhooks.deleteConfirm', { name: confirmDelete.name })}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm"
                onClick={() => setConfirmDelete(null)}
              >
                {t('webhooks.cancel')}
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white"
                onClick={async () => {
                  try {
                    await deleteAdminWebhook(confirmDelete.id);
                    toast.success(t('webhooks.deleted'));
                    setConfirmDelete(null);
                    await load();
                  } catch {
                    toast.error(t('webhooks.deleteError'));
                  }
                }}
              >
                {t('webhooks.delete')}
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  );
};

export default AdminWebhooksTab;
