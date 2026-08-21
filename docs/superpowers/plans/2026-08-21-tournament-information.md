# Tournament Information Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/informacion` reference page and a protected `/admin` editor backed by persistent tournament configuration and the same scoring rules used by the leaderboard.

**Architecture:** A dedicated scoring service owns immutable point values and player score calculation. SQLite stores editable tournament copy as one validated JSON document; Express exposes a public merged information endpoint and a token-protected update endpoint. Static pages reuse the existing visual tokens and navigation, while page-specific CSS/JS render information and admin forms without duplicating scoring values in HTML.

**Tech Stack:** Node.js, Express, better-sqlite3, native `node:test`, Supertest, semantic HTML, CSS, vanilla JavaScript.

---

## File map

- `src/services/scoring.js`: canonical scoring values, public rule descriptions, and player score calculation.
- `src/tournament-information.js`: default editable content plus structural validation/normalisation.
- `src/database.js`: persistent `tournament_information` table and read/write methods.
- `src/config.js`: `ADMIN_TOKEN` configuration.
- `src/leaderboard.js`: reuse the scoring service and expose impostor victories for tie-breaking.
- `src/app.js`, `src/server.js`: public information and protected admin APIs.
- `public/informacion.html`, `public/information.css`, `public/information.js`: public tournament reference.
- `public/admin.html`, `public/admin.css`, `public/admin.js`: token-authenticated configuration editor.
- `public/index.html`, `public/styles.css`: shared primary navigation.
- `test/scoring.test.js`, `test/information.test.js`, `test/app.test.js`, `test/config.test.js`: scoring, persistence, auth, routes, and rendering contract.
- `.env.example`, `README.md`: administrator secret and operating instructions.

### Task 1: Canonical scoring service

**Files:**
- Create: `src/services/scoring.js`
- Create: `test/scoring.test.js`
- Modify: `src/leaderboard.js`
- Modify: `test/leaderboard.test.js`

- [ ] Write failing tests for crew/impostor victories, capped kill bonuses, completed-task bonus, defeat base score, and public scoring metadata.
- [ ] Run `npm test -- --test-name-pattern=scoring` and confirm the module is missing.
- [ ] Implement constants `{ crewWin: 4, impostorWin: 5, kill: 1, maxKillBonus: 3, allTasks: 1, defeat: 0 }` plus `calculatePlayerScore`.
- [ ] Replace the leaderboard's hard-coded fallback with `calculatePlayerScore` and sort ties by points, wins, impostor wins, then valid kills.
- [ ] Run all tests and confirm the scoring cases pass.

### Task 2: Persistent editable tournament information

**Files:**
- Create: `src/tournament-information.js`
- Create: `test/information.test.js`
- Modify: `src/database.js`

- [ ] Test default general information, format, rules, tiebreakers and FAQs plus persistence across database reopen.
- [ ] Add a single-row `tournament_information` table containing validated JSON and `updated_at`.
- [ ] Implement `getTournamentInformation()` and `updateTournamentInformation(content)` with defaults inserted on first access.
- [ ] Validate bounded strings, rules/tiebreaker arrays, FAQ `{question, answer}` entries, participant count, and group mode.
- [ ] Run persistence and validation tests.

### Task 3: Public and protected APIs

**Files:**
- Modify: `src/config.js`
- Modify: `src/app.js`
- Modify: `src/server.js`
- Modify: `.env.example`
- Modify: `test/config.test.js`
- Modify: `test/app.test.js`

- [ ] Test `GET /api/tournament-information` returns editable information plus canonical scoring.
- [ ] Test `/informacion` and `/admin` static routes.
- [ ] Test admin update rejection without a configured/matching bearer token, invalid payload rejection, successful update, and subsequent public visibility.
- [ ] Parse `ADMIN_TOKEN`, pass it into the app factory, and use constant-time token comparison.
- [ ] Implement public GET and admin PUT endpoints with stable JSON errors.
- [ ] Run all API tests.

### Task 4: Shared navigation and public information page

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `public/informacion.html`
- Create: `public/information.css`
- Create: `public/information.js`

- [ ] Add accessible desktop/mobile navigation linking Inicio, Clasificación and Información.
- [ ] Build the information hero, sticky section index, metadata, tournament-phase flow, role equality example, scoring cards, individual score examples, early-death explanation, no-points actions, automatic pipeline, recorded-data chips, rules, technical incidents, tiebreakers, statistics and FAQ accordions.
- [ ] Fetch `/api/tournament-information`; populate every editable or scoring-derived value with safe DOM operations and clear loading/error states.
- [ ] Reuse visual tokens, typography, crewmate motif, borders and responsive behavior from the leaderboard.

### Task 5: Administration page

**Files:**
- Create: `public/admin.html`
- Create: `public/admin.css`
- Create: `public/admin.js`

- [ ] Build a readable editor for intro, date/time, participants, status, phase, group/final format, rules, tiebreakers and FAQ lines.
- [ ] Require the operator to enter the `ADMIN_TOKEN` locally and send it only in the Authorization header.
- [ ] Parse line-based collections, display save/error feedback, and reload saved server state.
- [ ] Keep scoring visibly read-only and explain that `src/services/scoring.js` is authoritative.

### Task 6: Documentation and release verification

**Files:**
- Modify: `README.md`

- [ ] Document `ADMIN_TOKEN`, routes, editable fields, scoring source, report fields, and admin workflow.
- [ ] Run `npm test`, `node --check` for every JavaScript file, and `npm audit --omit=dev`.
- [ ] Start the server, verify public/admin APIs, and exercise an authenticated update without losing match data.
- [ ] Inspect `/`, `/informacion`, and `/admin` at desktop and mobile widths with no console errors or horizontal overflow.
