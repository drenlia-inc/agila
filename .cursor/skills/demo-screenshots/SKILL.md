---
name: demo-screenshots
description: Capture and refresh Agila docs/README screenshots from the public demo site with Playwright. Use when replacing files under screenshots/, updating SCREENSHOTS.md images, GitHub social/OG previews, or the user mentions demo screenshots / overview.png.
---

# Demo screenshots (Agila)

Capture product screenshots from the live demo for `screenshots/` (README + `SCREENSHOTS.md`). Prefer Playwright when the Cursor browser MCP is unavailable.

## Source

- **URL**: `https://kanban.demo.drenlia.com`
- **Auth**: one-click — click **Sign In** (no credentials). Button may animate; use `{ force: true }` if the click times out as “not stable”.
- Demo often runs Vite with HMR websockets — **do not** use `waitUntil: 'networkidle'` (hangs). Use `waitUntil: 'commit'` or `domcontentloaded`, then wait for UI selectors.

## Tooling

- Install Playwright + Chromium in a temp dir if needed (`npm i playwright` + `npx playwright install chromium`).
- Default framing for README/docs board shots: viewport **1600×1000**, `deviceScaleFactor: 2` → **3200×2000** PNG.
- `locale: 'en-US'`. After login, ensure **English** chrome (TOOLS / TEAM MEMBERS / All Sprints). The header language control shows the *other* locale (e.g. **FR** while UI is English). If French labels appear (`Tous les sprints`, `OUTILS`, …), toggle language until English returns — do not assume the button label is the current language.

## Capture checklist

1. `goto` demo → wait for **Sign In** → click with `force: true`.
2. Wait for board (`Project Board` / `To Do`).
3. Confirm English UI; dismiss joyride/tours (`Escape`, Skip).
4. Hide non-product chrome before shot when present (e.g. fixed `kanban.local` badge, joyride overlays) via CSS/`display:none` on fixed floats — do not leave env badges in docs images.
5. For `task_details_view_and_comment_tooltip.png`: open details on one card, hover another card’s comment control until `.comment-tooltip` appears, then **hide** the small chrome tip whose text is exactly `Hover to view comments` (keep `.comment-tooltip`).
6. Screenshot viewport (`fullPage: false`) to the target path under `screenshots/` (same filename so README / `SCREENSHOTS.md` links keep working).
7. Have the user review before refreshing the rest of the set.

## Known shots (`screenshots/`)

| File | Subject |
|------|---------|
| `overview.png` | Main Kanban board (filters, progress, columns) — README / docs |
| `overview-social.png` | Same board cropped for GitHub OG (**1280×640**, side gutters trimmed, top-biased) |
| `task_details_view_and_comment_tooltip.png` | Task details panel + comment preview |
| `user-profile.png` | Profile settings modal |
| `admin-users.png` | Admin → Users |
| `admin-SSO.png` | Admin → System Settings → SSO / Google OAuth (`#admin#system-settings#sso`) |
| `admin-mail-server.png` | Admin → System Settings → Mail server (`#admin#system-settings#mail-server`) |

Document captions live in `screenshots/SCREENSHOTS.md`.

## GitHub social / OG (1280×640)

GitHub’s preferred social preview is **1280×640** (2:1) — wider and shorter than the README overview (≈8:5).

**Recommendation**

- Keep a **tall/desktop** `overview.png` for README / `SCREENSHOTS.md`.
- Produce a **separate** OG asset (e.g. `screenshots/overview-social.png` or repo social preview upload) at **exactly 1280×640**.
- Prefer a **dedicated capture or tight crop**, not letterboxing the full board into 2:1 (wastes space and shrinks UI).
- **Yes — trim side gutters** (empty gray board margins) so columns/cards read larger at social size. Practical starting point from a 3200×2000 overview: **~10% each side**, then top-biased 2:1, resize to 1280×640 (see `overview-social.png`).
- Crop **top-biased** (keep logo, nav, filters, upper cards); drop lower empty column space rather than clipping the header.
- Optional capture shortcut: viewport **1280×640** (or **1440×720**) at `deviceScaleFactor: 2`, then downscale to 1280×640.

Do not overwrite README `overview.png` with the 2:1 crop unless the user asks — the aspect ratios serve different surfaces.
