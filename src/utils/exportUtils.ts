import { Task, Board, TeamMember, Tag, Columns, PriorityOption } from '../types';
import i18n from 'i18next';

/**
 * Strip HTML tags from text while preserving line breaks
 * Converts <p> tags to CRLF for better readability in exports
 */
function stripHtmlPreservingLineBreaks(html: string): string {
  if (!html) return '';
  
  // Convert <p> tags to single CRLF (only opening tag, closing tag becomes nothing)
  // This prevents double CRLF between paragraphs
  let text = html.replace(/<p[^>]*>/gi, '\r\n');
  text = text.replace(/<\/p>/gi, '');
  
  // Convert <br> tags to CRLF
  text = text.replace(/<br\s*\/?>/gi, '\r\n');
  
  // Convert <div> tags to line breaks
  text = text.replace(/<div[^>]*>/gi, '\r\n');
  text = text.replace(/<\/div>/gi, '');
  
  // Remove all other HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  
  // Normalize all multiple consecutive line breaks to single CRLF
  text = text.replace(/(\r\n)+/g, '\r\n');
  
  // Trim leading/trailing whitespace
  text = text.trim();
  
  return text;
}

export interface ExportData {
  ticket?: string;
  title: string;
  description?: string;
  assignee?: string;
  priority: string;
  status: string;
  sprint?: string;
  startDate: string;
  dueDate?: string;
  effort: number;
  tags?: string;
  comments?: string;
  createdAt?: string;
  updatedAt?: string;
  project?: string;
  boardName: string;
}

export interface ExportOptions {
  format: 'csv' | 'xlsx';
  scope: 'current' | 'all';
  currentBoardId?: string;
  currentBoardName?: string;
}

/**
 * Transform task data for export, excluding internal IDs but keeping relevant business data
 * Priority name is retrieved from the priorities table (via priorityName or priorityId lookup)
 * to ensure we always export the current priority name, not the potentially outdated stored name.
 */
export function transformTaskForExport(
  task: Task, 
  boardName: string, 
  members: TeamMember[], 
  availableTags: Tag[],
  project?: string,
  columns?: Columns,
  sprints?: Array<{ id: string; name: string }>,
  availablePriorities?: PriorityOption[]
): ExportData {
  // Get assignee name
  const unassignedLabel = i18n.t('taskCard.noAssignee', { ns: 'tasks' });
  const assignee = task.memberId 
    ? members.find(m => m.id === task.memberId)?.name || unassignedLabel
    : unassignedLabel;

  // Get tags as comma-separated string
  const tags = task.tags 
    ? task.tags.map(tag => tag.tag).join(', ')
    : '';

  // Get comments as text, separated by newlines, with HTML stripped
  const comments = task.comments?.length 
    ? task.comments.map(comment => stripHtmlPreservingLineBreaks(comment.text)).join('\n\n')
    : '';

  // Get column name (status) from columnId
  const status = columns && task.columnId 
    ? columns[task.columnId]?.title || 'Unknown'
    : task.status || 'Unknown';

  // Get sprint name
  const sprint = task.sprintId && sprints
    ? sprints.find(s => s.id === task.sprintId)?.name || ''
    : '';

  // Get priority name from priorities table (current name, not stored name)
  // Priority order: priorityName (from API JOIN) > lookup by priorityId > fallback to stored priority
  let priorityName = task.priorityName;
  if (!priorityName && task.priorityId && availablePriorities) {
    const priority = availablePriorities.find(p => p.id === task.priorityId);
    priorityName = priority?.priority;
  }
  const priority = priorityName || task.priority || '';

  return {
    ticket: task.ticket || '',
    title: task.title,
    description: stripHtmlPreservingLineBreaks(task.description || ''),
    assignee,
    priority,
    status,
    sprint,
    startDate: task.startDate,
    dueDate: task.dueDate || '',
    effort: task.effort,
    tags,
    comments,
    createdAt: task.createdAt || task.created_at || '',
    updatedAt: task.updatedAt || task.updated_at || '',
    project: project || '',
    boardName
  };
}

/**
 * Get all tasks from boards for export
 */
