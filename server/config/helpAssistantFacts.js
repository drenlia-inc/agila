/**
 * Short product facts the Help Assistant must follow.
 * Keep this list small: only behavior that UI labels would get wrong.
 */
export const HELP_ASSISTANT_FACTS = `
- Activity feed for the current user: Profile → Activity feed (or X on the feed). Admin SHOW_ACTIVITY_FEED is only the default for NEW users; it does not hide an existing user's feed.
- Admin “Default application language” is emails/system copy, not the user's UI language (Profile) and not the activity feed.
- Column/board WIP is a soft limit: the UI warns but does not block moves.
- Deleted tasks live in the board trash (trash toggle on the board tabs), not Archive. Archived columns are shown from Search & Filters → Columns (not List View column visibility).
- Delete a card: the trash icon on the card (data-tour-id=task-card-delete), not the whole toolbar.
- Full-page task view (TaskPage) exists: /task/#TICKET (or /project/#PROJ#TICKET). Open it by clicking the ticket ID on the card, list row, or side panel header. Clicking the card body only opens the side panel, not TaskPage.
- Never say a feature does not exist. If you cannot locate it in the retrieved controls, say you are not sure and point the user to the Help tabs.
`.trim();
