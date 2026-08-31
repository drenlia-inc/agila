import { Step } from 'react-joyride';
import i18n from '../../i18n/config';

export interface TourStepsConfig {
  userSteps: Step[];
  adminSteps: Step[];
}

export const getTourSteps = (): TourStepsConfig => {
  const userSteps: Step[] = [
    // Step 0: Welcome
    {
      target: 'body', // Use body as fallback
      content: i18n.t('tour.steps.welcome', { ns: 'common' }),
      placement: 'center',
      disableBeacon: true,
    },
    // Step 1: Board Tabs
    {
      target: '[data-tour-id="board-tabs"]',
      content: i18n.t('tour.steps.boardTabs', { ns: 'common' }),
      placement: 'bottom',
      offset: 20,
      disableBeacon: false,
      spotlightClicks: false,
    },
    // Step 2: Kanban Columns
    {
      target: '[data-tour-id="kanban-columns"]',
      content: i18n.t('tour.steps.kanbanColumns', { ns: 'common' }),
      placement: 'top',
    },
    // Step 3: Add Task Button
    {
      target: '[data-tour-id="add-task-button"]',
      content: i18n.t('tour.steps.addTaskButton', { ns: 'common' }),
      placement: 'top',
    },
    // Step 4: Task Card Toolbar (instruct user to hover)
    {
      target: '.task-card',
      content: i18n.t('tour.steps.taskCardToolbar', { ns: 'common' }),
      placement: 'top',
      disableBeacon: false,
    },
    // Step 5: Task Quick Edit
    {
      target: '.task-card',
      content: i18n.t('tour.steps.taskQuickEdit', { ns: 'common' }),
      placement: 'right',
      disableBeacon: false,
    },
    // Step 6: Sprint Association (calendar icon)
    {
      target: '[data-tour-id="sprint-association"]',
      content: i18n.t('tour.steps.sprintAssociation', { ns: 'common' }),
      placement: 'right',
      disableBeacon: false,
    },
    // Step 7: Sprint Selector
    {
      target: '[data-tour-id="sprint-selector"]',
      content: i18n.t('tour.steps.sprintSelector', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 8: Search Filter
    {
      target: '[data-tour-id="search-filter"]',
      content: i18n.t('tour.steps.searchFilter', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 9: View Mode Toggle
    {
      target: '[data-tour-id="view-mode-toggle"]',
      content: i18n.t('tour.steps.viewModeToggle', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 10: Team Members
    {
      target: '[data-tour-id="team-members"]',
      content: i18n.t('tour.steps.teamMembers', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 11: Profile Menu
    {
      target: '[data-tour-id="profile-menu"]',
      content: i18n.t('tour.steps.profileMenu', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 12: Theme Toggle
    {
      target: '[data-tour-id="theme-toggle"]',
      content: i18n.t('tour.steps.themeToggle', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 13: Reports Button
    {
      target: '[data-tour-id="reports-button"]',
      content: i18n.t('tour.steps.reportsButton', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 14: Help Button
    {
      target: '[data-tour-id="help-button"]',
      content: i18n.t('tour.steps.helpButton', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 15: Export Menu (List View - switches to list before showing)
    {
      target: '[data-tour-id="export-menu"]',
      content: i18n.t('tour.steps.exportMenu', { ns: 'common' }),
      placement: 'bottom',
      data: { switchToView: 'list' }, // Custom data to trigger view switch
    },
    // Step 16: Column Visibility (List View - switches to list before showing)
    {
      target: '[data-tour-id="column-visibility"]',
      content: i18n.t('tour.steps.columnVisibility', { ns: 'common' }),
      placement: 'bottom',
      data: { switchToView: 'list' }, // Custom data to trigger view switch
    },
  ];

  const adminSteps: Step[] = [
    // All user steps plus admin-specific ones
    ...userSteps.slice(0, 14), // Steps 0-14 (before list view switch)
    // Step 15: Column Management Menu (Admin Only - in Kanban view, before list view switch)
    {
      target: '[data-tour-id="column-management-menu"]',
      content: i18n.t('tour.steps.columnManagementMenu', { ns: 'common' }),
      placement: 'right',
    },
    // Step 16: Add Board Button (Admin Only - in Kanban view, before list view switch)
    {
      target: '[data-tour-id="add-board-button"]',
      content: i18n.t('tour.steps.addBoardButton', { ns: 'common' }),
      placement: 'bottom',
      offset: 20,
    },
    // Step 17: Invite User Button (Admin Only - accessible from both views, before list view switch)
    {
      target: '[data-tour-id="invite-user-button"]',
      content: i18n.t('tour.steps.inviteUserButton', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 18: Export Menu (List View - switches to list before showing)
    {
      target: '[data-tour-id="export-menu"]',
      content: i18n.t('tour.steps.exportMenu', { ns: 'common' }),
      placement: 'bottom',
      data: { switchToView: 'list' }, // Custom data to trigger view switch
    },
    // Step 19: Column Visibility (List View - switches to list before showing)
    {
      target: '[data-tour-id="column-visibility"]',
      content: i18n.t('tour.steps.columnVisibility', { ns: 'common' }),
      placement: 'bottom',
      data: { switchToView: 'list' }, // Custom data to trigger view switch
    },
    // Step 20: System Panel Toggle (Admin Only)
    {
      target: '[data-tour-id="system-panel-toggle"]',
      content: i18n.t('tour.steps.systemPanelToggle', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 21: Admin Tab (switches to admin page before showing)
    {
      target: '[data-tour-id="admin-tab"]',
      content: i18n.t('tour.steps.adminTab', { ns: 'common' }),
      placement: 'bottom',
      spotlightClicks: false,
      disableBeacon: false,
      offset: 20,
      data: { switchToPage: 'admin' }, // Custom data to trigger page switch
    },
    // Step 22: Admin Users
    {
      target: '[data-tour-id="admin-users"]',
      content: i18n.t('tour.steps.adminUsers', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 23: Admin Site Settings
    {
      target: '[data-tour-id="admin-site-settings"]',
      content: i18n.t('tour.steps.adminSiteSettings', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 24: Admin System Settings (hub)
    {
      target: '[data-tour-id="admin-system-settings"]',
      content: i18n.t('tour.steps.adminSystemSettings', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 25: Admin SSO (System Settings subtab)
    {
      target: '[data-tour-id="admin-sso"]',
      content: i18n.t('tour.steps.adminSso', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 26: Admin Storage (System Settings subtab)
    {
      target: '[data-tour-id="admin-storage"]',
      content: i18n.t('tour.steps.adminStorage', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 28: Admin File Uploads (System Settings subtab)
    {
      target: '[data-tour-id="admin-file-uploads"]',
      content: i18n.t('tour.steps.adminFileUploads', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 29: Admin AI (System Settings subtab)
    {
      target: '[data-tour-id="admin-ai"]',
      content: i18n.t('tour.steps.adminAi', { ns: 'common' }),
      placement: 'bottom',
    },
    // Admin Notifications (hub)
    {
      target: '[data-tour-id="admin-notifications"]',
      content: i18n.t('tour.steps.adminNotifications', { ns: 'common' }),
      placement: 'bottom',
    },
    // Admin Mail Server (Notifications subtab)
    {
      target: '[data-tour-id="admin-mail-server"]',
      content: i18n.t('tour.steps.adminMailServer', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 30: Admin Tags
    {
      target: '[data-tour-id="admin-tags"]',
      content: i18n.t('tour.steps.adminTags', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 31: Admin Priorities
    {
      target: '[data-tour-id="admin-priorities"]',
      content: i18n.t('tour.steps.adminPriorities', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 32: Admin App Settings
    {
      target: '[data-tour-id="admin-app-settings"]',
      content: i18n.t('tour.steps.adminAppSettings', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 33: Admin Project Settings (hub)
    {
      target: '[data-tour-id="admin-project-settings"]',
      content: i18n.t('tour.steps.adminProjectSettings', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 34: Admin Sprints (Project Settings subtab)
    {
      target: '[data-tour-id="admin-sprint-settings"]',
      content: i18n.t('tour.steps.adminSprintSettings', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 35: Admin Reporting (Project Settings subtab)
    {
      target: '[data-tour-id="admin-reporting"]',
      content: i18n.t('tour.steps.adminReporting', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 36: Admin Lifecycle (Project Settings subtab)
    {
      target: '[data-tour-id="admin-lifecycle"]',
      content: i18n.t('tour.steps.adminLifecycle', { ns: 'common' }),
      placement: 'bottom',
    },
    // Step 37: Admin Licensing
    {
      target: '[data-tour-id="admin-licensing"]',
      content: i18n.t('tour.steps.adminLicensing', { ns: 'common' }),
      placement: 'bottom',
    },
    // System Usage Panel (back on Kanban; panel must be open)
    {
      target: '[data-tour-id="system-usage-panel"]',
      content: i18n.t('tour.steps.systemUsagePanel', { ns: 'common' }),
      placement: 'left',
      data: { switchToPage: 'kanban', ensureSystemPanel: true },
    },
  ];

  return {
    userSteps,
    adminSteps,
  };
};
