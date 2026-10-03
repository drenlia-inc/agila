# Agila API

Agila API v1 is the same set of actions as the web app. Call `/api/v1` with `Authorization: Bearer` and either a session JWT or an `ek_` token. The full route list is [docs/api/openapi.yaml](api/openapi.yaml). An `ek_` token is that user, so the same rules apply: board participation, viewer read-only, license limits, and self-delete denials.

The web app keeps calling `/api/*`. Login and OAuth stay on `/api/auth`.

On an Agila-hosted site, the API is part of the Pro plan. A self-hosted install includes it. The demo and the Basic plan do not: token minting and `/api/v1` return **403** `API_NOT_IN_PLAN`. The signed-in app on `/api` is unchanged.

People who are logged in see the same live updates as if the work was done in the app: a new board appears for its members and for admins, a new or moved card appears on that board, and acceptance criteria refresh on the open card.

## Create a token

Each bot is its own user and its own token. Those users count as licensed seats.

1. As an administrator, create the accounts (a scrum-master administrator, and member users for each dev bot).
2. On Admin → Users, use the mask icon to impersonate that user. A banner offers **Return to your account**.
3. Open Profile → **API tokens**. Set a description (where this token will be used) and a lifetime. The default is **1 day**. The maximum is **30 days**.
4. Copy the `ek_…` value once. Revoke stops it immediately. An expired token is rejected the same way as a revoked one.
5. Return to your account and repeat for the next bot.

Impersonation works for local accounts and for Google, GitHub, and Microsoft accounts. It starts an Agila session. It does not sign in to that person's identity provider.

Use a **member** token for a coding agent that reads card text. Keep a scrum-master **administrator** token in a separate config. Do not put both in the same tool.

## Token files

A file in your home directory is a good place for the token. Two files we use:

| File | Who |
|------|-----|
| `~/.agila.admin.token` | Scrum-master (administrator) |
| `~/.agila.bot.token` | Dev bot (member) |

```bash
umask 077
printf '%s\n' 'ek_…' > ~/.agila.bot.token
chmod 600 ~/.agila.bot.token
```

That keeps the secret out of the git repo, out of chat, and out of a project MCP file that might be committed. One file per bot. Do not print the file. Point the tool at the path and let it read the file.

When a card asks the bot to create a Git repository, create a **private** repository only.

## Example with Cursor or VS Code

### Requirements

- Node.js, so the editor can start `mcp/server.mjs` from this repo.
- The dev bot is a **member** and a participant on the board it should work.
- `~/.agila.bot.token` exists and is mode `600`.
- `AGILA_BASE_URL` is the site origin with no trailing slash. Local Docker is `http://localhost:3222`. A hosted site looks like `https://kanban.example.com`.
- For cards that push code: `gh` is logged in on that machine, and new repositories are **private**.

The scrum-master token stays out of this editor. Use it from a separate config when you need to create sprints, boards, or plans.

### Configure

Cursor: `.cursor/mcp.json` in the project, or Cursor Settings → MCP. Prefer a user-level MCP entry when the path is only for you. The block below reads `~/.agila.bot.token` and does not contain the token.

```json
{
  "mcpServers": {
    "agila": {
      "command": "sh",
      "args": [
        "-c",
        "AGILA_API_TOKEN=$(tr -d '\\n' < \"$HOME/.agila.bot.token\"); export AGILA_API_TOKEN; exec node \"/absolute/path/to/agila/mcp/server.mjs\""
      ],
      "env": {
        "AGILA_BASE_URL": "https://kanban.example.com"
      }
    }
  }
}
```

VS Code uses the same command, args, and env under `servers` in its MCP config (`.vscode/mcp.json` or User settings). Set `"type": "stdio"` on that server entry.

Reload MCP after saving. The server exposes eight tools:

| Tool | What it does |
|------|----------------|
| `list_boards` | Boards this token can see |
| `create_board` | Board plus columns. Archive is appended |
| `create_sprint` | Admin token only |
| `upsert_task` | Create or update a card by `externalKey` |
| `claim_task` | Take the next unassigned card |
| `move_task` | Move a card you already claimed |
| `check_criterion` | Check an acceptance criterion |
| `apply_plan` | Sprint, board, and cards in one call |

Anything else the web can do is an HTTP call to the matching `/api/v1` route in the OpenAPI file. Comments are `POST /api/v1/comments`. The MCP server does not wrap every route.

### What to ask

Tell the agent the board, the columns, and the token file. Do not paste the token.

