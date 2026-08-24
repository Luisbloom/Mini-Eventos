'use strict';

const crypto = require('node:crypto');

/**
 * Equipos, draft e identidad de Discord. Convive con la competición individual
 * de Among Us: son formatos distintos y ninguno estorba al otro.
 *
 * Las garantías que importan viven en el esquema y no en el código, porque el
 * draft es concurrente de verdad: cuatro capitanes pulsando a la vez. Un índice
 * único aguanta eso; una comprobación en JavaScript, no.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const DRAFT_STATUSES = Object.freeze(['PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED']);

const hash = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

/** Comparación sin filtrar por tiempo cuánto coincide. */
function timingSafeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class ValorantError extends Error {
  constructor(message, code = 'VALORANT_ERROR', status = 400) {
    super(message);
    this.name = 'ValorantError';
    this.code = code;
    this.status = status;
  }
}

function migrateValorant(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS discord_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW})
    );

    CREATE TABLE IF NOT EXISTS discord_sessions (
      id TEXT PRIMARY KEY,
      discord_account_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      expires_at TEXT NOT NULL,
      FOREIGN KEY(discord_account_id) REFERENCES discord_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_account ON discord_sessions(discord_account_id);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL,
      redirect_to TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      captain_participant_id INTEGER,
      seed INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(event_id, name),
      UNIQUE(event_id, seed),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(captain_participant_id) REFERENCES event_participants(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('captain','player')),
      joined_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(event_id, participant_id),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES event_participants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','PAUSED','COMPLETED')),
      team_count INTEGER NOT NULL CHECK (team_count > 1),
      team_size INTEGER NOT NULL CHECK (team_size > 1),
      current_pick INTEGER NOT NULL DEFAULT 1,
      current_round INTEGER NOT NULL DEFAULT 1,
      direction INTEGER NOT NULL DEFAULT 1,
      current_team_id INTEGER,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      updated_at TEXT NOT NULL DEFAULT (${NOW}),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(current_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS draft_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER NOT NULL,
      pick_number INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      captain_participant_id INTEGER NOT NULL,
      selected_participant_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW}),
      UNIQUE(draft_id, pick_number),
      UNIQUE(draft_id, selected_participant_id),
      FOREIGN KEY(draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(selected_participant_id) REFERENCES event_participants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      reason TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW})
    );
    CREATE INDEX IF NOT EXISTS idx_audit_event ON admin_audit(event_id, created_at DESC);
  `);

  // Columnas nuevas sobre una tabla con datos reales: sólo ADD COLUMN.
  const columns = connection.pragma('table_info(event_participants)').map((c) => c.name);
  const añadir = [
    ['discord_account_id', 'INTEGER REFERENCES discord_accounts(id) ON DELETE SET NULL'],
    ['riot_game_name', 'TEXT'],
    ['riot_tag_line', 'TEXT'],
    ['riot_id_normalized', 'TEXT'],
    ['riot_puuid', 'TEXT']
  ];
  for (const [name, definition] of añadir) {
    if (!columns.includes(name)) {
      connection.exec(`ALTER TABLE event_participants ADD COLUMN ${name} ${definition}`);
    }
  }

  // Una cuenta de Discord no puede tener dos inscripciones en el mismo evento.
  connection.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_participant_discord_event ' +
    'ON event_participants(event_id, discord_account_id) WHERE discord_account_id IS NOT NULL'
  );
}

/**
 * Turno que corresponde a un número de pick, calculado. Con serpiente, las
 * rondas impares van hacia delante y las pares hacia atrás.
 *
 * No depende de que haya cuatro equipos ni cuatro rondas: sale de teamCount.
 */
function snakeTurn(teamCount, pickNumber) {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new ValorantError('El número de equipos no es válido.', 'INVALID_TEAM_COUNT');
  }
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new ValorantError('El número de elección no es válido.', 'INVALID_PICK_NUMBER');
  }
  const round = Math.floor((pickNumber - 1) / teamCount) + 1;
  const positionInRound = (pickNumber - 1) % teamCount;
  const forward = round % 2 === 1;
  return {
    round,
    direction: forward ? 1 : -1,
    // Índice del equipo por su orden inicial (0 = primer capitán).
    seedIndex: forward ? positionInRound : teamCount - 1 - positionInRound
  };
}

/** Elecciones totales: cada capitán ya ocupa una plaza de su equipo. */
function totalPicks(teamCount, teamSize) {
  return teamCount * (teamSize - 1);
}

function createValorantStore(connection) {
  const audit = connection.prepare(
    'INSERT INTO admin_audit (event_id,actor,action,target,reason,details_json) VALUES (?,?,?,?,?,?)'
  );

  function record(eventId, actor, action, target, reason, details) {
    audit.run(eventId ?? null, String(actor || 'admin'), action, target ?? null,
      reason ?? null, details ? JSON.stringify(details) : null);
  }

  const toTeam = (row) => row && {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    captainParticipantId: row.captain_participant_id,
    seed: row.seed,
    status: row.status
  };

  const toDraft = (row) => row && {
    id: row.id,
    eventId: row.event_id,
    status: row.status,
    teamCount: row.team_count,
    teamSize: row.team_size,
    currentPick: row.current_pick,
    currentRound: row.current_round,
    direction: row.direction,
    currentTeamId: row.current_team_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    totalPicks: totalPicks(row.team_count, row.team_size)
  };

  const store = {
    ValorantError,
    snakeTurn,
    totalPicks,

    // ---------------- identidad de Discord ----------------

    upsertDiscordAccount({ discordUserId, username, displayName, avatar }) {
      if (!discordUserId) throw new ValorantError('Falta el identificador de Discord.', 'DISCORD_ID_REQUIRED');
      connection.prepare(`
        INSERT INTO discord_accounts (discord_user_id,username,display_name,avatar)
        VALUES (?,?,?,?)
        ON CONFLICT(discord_user_id) DO UPDATE SET
          username=excluded.username, display_name=excluded.display_name,
          avatar=excluded.avatar, updated_at=${NOW}
      `).run(String(discordUserId), String(username || ''), displayName ?? null, avatar ?? null);
      return this.getDiscordAccountByUserId(discordUserId);
    },

    getDiscordAccountByUserId(discordUserId) {
      const row = connection.prepare('SELECT * FROM discord_accounts WHERE discord_user_id=?')
        .get(String(discordUserId));
      return row && {
        id: row.id, discordUserId: row.discord_user_id, username: row.username,
        displayName: row.display_name, avatar: row.avatar
      };
    },

    /**
     * Devuelve el `state` que viaja a Discord y un `nonce` que se guarda en una
     * cookie temporal. En la base sólo queda la huella del nonce: así el state,
     * que va por la URL y acaba en registros y en el historial, no basta por sí
     * solo para completar el login desde otro navegador.
     */
    createOAuthState({ ttlSeconds = 600, redirectTo = null } = {}) {
      const state = crypto.randomBytes(32).toString('base64url');
      const nonce = crypto.randomBytes(32).toString('base64url');
      const segundos = Math.floor(ttlSeconds);
      connection.prepare(
        `INSERT INTO oauth_states (state,binding_hash,redirect_to,expires_at)
         VALUES (?,?,?,datetime('now',?))`
      ).run(state, hash(nonce), redirectTo, `${segundos >= 0 ? '+' : ''}${segundos} seconds`);
      return { state, nonce };
    },

    /**
     * Null si no existe, ya se usó, caducó o el navegador no es el que empezó.
     * Se marca usado pase lo que pase: un intento fallido tampoco se repite.
     */
    consumeOAuthState(state, nonce) {
      if (!state) return null;
      const consumir = connection.transaction((value) => {
        const row = connection.prepare('SELECT * FROM oauth_states WHERE state=?').get(value);
        if (!row) return null;
        connection.prepare(`UPDATE oauth_states SET used_at=${NOW} WHERE state=?`).run(value);
        if (row.used_at) return null;
        const vencido = connection.prepare("SELECT datetime('now') > ? AS caducado").get(row.expires_at);
        if (vencido.caducado) return null;
        if (!nonce || !timingSafeEquals(hash(nonce), row.binding_hash)) return null;
        return { state: row.state, redirectTo: row.redirect_to };
      });
      return consumir(state);
    },

    /**
     * Devuelve el testigo que va a la cookie. En la base sólo se guarda su
     * huella: leer la tabla no entrega sesiones utilizables.
     */
    createSession(discordAccountId, { ttlSeconds = 60 * 60 * 24 * 7 } = {}) {
      const token = crypto.randomBytes(32).toString('base64url');
      connection.prepare(
        `INSERT INTO discord_sessions (id,discord_account_id,expires_at) VALUES (?,?,datetime('now',?))`
      ).run(hash(token), discordAccountId, `+${Math.floor(ttlSeconds)} seconds`);
      return token;
    },

    getSession(sessionToken) {
      if (!sessionToken) return null;
      const sessionId = hash(sessionToken);
      const row = connection.prepare(`
        SELECT s.id, s.expires_at, a.id accountId, a.discord_user_id discordUserId,
               a.username, a.display_name displayName, a.avatar,
               datetime('now') > s.expires_at AS caducada
        FROM discord_sessions s JOIN discord_accounts a ON a.id = s.discord_account_id
        WHERE s.id=?`).get(sessionId);
      if (!row || row.caducada) return null;
      return {
        account: {
          id: row.accountId, discordUserId: row.discordUserId,
          username: row.username, displayName: row.displayName, avatar: row.avatar
        }
      };
    },

    destroySession(sessionToken) {
      if (!sessionToken) return false;
      return connection.prepare('DELETE FROM discord_sessions WHERE id=?')
        .run(hash(sessionToken)).changes > 0;
    },

    /** La inscripción de esa cuenta en ese evento, o null. */
    findParticipantByDiscord(eventId, discordAccountId) {
      return connection.prepare(
        'SELECT * FROM event_participants WHERE event_id=? AND discord_account_id=?'
      ).get(eventId, discordAccountId) || null;
    },

    linkParticipantToDiscord(participantId, discordAccountId) {
      const row = connection.prepare('SELECT event_id FROM event_participants WHERE id=?').get(participantId);
      if (!row) throw new ValorantError('La inscripción no existe.', 'PARTICIPANT_NOT_FOUND', 404);
      try {
        connection.prepare('UPDATE event_participants SET discord_account_id=? WHERE id=?')
          .run(discordAccountId, participantId);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
          throw new ValorantError('Esa cuenta de Discord ya está inscrita en este evento.', 'DISCORD_ALREADY_REGISTERED', 409);
        }
        throw error;
      }
      return true;
    },

    // ---------------- equipos ----------------

    listTeams(eventId) {
      const teams = connection.prepare('SELECT * FROM teams WHERE event_id=? ORDER BY seed, id')
        .all(eventId).map(toTeam);
      const members = connection.prepare(`
        SELECT m.team_id, m.participant_id participantId, m.role, p.display_name displayName
        FROM team_members m JOIN event_participants p ON p.id = m.participant_id
        WHERE m.event_id=? ORDER BY m.role='player', m.joined_at, m.id`).all(eventId);
      return teams.map((team) => ({
        ...team,
        members: members.filter((m) => m.team_id === team.id)
          .map(({ team_id, ...rest }) => rest)
      }));
    },

    getTeam(eventId, teamId) {
      return this.listTeams(eventId).find((team) => team.id === Number(teamId)) || null;
    },

    // ---------------- draft ----------------

    getDraft(eventId) {
      return toDraft(connection.prepare('SELECT * FROM drafts WHERE event_id=?').get(eventId));
    },

    listPicks(draftId) {
      return connection.prepare(`
        SELECT k.pick_number pickNumber, k.round_number roundNumber, k.team_id teamId,
               t.name teamName, k.selected_participant_id participantId,
               p.display_name displayName, k.created_at createdAt
        FROM draft_picks k
        JOIN teams t ON t.id = k.team_id
        JOIN event_participants p ON p.id = k.selected_participant_id
        WHERE k.draft_id=? ORDER BY k.pick_number`).all(draftId);
    },

    /** Confirmados que aún no están en ningún equipo. */
    listAvailableParticipants(eventId) {
      return connection.prepare(`
        SELECT p.id participantId, p.display_name displayName
        FROM event_participants p
        WHERE p.event_id=? AND p.status='confirmed'
          AND NOT EXISTS (SELECT 1 FROM team_members m WHERE m.participant_id = p.id)
        ORDER BY p.display_name`).all(eventId);
    },

    /**
     * Deja el draft preparado: crea los equipos y mete a cada capitán en el
     * suyo. Todo o nada, para que un fallo a mitad no deje equipos sueltos.
     */
    configureDraft(eventId, { captains, teamCount, teamSize, actor = 'admin' }) {
      const total = Number(teamCount);
      const size = Number(teamSize);
      if (!Array.isArray(captains) || captains.length !== total) {
        throw new ValorantError(`Hacen falta exactamente ${total} capitanes.`, 'CAPTAIN_COUNT_MISMATCH');
      }
      if (new Set(captains.map(Number)).size !== captains.length) {
        throw new ValorantError('Un mismo participante no puede ser dos capitanes.', 'DUPLICATE_CAPTAIN');
      }

      for (const participantId of captains) {
        const row = connection.prepare('SELECT * FROM event_participants WHERE id=?').get(Number(participantId));
        if (!row || row.event_id !== eventId) {
          throw new ValorantError('Un capitán no pertenece a este evento.', 'CAPTAIN_EVENT_MISMATCH');
        }
        if (row.status !== 'confirmed') {
          throw new ValorantError(`${row.display_name} no está confirmado.`, 'CAPTAIN_NOT_CONFIRMED');
        }
      }

      const existente = this.getDraft(eventId);
      if (existente && existente.status !== 'PENDING') {
        throw new ValorantError('El draft ya ha empezado.', 'DRAFT_ALREADY_STARTED', 409);
      }

      const preparar = connection.transaction(() => {
        connection.prepare('DELETE FROM team_members WHERE event_id=?').run(eventId);
        connection.prepare('DELETE FROM teams WHERE event_id=?').run(eventId);

        const equipos = captains.map((participantId, index) => {
          const nombre = connection.prepare('SELECT display_name FROM event_participants WHERE id=?')
            .get(Number(participantId)).display_name;
          const info = connection.prepare(
            'INSERT INTO teams (event_id,name,captain_participant_id,seed) VALUES (?,?,?,?)'
          ).run(eventId, `Equipo de ${nombre}`, Number(participantId), index + 1);
          connection.prepare(
            "INSERT INTO team_members (team_id,event_id,participant_id,role) VALUES (?,?,?,'captain')"
          ).run(Number(info.lastInsertRowid), eventId, Number(participantId));
          return Number(info.lastInsertRowid);
        });

        connection.prepare(`
          INSERT INTO drafts (event_id,status,team_count,team_size,current_pick,current_round,direction,current_team_id)
          VALUES (?, 'PENDING', ?, ?, 1, 1, 1, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            status='PENDING', team_count=excluded.team_count, team_size=excluded.team_size,
            current_pick=1, current_round=1, direction=1, current_team_id=excluded.current_team_id,
            started_at=NULL, completed_at=NULL, updated_at=${NOW}
        `).run(eventId, total, size, equipos[0]);

        const draft = this.getDraft(eventId);
        connection.prepare('DELETE FROM draft_picks WHERE draft_id=?').run(draft.id);
        return draft;
      });

      const draft = preparar();
      record(eventId, actor, 'DRAFT_CONFIGURED', `draft:${draft.id}`, null,
        { captains: captains.map(Number), teamCount: total, teamSize: size });
      return draft;
    },

    /** Valida todo antes de tocar nada: un arranque inválido no muta el draft. */
    startDraft(eventId, { actor = 'admin' } = {}) {
      const draft = this.getDraft(eventId);
      if (!draft) throw new ValorantError('No hay draft preparado.', 'DRAFT_NOT_FOUND', 404);
      if (draft.status !== 'PENDING') {
        throw new ValorantError('El draft no está pendiente de empezar.', 'DRAFT_NOT_PENDING', 409);
      }

      const teams = this.listTeams(eventId);
      if (teams.length !== draft.teamCount) {
        throw new ValorantError(`Hacen falta ${draft.teamCount} equipos.`, 'TEAM_COUNT_MISMATCH');
      }
      for (const team of teams) {
        if (!team.captainParticipantId) {
          throw new ValorantError(`${team.name} no tiene capitán.`, 'TEAM_WITHOUT_CAPTAIN');
        }
        if (!team.members.some((m) => m.participantId === team.captainParticipantId && m.role === 'captain')) {
          throw new ValorantError(`El capitán de ${team.name} no está en su equipo.`, 'CAPTAIN_NOT_MEMBER');
        }
      }

      // La plantilla tiene que cuadrar exacta, ni uno más ni uno menos. Con
      // "al menos los necesarios" un inscrito de sobra se quedaría fuera al
      // acabar el draft sin que nadie lo hubiera decidido. Si algún día hay
      // suplentes, se modelan como suplentes.
      const confirmados = connection.prepare(
        "SELECT COUNT(*) total FROM event_participants WHERE event_id=? AND status='confirmed'"
      ).get(eventId).total;
      const plantilla = draft.teamCount * draft.teamSize;
      if (confirmados !== plantilla) {
        throw new ValorantError(
          `Hacen falta exactamente ${plantilla} participantes confirmados y hay ${confirmados}.`,
          'ROSTER_SIZE_MISMATCH');
      }

      const disponibles = this.listAvailableParticipants(eventId).length;
      const necesarios = totalPicks(draft.teamCount, draft.teamSize);
      if (disponibles !== necesarios) {
        throw new ValorantError(
          `Tienen que quedar exactamente ${necesarios} jugadores por elegir y quedan ${disponibles}.`,
          'ELIGIBLE_SIZE_MISMATCH');
      }

      connection.prepare(
        `UPDATE drafts SET status='ACTIVE', started_at=${NOW}, updated_at=${NOW} WHERE id=?`
      ).run(draft.id);
      record(eventId, actor, 'DRAFT_STARTED', `draft:${draft.id}`, null, { picks: necesarios });
      return this.getDraft(eventId);
    },

    setDraftStatus(eventId, status, { actor = 'admin', reason = null } = {}) {
      if (!DRAFT_STATUSES.includes(status)) {
        throw new ValorantError('Estado de draft no válido.', 'INVALID_DRAFT_STATUS');
      }
      const draft = this.getDraft(eventId);
      if (!draft) throw new ValorantError('No hay draft.', 'DRAFT_NOT_FOUND', 404);
      if (draft.status === 'COMPLETED') {
        throw new ValorantError('El draft ya está terminado.', 'DRAFT_COMPLETED', 409);
      }
      if (status === 'PAUSED' && draft.status !== 'ACTIVE') {
        throw new ValorantError('Sólo se puede pausar un draft en curso.', 'DRAFT_NOT_ACTIVE', 409);
      }
      if (status === 'ACTIVE' && draft.status !== 'PAUSED') {
        throw new ValorantError('Sólo se puede reanudar un draft pausado.', 'DRAFT_NOT_PAUSED', 409);
      }
      connection.prepare(`UPDATE drafts SET status=?, updated_at=${NOW} WHERE id=?`).run(status, draft.id);
      record(eventId, actor, status === 'PAUSED' ? 'DRAFT_PAUSED' : 'DRAFT_RESUMED',
        `draft:${draft.id}`, reason, { pick: draft.currentPick });
      return this.getDraft(eventId);
    },

    /** El equipo al que le toca, según el orden inicial de capitanes. */
    teamForPick(eventId, pickNumber) {
      const draft = this.getDraft(eventId);
      if (!draft) return null;
      const turno = snakeTurn(draft.teamCount, pickNumber);
      const teams = connection.prepare('SELECT * FROM teams WHERE event_id=? ORDER BY seed, id').all(eventId);
      return { ...turno, team: toTeam(teams[turno.seedIndex]) };
    },

    /**
     * Una elección, entera o nada. La autoridad es el participante autenticado
     * que llega por sesión: aquí no se acepta ningún «soy el capitán» del
     * navegador.
     */
    pick(eventId, { captainParticipantId, selectedParticipantId }) {
      const elegir = connection.transaction(() => {
        const draft = this.getDraft(eventId);
        if (!draft) throw new ValorantError('No hay draft.', 'DRAFT_NOT_FOUND', 404);
        if (draft.status !== 'ACTIVE') {
          throw new ValorantError('El draft no está en curso.', 'DRAFT_NOT_ACTIVE', 409);
        }

        const turno = this.teamForPick(eventId, draft.currentPick);
        if (!turno?.team) throw new ValorantError('No hay turno.', 'NO_CURRENT_TURN', 409);
        if (turno.team.captainParticipantId !== Number(captainParticipantId)) {
          throw new ValorantError('No es tu turno.', 'NOT_YOUR_TURN', 409);
        }

        const objetivo = connection.prepare('SELECT * FROM event_participants WHERE id=?')
          .get(Number(selectedParticipantId));
        if (!objetivo || objetivo.event_id !== eventId) {
          throw new ValorantError('Ese jugador no participa en este evento.', 'TARGET_EVENT_MISMATCH');
        }
        if (objetivo.status !== 'confirmed') {
          throw new ValorantError('Ese jugador no está confirmado.', 'TARGET_NOT_CONFIRMED');
        }

        const ocupado = connection.prepare('SELECT 1 FROM team_members WHERE event_id=? AND participant_id=?')
          .get(eventId, objetivo.id);
        if (ocupado) throw new ValorantError('Ese jugador ya tiene equipo.', 'TARGET_ALREADY_TAKEN', 409);

        const tamaño = connection.prepare('SELECT COUNT(*) total FROM team_members WHERE team_id=?')
          .get(turno.team.id).total;
        if (tamaño >= draft.teamSize) {
          throw new ValorantError('El equipo ya está completo.', 'TEAM_FULL', 409);
        }

        connection.prepare(`
          INSERT INTO draft_picks (draft_id,pick_number,round_number,team_id,captain_participant_id,selected_participant_id)
          VALUES (?,?,?,?,?,?)`)
          .run(draft.id, draft.currentPick, turno.round, turno.team.id,
            Number(captainParticipantId), objetivo.id);

        connection.prepare(
          "INSERT INTO team_members (team_id,event_id,participant_id,role) VALUES (?,?,?,'player')"
        ).run(turno.team.id, eventId, objetivo.id);

        const siguiente = draft.currentPick + 1;
        if (siguiente > draft.totalPicks) {
          connection.prepare(
            `UPDATE drafts SET status='COMPLETED', current_pick=?, completed_at=${NOW}, updated_at=${NOW},
             current_team_id=NULL WHERE id=?`).run(siguiente, draft.id);
        } else {
          const proximo = this.teamForPick(eventId, siguiente);
          connection.prepare(
            `UPDATE drafts SET current_pick=?, current_round=?, direction=?, current_team_id=?, updated_at=${NOW}
             WHERE id=?`)
            .run(siguiente, proximo.round, proximo.direction, proximo.team.id, draft.id);
        }

        return {
          pickNumber: draft.currentPick,
          roundNumber: turno.round,
          teamId: turno.team.id,
          participantId: objetivo.id,
          displayName: objetivo.display_name,
          draft: this.getDraft(eventId)
        };
      });

      try {
        return elegir();
      } catch (error) {
        // Dos peticiones a la vez: la segunda choca contra el índice único.
        if (error instanceof ValorantError) throw error;
        if (String(error.message).includes('UNIQUE')) {
          throw new ValorantError('Esa elección ya se ha registrado.', 'PICK_ALREADY_TAKEN', 409);
        }
        throw error;
      }
    },

    // ---------------- correcciones de administración ----------------

    moveParticipant(eventId, { participantId, toTeamId, reason, actor = 'admin' }) {
      if (!reason || !String(reason).trim()) {
        throw new ValorantError('Hace falta un motivo.', 'REASON_REQUIRED');
      }
      const destino = connection.prepare('SELECT * FROM teams WHERE id=? AND event_id=?').get(toTeamId, eventId);
      if (!destino) throw new ValorantError('El equipo no existe en este evento.', 'TEAM_NOT_FOUND', 404);

      const mover = connection.transaction(() => {
        const actual = connection.prepare('SELECT * FROM team_members WHERE event_id=? AND participant_id=?')
          .get(eventId, participantId);
        if (!actual) throw new ValorantError('Ese jugador no está en ningún equipo.', 'MEMBER_NOT_FOUND', 404);
        if (actual.role === 'captain') {
          throw new ValorantError('Para mover a un capitán, cámbialo antes.', 'CANNOT_MOVE_CAPTAIN', 409);
        }
        connection.prepare('UPDATE team_members SET team_id=? WHERE id=?').run(toTeamId, actual.id);
        return { from: actual.team_id, to: Number(toTeamId) };
      });

      const resultado = mover();
      record(eventId, actor, 'PLAYER_MOVED', `participant:${participantId}`, reason, resultado);
      return this.getTeam(eventId, toTeamId);
    },

    changeCaptain(eventId, { teamId, participantId, reason, actor = 'admin' }) {
      if (!reason || !String(reason).trim()) {
        throw new ValorantError('Hace falta un motivo.', 'REASON_REQUIRED');
      }
      const cambiar = connection.transaction(() => {
        const equipo = connection.prepare('SELECT * FROM teams WHERE id=? AND event_id=?').get(teamId, eventId);
        if (!equipo) throw new ValorantError('El equipo no existe.', 'TEAM_NOT_FOUND', 404);
        const miembro = connection.prepare('SELECT * FROM team_members WHERE team_id=? AND participant_id=?')
          .get(teamId, participantId);
        if (!miembro) throw new ValorantError('Ese jugador no está en el equipo.', 'MEMBER_NOT_FOUND', 404);

        connection.prepare("UPDATE team_members SET role='player' WHERE team_id=? AND role='captain'").run(teamId);
        connection.prepare("UPDATE team_members SET role='captain' WHERE id=?").run(miembro.id);
        connection.prepare(`UPDATE teams SET captain_participant_id=?, updated_at=${NOW} WHERE id=?`)
          .run(participantId, teamId);
        return { anterior: equipo.captain_participant_id, nuevo: Number(participantId) };
      });

      const resultado = cambiar();
      record(eventId, actor, 'CAPTAIN_CHANGED', `team:${teamId}`, reason, resultado);
      return this.getTeam(eventId, teamId);
    },

    listAudit(eventId, { limit = 50 } = {}) {
      return connection.prepare(
        'SELECT actor,action,target,reason,details_json,created_at createdAt FROM admin_audit ' +
        'WHERE event_id IS ? ORDER BY id DESC LIMIT ?'
      ).all(eventId, Math.min(Number(limit) || 50, 200))
        .map((row) => ({ ...row, details: row.details_json ? JSON.parse(row.details_json) : null, details_json: undefined }));
    },

    /** Lo que puede ver cualquiera: nombres sí, identidades privadas no. */
    publicDraftState(eventId) {
      const draft = this.getDraft(eventId);
      if (!draft) return null;
      const turno = draft.status === 'ACTIVE' ? this.teamForPick(eventId, draft.currentPick) : null;
      return {
        status: draft.status,
        round: draft.currentRound,
        pick: draft.currentPick,
        totalPicks: draft.totalPicks,
        teamCount: draft.teamCount,
        teamSize: draft.teamSize,
        currentTeamId: turno?.team?.id ?? null,
        teams: this.listTeams(eventId).map((team) => ({
          id: team.id, name: team.name, seed: team.seed,
          captainParticipantId: team.captainParticipantId,
          members: team.members.map((m) => ({
            participantId: m.participantId, displayName: m.displayName, role: m.role
          }))
        })),
        available: this.listAvailableParticipants(eventId),
        picks: this.listPicks(draft.id)
      };
    }
  };

  return store;
}

module.exports = { migrateValorant, createValorantStore, snakeTurn, totalPicks, ValorantError, DRAFT_STATUSES };
