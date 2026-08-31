# Global User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `/perfil` como espacio global de cada usuario de Mini Eventos, basado en su sesión de Discord y válido para cualquier evento que vincule inscripciones a esa identidad.

**Architecture:** El almacén de Valorant ya mantiene la identidad global de Discord y la relación opcional `event_participants.discord_account_id`; se añadirá una consulta de sólo lectura que reúna las inscripciones vinculadas de todos los eventos sin exponer identificadores internos. Una API autenticada alimentará una página independiente con estados de acceso, resumen del jugador, historial de eventos y equipo, sin convertir el perfil en otra navegación de competición.

**Tech Stack:** Node.js, Express, SQLite/better-sqlite3, HTML, CSS, JavaScript y `node:test`/Supertest.

---

### Task 1: Contrato privado del perfil global

**Files:**
- Modify: `src/valorant-store.js`
- Modify: `src/app.js`
- Test: `test/valorant-draft.test.js`

- [x] **Step 1: Write the failing API tests**

```js
it('devuelve un perfil global vacío sin sesión', async () => {
  const { app } = montar();
  assert.deepEqual((await request(app).get('/api/me/profile').expect(200)).body,
    { authenticated: false });
});

it('reúne sólo las inscripciones de la cuenta conectada', async () => {
  const response = await request(app).get('/api/me/profile').set('Cookie', sesion).expect(200);
  assert.equal(response.body.authenticated, true);
  assert.equal(response.body.registrations[0].slug, 'torneo-valorant');
  assert.equal(JSON.stringify(response.body).includes('discordAccountId'), false);
});
```

- [x] **Step 2: Run the tests and verify they fail**

Run: `node --test --test-name-pattern="perfil global" test/valorant-draft.test.js`

Expected: FAIL because `/api/me/profile` does not exist.

- [x] **Step 3: Add the owner-only query and API**

```js
profileRegistrations(discordAccountId) {
  return connection.prepare(`
    SELECT e.slug, e.name event_name, e.game, e.status event_status,
           e.cover_image, e.accent_color, e.archived,
           p.status registration_status, p.riot_game_name, p.riot_tag_line,
           p.field_values_json, tm.role team_role, t.name team_name
    FROM event_participants p
    JOIN events e ON e.id=p.event_id
    LEFT JOIN team_members tm ON tm.event_id=e.id AND tm.participant_id=p.id
    LEFT JOIN teams t ON t.id=tm.team_id
    WHERE p.discord_account_id=?
    ORDER BY e.archived, e.created_at DESC, e.id DESC`).all(discordAccountId)
    .map(toOwnerProfileRegistration);
}
```

```js
app.get('/api/me/profile', (request, response, next) => {
  try {
    const session = currentSession(request);
    if (!session) return response.set('Cache-Control', 'no-store').json({ authenticated: false });
    response.set('Cache-Control', 'no-store').json({
      authenticated: true,
      displayName: session.account.displayName || session.account.username,
      avatar: null,
      registrations: database.valorant.profileRegistrations(session.account.id)
    });
  } catch (error) { next(error); }
});
```

- [x] **Step 4: Run focused tests**

Run: `node --test --test-name-pattern="perfil global" test/valorant-draft.test.js`

Expected: PASS, including isolation between two Discord accounts and absence of internal IDs.

### Task 2: Página independiente y estados de sesión

**Files:**
- Create: `public/profile.html`
- Create: `public/profile.css`
- Create: `public/profile.js`
- Modify: `src/app.js`
- Test: `test/app.test.js`

- [x] **Step 1: Write the failing route test**

```js
it('serves the global profile page', async () => {
  const response = await request(app).get('/perfil').expect(200);
  assert.match(response.text, /id="profile-main"/);
  assert.match(response.text, /profile\.js/);
});
```

- [x] **Step 2: Run the route test and verify it fails**

Run: `node --test --test-name-pattern="global profile page" test/app.test.js`