> Read the API token from `~/.agila.bot.token`. Do not print it. Base URL is `https://kanban.example.com`. On board `board-example`, claim the next card from To Do into In Progress for sprint `sprint-example`. Do the work on the card. If you create a Git repository, make it private, commit on `main`, and do not open a pull request. Comment on the card with the result. Check the acceptance criteria. Move the card to Completed. If a call returns 409, stop.

Keep `claimToken` in the agent. Task reads and WebSocket events do not include it. If a person moves or reassigns the card, the next bot write returns **409** `CLAIM_CONFLICT`. Stop. Do not move the card back.

## Example with Grok Bot

Grok does not use the MCP server. It calls the same API over HTTP. The token file and the private-repository rule are the same as above.

### Requirements

- Grok can run HTTP requests and, for coding cards, shell and `git` / `gh`.
- The dev bot is a **member** and a participant on the board.
- `~/.agila.bot.token` exists and is mode `600`. Grok reads that path. It must not print the token or send it anywhere except `Authorization: Bearer`.
- Base URL with no trailing slash, for example `https://kanban.example.com`.
- For cards that push code: `gh` is logged in, and new repositories are **private**.
- An administrator token, in a different file such as `~/.agila.admin.token`, only when Grok must create the sprint, the board, or the plan.

### What to ask

> Read the API token from `~/.agila.bot.token`. Do not print it. Call `https://kanban.example.com` with `Authorization: Bearer` and `Content-Type: application/json`.

**Claim.** `POST /api/v1/boards/board-example/claim`

```json
{
  "fromColumn": "To Do",
  "toColumn": "In Progress",
  "sprintId": "sprint-example"
}
```

The id may be the board id or its `externalKey`. This assigns the oldest unassigned card in that column to the caller and returns `claimToken` once, on `task.claimToken`. An empty lane is **409** `CLAIM_EMPTY`.

**Do the work.** Follow the card. Create repositories as **private**. Commit on `main`. Do not open a feature branch or a pull request.

**Comment.** `POST /api/v1/comments` with a new `id`, the `taskId`, and the `text`.

**Check criteria.** For each item, `PATCH /api/v1/tasks/{taskId}/acceptance-criteria/{criterionId}`

```json
{ "done": true, "claimToken": "…" }
```

**Finish.** `POST /api/v1/tasks/{id}/move`

```json
{ "column": "Completed", "claimToken": "…" }
```

Use the column title that exists on that board. If a person moves or reassigns the card, the next write returns **409** `CLAIM_CONFLICT` and the card as it is now. Stop. Do not move the card back. Re-read and continue when the person only edited the title, description, or acceptance criteria. Those edits leave the claim in place.

To create the sprint, board, and cards first, use the administrator file and `POST /api/v1/plans`. Include the dev bot user id in `participantUserIds`. A repeated `externalKey` updates that record. The sprint section requires an administrator. A plan stops at 500 cards. Archive is still appended. At most one column is finished; if none is marked, the last caller column is finished.

```json
{
  "sprint": {
    "name": "Sprint 12",
    "goal": "Ship the payments board",
    "startDate": "2026-10-06",
    "endDate": "2026-10-17",
    "active": true,
    "externalKey": "sprint-12"
  },
  "board": {
    "title": "Payments",
    "externalKey": "board-payments",
    "columns": [
      { "title": "To Do" },
      { "title": "In Progress" },
      { "title": "Done", "finished": true }
    ],
    "participantUserIds": ["dev-bot-user-id"]
  },
  "tasks": [
    {
      "column": "To Do",
      "title": "Add the refund endpoint",
      "externalKey": "card-refund",
      "acceptanceCriteria": ["Returns 204 when the charge exists"]
    }
  ]
}
```

## Relay reference

Column arguments accept an id or a title on that board (trim, case-insensitive). Two columns with the same title return **409**.

| Call | Purpose |
|------|---------|
| `POST /api/v1/boards` with `columns` | Create a board with those lanes. Archive is appended. |
| `POST /api/v1/sprints` | Admin. Name, goal, dates, `active`, optional `externalKey`. |
| `POST /api/v1/tasks` with `column` | Create or update a card by `externalKey`, including acceptance criteria. |
| `POST /api/v1/boards/{id}/claim` | Take the next unassigned card and move it. Returns `claimToken` once. |
| `POST /api/v1/tasks/{id}/move` | Move by column title. Requires the current `claimToken`. |
| `PATCH /api/v1/tasks/{taskId}/acceptance-criteria/{criterionId}` | Check an item. Requires `claimToken`. |
| `POST /api/v1/plans` | Sprint, board, columns, and cards in one transaction (500 cards maximum). |
