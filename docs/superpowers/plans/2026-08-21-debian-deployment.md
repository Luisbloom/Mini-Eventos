# Debian Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a permanently running Debian-hosted Express application that receives Among Us match reports over the LAN, persists them in SQLite, and exposes a small web dashboard.

**Architecture:** A Node.js process binds to `0.0.0.0` and serves both static web assets and a JSON API. A focused database module owns the persistent SQLite connection and schema, while an application factory makes HTTP behavior testable without starting a production listener. Debian runs the process as a restricted service user under `systemd`; configuration and mutable data remain outside deployable source files.

**Tech Stack:** Node.js LTS, npm, Express, better-sqlite3, dotenv, Helmet, native `node:test`, Supertest, systemd.

---

## File map

- `package.json`, `package-lock.json`: runtime metadata, pinned dependencies, scripts, and supported Node version.
- `.env.example`, `.gitignore`: documented configuration and exclusions for secrets/runtime SQLite files.
- `src/config.js`: validate environment variables and resolve the database path.
- `src/database.js`: create the data directory, open SQLite, apply schema, and expose match operations.
- `src/app.js`: construct Express middleware, API routes, static delivery, and error responses.
- `src/server.js`: production startup, signal handling, and process-level failure handling.
- `src/init-db.js`: initialize or verify the SQLite schema without leaving a server running.
- `public/index.html`, `public/styles.css`, `public/app.js`: LAN dashboard for health and recent reports.
- `test/app.test.js`, `test/config.test.js`: HTTP, validation, persistence, and configuration tests.
- `deploy/systemd/jartiland-amongus.service`: hardened service definition for `/opt/jartiland-amongus`.
- `README.md`: Debian-only installation, networking, operations, backup, restore-safe updates, and optional Nginx reverse proxy.

### Task 1: Package and configuration contract

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write configuration tests**

Test that defaults resolve to host `0.0.0.0`, port `3000`, and `<project>/data/tournament.db`; test that invalid and privileged port values fail with a clear error.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --test-name-pattern=config`

Expected: FAIL because `src/config.js` does not exist.

- [ ] **Step 3: Implement package metadata and environment validation**

Define `start`, `dev`, `init-db`, and `test` scripts. Parse `PORT`, `HOST`, `DATA_DIR`, `DB_PATH`, and `TRUST_PROXY`; reject a non-integer port outside `1..65535` and resolve relative storage paths from the project root.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --test-name-pattern=config`

Expected: PASS.

### Task 2: Persistent SQLite boundary

**Files:**
- Create: `src/database.js`
- Create: `src/init-db.js`
- Test: `test/app.test.js`

- [ ] **Step 1: Write persistence tests**

Create a temporary database, insert a report, close and reopen SQLite, and assert that the same report is returned. Also assert newest-first ordering and a maximum list limit.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test`

Expected: FAIL because the database API is missing.

- [ ] **Step 3: Implement the database API**

Create parent directories recursively, enable WAL mode and foreign keys, create a `matches` table with timestamps and the unmodified JSON payload, and expose prepared `insertMatch`, `listMatches`, `getMatch`, and `close` operations. `init-db.js` must open and close the configured database and print its resolved path.

- [ ] **Step 4: Run persistence tests**

Run: `npm test`

Expected: Persistence assertions PASS.

### Task 3: HTTP API and production lifecycle

**Files:**
- Create: `src/app.js`
- Create: `src/server.js`
- Test: `test/app.test.js`

- [ ] **Step 1: Write failing API tests**

Cover `GET /api/health`, valid `POST /api/matches`, rejection of arrays/empty objects/invalid JSON, `GET /api/matches`, `GET /api/matches/:id`, a JSON 404, body-size enforcement, and reopen persistence.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test`

Expected: FAIL because the Express app factory is missing.

- [ ] **Step 3: Implement the Express factory and server**

Use Helmet, JSON parsing with a bounded body, proxy trust from configuration, structured access logs to stdout, static files, stable JSON error envelopes, and database-backed routes. Bind production to the configured host and port, handle `SIGINT`/`SIGTERM`, close SQLite, and terminate non-zero on startup or unhandled process errors.

- [ ] **Step 4: Run the full suite**

Run: `npm test`

Expected: all tests PASS.

### Task 4: Minimal tournament dashboard

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Test: `test/app.test.js`

- [ ] **Step 1: Add a static-delivery assertion**

Request `/` and assert status 200, an HTML content type, and the dashboard title.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --test-name-pattern=dashboard`

Expected: FAIL because the public entry point is absent.

- [ ] **Step 3: Build the dashboard**

Show API availability, report count, latest reception time, recent JSON reports, explicit loading/error/empty states, refresh controls, and responsive styling. Fetch only same-origin `/api` paths so the page works unchanged by IP address or reverse-proxy hostname.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all tests PASS.

### Task 5: Debian service and runbook

**Files:**
- Create: `deploy/systemd/jartiland-amongus.service`
- Create: `README.md`

- [ ] **Step 1: Add the service unit**

Run as the dedicated `jartiland` user, load `/opt/jartiland-amongus/.env`, execute `/usr/bin/node`, restart on failure, wait for networking, send stdout/stderr to journald, restrict writes to the data directory, and apply safe systemd hardening.

- [ ] **Step 2: Write the Debian runbook**

Provide exact commands for Node.js LTS installation, dependency installation, `.env`, directory ownership, database initialization, unit installation/enabling, logs, Debian IP discovery, Windows browser/API tests, firewall/VM network notes, consistent SQLite backup, restore, safe code updates that exclude `.env` and `data`, and optional Nginx proxy configuration for `amongus.jartiland.es`.

- [ ] **Step 3: Validate static assets and syntax**

Run: `npm test && npm run init-db`

Expected: tests PASS and initialization reports the persistent database path.

### Task 6: Release verification

**Files:**
- Modify only files that fail verification.

- [ ] **Step 1: Install exactly from the lockfile**

Run: `npm ci`

Expected: dependencies install successfully on the supported Node LTS range.

- [ ] **Step 2: Run automated checks**

Run: `npm test`

Expected: all tests PASS with no open handles.

- [ ] **Step 3: Smoke-test a real process**

Start with a temporary `PORT` and `DB_PATH`, request `/api/health`, post a sample report, list it, terminate with `SIGTERM`, restart, and confirm the report remains.

- [ ] **Step 4: Inspect deliverables**

Confirm `.env` and SQLite files are ignored, the service references only Debian paths, the listener defaults to `0.0.0.0:3000`, and every requested Debian operation appears in `README.md`.