export function getAllTasksForExport(
  boards: Board[], 
  members: TeamMember[], 
  availableTags: Tag[],
  sprints?: Array<{ id: string; name: string }>,
  availablePriorities?: PriorityOption[]
): ExportData[] {
  const allTasks: ExportData[] = [];

  boards.forEach(board => {
    Object.values(board.columns).forEach(column => {
      column.tasks.forEach(task => {
        const exportData = transformTaskForExport(
          task, 
          board.title, 
          members, 
          availableTags,
          board.project,
          board.columns,
          sprints,
          availablePriorities
        );
        allTasks.push(exportData);
      });
    });
  });

  return allTasks;
}

/**
 * Get tasks from current board for export
 */
export function getCurrentBoardTasksForExport(
  board: Board, 
  members: TeamMember[], 
  availableTags: Tag[],
  sprints?: Array<{ id: string; name: string }>,
  availablePriorities?: PriorityOption[]
): ExportData[] {
  const tasks: ExportData[] = [];

  Object.values(board.columns).forEach(column => {
    column.tasks.forEach(task => {
      const exportData = transformTaskForExport(
        task, 
        board.title, 
        members, 
        availableTags,
        board.project,
        board.columns,
        sprints,
        availablePriorities
      );
      tasks.push(exportData);
    });
  });

  return tasks;
}

/**
 * Convert data to CSV format for browser download
 * @param data - Array of export data
 * @param t - Translation function (optional, defaults to English)
 */
export function convertToCSV(data: ExportData[], t?: (key: string) => string): string {
  if (data.length === 0) return '';
  
  // Default translation function that returns the key if no translation function is provided
  const translate = t || ((key: string) => key);
  
  const headers = [
    translate('export.headers.board'),
    translate('export.headers.sprint'),
    translate('export.headers.ticket'),
    translate('export.headers.task'),
    translate('export.headers.description'),
    translate('export.headers.assignee'),
    translate('export.headers.priority'),
    translate('export.headers.status'),
    translate('export.headers.startDate'),
    translate('export.headers.dueDate'),
    translate('export.headers.effort'),
    translate('export.headers.tags'),
    translate('export.headers.comments'),
    translate('export.headers.created'),
    translate('export.headers.updated'),
    translate('export.headers.project')
  ];
  
  const csvRows = [headers.join(',')];
  
  data.forEach(row => {
    const values = [
      `"${String(row.boardName || '').replace(/"/g, '""')}"`,
      `"${String(row.sprint || '').replace(/"/g, '""')}"`,
      `"${String(row.ticket || '').replace(/"/g, '""')}"`,
      `"${String(row.title || '').replace(/"/g, '""')}"`,
      `"${String(row.description || '').replace(/"/g, '""')}"`,
      `"${String(row.assignee || '').replace(/"/g, '""')}"`,
      `"${String(row.priority || '').replace(/"/g, '""')}"`,
      `"${String(row.status || '').replace(/"/g, '""')}"`,
      `"${String(row.startDate || '').replace(/"/g, '""')}"`,
      `"${String(row.dueDate || '').replace(/"/g, '""')}"`,
      `"${String(row.effort || '').replace(/"/g, '""')}"`,
      `"${String(row.tags || '').replace(/"/g, '""')}"`,
      `"${String(row.comments || '').replace(/"/g, '""')}"`,
      `"${String(row.createdAt || '').replace(/"/g, '""')}"`,
      `"${String(row.updatedAt || '').replace(/"/g, '""')}"`,
      `"${String(row.project || '').replace(/"/g, '""')}"`
    ];
    csvRows.push(values.join(','));
  });
  
  return csvRows.join('\n');
}


/**
 * Generate filename with timestamp
 */
export function generateFilename(format: 'csv' | 'xlsx', scope: 'current' | 'all', boardName?: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const scopeText = scope === 'current' ? (boardName || 'current-board') : 'all-boards';
  const extension = format === 'csv' ? 'csv' : 'xlsx';
  
  return `kanban-export-${scopeText}-${timestamp}.${extension}`;
}

/**
 * Download file in browser
 */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