Expected: FAIL with 404.

- [x] **Step 3: Create the page shell and route**

```js
app.get('/perfil', (_request, response) =>
  response.sendFile(path.join(PUBLIC_DIRECTORY, 'profile.html')));
```

The HTML must contain `profile-login`, `profile-content`, `profile-name`, `profile-registrations`, `profile-empty`, and `profile-logout`. The unauthenticated CTA must use `/auth/discord?redirect=%2Fperfil`.

- [x] **Step 4: Implement rendering without innerHTML for user data**

```js
function eventCard(registration) {
  const article = document.createElement('article');
  const title = document.createElement('h2');
  title.textContent = registration.eventName;
  const link = document.createElement('a');
  link.href = `/eventos/${encodeURIComponent(registration.slug)}`;
  link.textContent = 'Abrir evento';
  article.append(title, link);
  return article;
}
```

The design direction is an industrial membership dossier consistent with Jartiland: one large identity card, compact status counters and a chronological event ledger. No generic dashboard sidebar and no duplicated competition navigation.

- [x] **Step 5: Run route and syntax tests**

Run: `node --check public/profile.js && node --test --test-name-pattern="global profile page" test/app.test.js`

Expected: PASS.

### Task 3: Entrada consistente desde la web pública

**Files:**
- Modify: `public/index.html`
- Modify: `public/event.html`
- Modify: `public/informacion.html`
- Modify: `public/competition-page.html`
- Modify: `public/draft.html`
- Modify: `public/competition-pages.css`
- Modify: `public/portal.css`
- Modify: `public/styles.css`
- Test: `test/app.test.js`
- Test: `test/competition-public-pages.test.js`
- Test: `test/public-navigation.test.js`

- [x] **Step 1: Write failing navigation assertions**

```js
for (const route of ['/', '/eventos/demo', '/eventos/demo/informacion',
  '/eventos/demo/competicion', '/eventos/demo/competicion/draft']) {
  assert.match((await request(app).get(route).expect(200)).text, /href="\/perfil"/);
}
```

- [x] **Step 2: Add exactly one `Mi perfil` link to each public topbar**

```html
<a class="profile-entry" href="/perfil">Mi perfil</a>
```

Keep existing event/competition return links; the profile entry is a global utility, not a new phase tab.

- [x] **Step 3: Add restrained shared styling**

```css
.profile-entry {
  color: var(--paper);
  text-decoration: none;
  text-transform: uppercase;
  font: .56rem/1 var(--mono);
  letter-spacing: .12em;
}
```

- [x] **Step 4: Run public-page tests**

Run: `node --test test/app.test.js test/competition-public-pages.test.js`

Expected: PASS with one discoverable profile link per page and unchanged competition tabs.

### Task 4: Responsive QA, regression suite and commit

**Files:**
- Test: `test/valorant-draft.test.js`
- Test: `test/app.test.js`

- [x] **Step 1: Run Playwright desktop and mobile QA**

Run a temporary native Playwright script against the local demo at `/perfil`, mocking only `/api/me/profile` with owner-safe data. Verify authenticated, unauthenticated and empty states; links; no console errors; and `scrollWidth <= clientWidth` at 1440×1000 and 390×844.

- [x] **Step 2: Run the full suite**

Run: `npm test`

Expected: all tests pass.

- [x] **Step 3: Review and commit**

```bash
git diff --check
git add src/app.js src/valorant-store.js public/profile.html public/profile.css public/profile.js \
  public/index.html public/event.html public/informacion.html public/competition-page.html public/draft.html \
  public/styles.css public/competition-pages.css public/portal.css test/app.test.js \
  test/competition-public-pages.test.js test/public-navigation.test.js test/valorant-draft.test.js \
  docs/superpowers/plans/2026-08-28-global-user-profile.md
git commit -m "feat: añadir perfil global de usuario"
```

Expected: clean worktree and a dedicated feature commit.
