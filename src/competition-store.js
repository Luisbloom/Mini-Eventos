'use strict';

const { CompetitionError, automaticCompare, balanceParticipants, buildCompetitionLeaderboard, resolutionPath } = require('./competition');

const STAGE_TYPES = ['group_stage', 'final', 'league', 'knockout'];
const STAGE_STATUSES = ['pending', 'active', 'completed'];
const REPORTER_TOKEN_HASH_COLUMN = `reporter_token_hash TEXT CHECK (
  reporter_token_hash IS NULL OR (
    length(reporter_token_hash) = 64
    AND reporter_token_hash NOT GLOB '*[^0-9a-f]*'
  )
)`;

function addColumn(connection, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!connection.pragma(`table_info(${table})`).some((column) => column.name === name)) {
    connection.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

function migrateParticipantStatuses(connection) {
  const schema = connection.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='event_participants'").get()?.sql || '';
  if (schema.includes("'rejected'")) return;
  connection.exec(`
    CREATE TABLE event_participants_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      discord_username TEXT NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      field_values_json TEXT NOT NULL CHECK (json_valid(field_values_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','absent','disqualified')),
      internal_friend_code TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (event_id, discord_username),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    INSERT INTO event_participants_v2 SELECT * FROM event_participants;
    DROP TABLE event_participants;
    ALTER TABLE event_participants_v2 RENAME TO event_participants;
    CREATE INDEX IF NOT EXISTS idx_participants_event_status ON event_participants(event_id,status,created_at);
  `);
}

function ensureValidMatchSlotIndex(connection) {
  const existing = connection.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='ux_matches_competitive_slot'").get();
  if (existing) return;
  const duplicate = connection.prepare(`
    SELECT event_id, stage_id, group_id, match_number, COUNT(*) AS total
    FROM matches
    WHERE match_status='VALID' AND stage_id IS NOT NULL AND match_number IS NOT NULL
    GROUP BY event_id, stage_id, COALESCE(group_id, 0), match_number
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (duplicate) {
    const group = duplicate.group_id === null ? 'sin grupo' : `grupo ${duplicate.group_id}`;
    throw new CompetitionError(
      `No se puede crear la protección de slots: hay ${duplicate.total} resultados VALID para el evento ${duplicate.event_id}, fase ${duplicate.stage_id}, ${group}, partida ${duplicate.match_number}. Anula los duplicados antes de reiniciar.`,
      'MATCH_SLOT_DUPLICATES_EXIST',
      500
    );
  }
  try {
    connection.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_matches_competitive_slot
      ON matches(event_id,stage_id,COALESCE(group_id,0),match_number)
      WHERE stage_id IS NOT NULL AND match_status='VALID';
    `);
  } catch (error) {
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    throw new CompetitionError(
      'No se puede crear la protección de slots porque existen resultados VALID duplicados. Anula los duplicados antes de reiniciar.',
      'MATCH_SLOT_DUPLICATES_EXIST',
      500
    );
  }
}

function migrateCompetition(connection, defaultEventId) {
  connection.transaction(() => {
    migrateParticipantStatuses(connection);
    addColumn(connection, 'matches', 'stage_id INTEGER');
    addColumn(connection, 'matches', 'group_id INTEGER');
    addColumn(connection, 'matches', 'host_id INTEGER');
    addColumn(connection, 'matches', 'match_number INTEGER');
    addColumn(connection, 'matches', 'played_at TEXT');
    addColumn(connection, 'matches', "match_status TEXT NOT NULL DEFAULT 'VALID'");
    addColumn(connection, 'matches', 'void_reason TEXT');
    addColumn(connection, 'matches', "origin TEXT NOT NULL DEFAULT 'REPORTER'");
    addColumn(connection, 'matches', 'submitted_by TEXT');
    addColumn(connection, 'matches', "report_fingerprint TEXT CHECK (report_fingerprint IS NULL OR (length(report_fingerprint)=64 AND report_fingerprint NOT GLOB '*[^0-9a-f]*'))");
    connection.exec(`
      CREATE TABLE IF NOT EXISTS event_stages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('group_stage','final','league','knockout')),
        position INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','completed')),
        matches_per_group INTEGER NOT NULL DEFAULT 1 CHECK(matches_per_group > 0),
        qualifiers_per_group INTEGER NOT NULL DEFAULT 0 CHECK(qualifiers_per_group >= 0),
        reset_points INTEGER NOT NULL DEFAULT 1 CHECK(reset_points IN (0,1)),
        groups_locked INTEGER NOT NULL DEFAULT 0 CHECK(groups_locked IN (0,1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        completed_at TEXT,
        UNIQUE(event_id, position),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        stage_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        UNIQUE(stage_id, name),
        UNIQUE(stage_id, position),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY(stage_id) REFERENCES event_stages(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS stage_participants (
        stage_id INTEGER NOT NULL,
        participant_id INTEGER NOT NULL,
        group_id INTEGER,
        competitive_status TEXT NOT NULL DEFAULT 'pending' CHECK(competitive_status IN ('pending','competing','qualification_zone','qualified','eliminated','finalist','champion','disqualified')),
        seed_order INTEGER,
        advanced_from_stage_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY(stage_id, participant_id),
        FOREIGN KEY(stage_id) REFERENCES event_stages(id) ON DELETE CASCADE,
        FOREIGN KEY(participant_id) REFERENCES event_participants(id) ON DELETE CASCADE,
        FOREIGN KEY(group_id) REFERENCES event_groups(id) ON DELETE SET NULL,
        FOREIGN KEY(advanced_from_stage_id) REFERENCES event_stages(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS event_hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        identifier TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ${REPORTER_TOKEN_HASH_COLUMN},
        reporter_token_created_at TEXT,
        reporter_last_seen_at TEXT,
        assigned_stage_id INTEGER,
        assigned_group_id INTEGER,
        UNIQUE(event_id, identifier),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        time TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS event_prizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prize_value TEXT,
        stat_key TEXT,
        position INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tie_resolutions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        stage_id INTEGER NOT NULL,
        group_id INTEGER,
        higher_participant_id INTEGER NOT NULL,
        lower_participant_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        resolved_by TEXT NOT NULL DEFAULT 'ADMIN',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(stage_id, group_id, higher_participant_id, lower_participant_id),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY(stage_id) REFERENCES event_stages(id) ON DELETE CASCADE,
        FOREIGN KEY(group_id) REFERENCES event_groups(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(event_id,stage_id,group_id,match_status,match_number);
      CREATE INDEX IF NOT EXISTS idx_stage_participants_group ON stage_participants(stage_id,group_id,competitive_status);
      CREATE INDEX IF NOT EXISTS idx_schedule_event_position ON event_schedule(event_id,position);
      CREATE INDEX IF NOT EXISTS idx_prizes_event_position ON event_prizes(event_id,position);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_tie_resolution_scope ON tie_resolutions(stage_id,COALESCE(group_id,0),higher_participant_id,lower_participant_id);
    `);
    ensureValidMatchSlotIndex(connection);
    // SQLite no permite añadir con ALTER TABLE un default basado en strftime.
    // Las tablas nuevas usan el default anterior; las antiguas se rellenan justo después.
    addColumn(connection, 'event_hosts', "created_at TEXT NOT NULL DEFAULT ''");
    addColumn(connection, 'event_hosts', REPORTER_TOKEN_HASH_COLUMN);
    addColumn(connection, 'event_hosts', 'reporter_token_created_at TEXT');
    addColumn(connection, 'event_hosts', 'reporter_last_seen_at TEXT');
    addColumn(connection, 'event_hosts', 'assigned_stage_id INTEGER');
    addColumn(connection, 'event_hosts', 'assigned_group_id INTEGER');
    connection.prepare("UPDATE event_hosts SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at=''").run();
    connection.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_hosts_reporter_token_hash
      ON event_hosts(reporter_token_hash)
      WHERE reporter_token_hash IS NOT NULL;
    `);
    connection.prepare(`INSERT OR IGNORE INTO event_stages
      (event_id,name,type,position,status,matches_per_group,qualifiers_per_group,reset_points,enabled)
      VALUES (?, 'Fase de Clasificación', 'group_stage', 1, 'pending', 5, 5, 1, 1)`).run(defaultEventId);
    connection.prepare(`INSERT OR IGNORE INTO event_stages
      (event_id,name,type,position,status,matches_per_group,qualifiers_per_group,reset_points,enabled)
      VALUES (?, 'Gran Final', 'final', 2, 'pending', 5, 0, 1, 1)`).run(defaultEventId);
    const groupStage = connection.prepare("SELECT id FROM event_stages WHERE event_id=? AND type='group_stage' ORDER BY position LIMIT 1").get(defaultEventId);
    if (groupStage) {
      connection.prepare('INSERT OR IGNORE INTO event_groups(event_id,stage_id,name,position) VALUES (?,?,?,?)').run(defaultEventId, groupStage.id, 'Grupo A', 1);
      connection.prepare('INSERT OR IGNORE INTO event_groups(event_id,stage_id,name,position) VALUES (?,?,?,?)').run(defaultEventId, groupStage.id, 'Grupo B', 2);
    }
    connection.prepare("INSERT OR IGNORE INTO event_hosts(event_id,name,identifier,enabled,created_at) VALUES (?,'Host Grupo A','HOST_1',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(defaultEventId);
    connection.prepare("INSERT OR IGNORE INTO event_hosts(event_id,name,identifier,enabled,created_at) VALUES (?,'Host Grupo B','HOST_2',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(defaultEventId);
    if (!connection.prepare('SELECT 1 FROM event_schedule WHERE event_id=?').get(defaultEventId)) {
      const insert = connection.prepare('INSERT INTO event_schedule(event_id,time,title,description,position) VALUES (?,?,?,?,?)');
      [['16:00','Inicio del torneo','Bienvenida y preparación de lobbies'],['16:10','Fase de clasificación','Inicio simultáneo de Grupo A y Grupo B'],['17:45','Publicación de finalistas','Confirmación del top de cada grupo'],['18:00','Gran Final','Cinco partidas con puntos reiniciados'],['19:30','Entrega de premios','Cierre del torneo']].forEach((row,index)=>insert.run(defaultEventId,...row,index+1));
    }
    if (!connection.prepare('SELECT 1 FROM event_prizes WHERE event_id=?').get(defaultEventId)) {
      const insert = connection.prepare('INSERT INTO event_prizes(event_id,title,description,prize_value,stat_key,position,enabled) VALUES (?,?,?,?,?,?,1)');
      [['1.º puesto','Campeón del torneo','50 Jartis + rol especial',null],['2.º puesto','Subcampeón del torneo','Premio por confirmar',null],['3.º puesto','Tercer clasificado','Premio por confirmar',null],['Mayor número de kills','Premio estadístico','Reconocimiento especial','kills']].forEach((row,index)=>insert.run(defaultEventId,...row,index+1));
    }
    connection.prepare(`UPDATE events SET modules_json=json_set(modules_json,'$.competition',1,'$.schedule',1,'$.prizes',1) WHERE id=?`).run(defaultEventId);
  })();
}

function createCompetitionStore(connection) {
  const stageSelect = 'SELECT * FROM event_stages WHERE id=?';
  const toStage = (row) => row && ({ id:row.id,eventId:row.event_id,name:row.name,type:row.type,position:row.position,status:row.status,matchesPerGroup:row.matches_per_group,qualifiersPerGroup:row.qualifiers_per_group,resetPoints:Boolean(row.reset_points),groupsLocked:Boolean(row.groups_locked),enabled:Boolean(row.enabled),completedAt:row.completed_at });
  const toGroup = (row) => row && ({ id:row.id,eventId:row.event_id,stageId:row.stage_id,name:row.name,position:row.position,participantCount:Number(row.participant_count ?? 0) });
  function toHost(row) {
    if (!row) return null;
    return {
      id: row.id,
      eventId: row.event_id,
      name: row.name,
      identifier: row.identifier,
      enabled: Boolean(row.enabled),
      tokenConfigured: Boolean(row.reporter_token_hash),
      tokenCreatedAt: row.reporter_token_created_at ?? null,
      lastSeenAt: row.reporter_last_seen_at ?? null,
      assignedStageId: row.assigned_stage_id ?? null,
      assignedGroupId: row.assigned_group_id ?? null,
      createdAt: row.created_at
    };
  }
  const requireStage = (id) => { const stage=toStage(connection.prepare(stageSelect).get(id)); if(!stage) throw new CompetitionError('La fase no existe.','STAGE_NOT_FOUND',404); return stage; };
  const requireGroup = (id) => { const row=connection.prepare('SELECT * FROM event_groups WHERE id=?').get(id); if(!row) throw new CompetitionError('El grupo no existe.','GROUP_NOT_FOUND',404); return toGroup(row); };
  const listGroups = (stageId) => connection.prepare(`SELECT g.*,(SELECT COUNT(*) FROM stage_participants sp WHERE sp.group_id=g.id) participant_count FROM event_groups g WHERE stage_id=? ORDER BY position,id`).all(stageId).map(toGroup);
  const listStageParticipants = (stageId, groupId = null) => connection.prepare(`SELECT sp.*,p.display_name,p.status registration_status FROM stage_participants sp JOIN event_participants p ON p.id=sp.participant_id WHERE sp.stage_id=? AND (? IS NULL OR sp.group_id=?) ORDER BY sp.seed_order,p.display_name COLLATE NOCASE`).all(stageId,groupId,groupId).map((row)=>({stageId:row.stage_id,participantId:row.participant_id,groupId:row.group_id,displayName:row.display_name,registrationStatus:row.registration_status,competitiveStatus:row.competitive_status,seedOrder:row.seed_order,advancedFromStageId:row.advanced_from_stage_id}));
  const replaceSimple = (table, eventId, rows, insertSql, mapper) => connection.transaction(()=>{ connection.prepare(`DELETE FROM ${table} WHERE event_id=?`).run(eventId); const insert=connection.prepare(insertSql); rows.forEach((row,index)=>insert.run(...mapper(row,index))); })();

  function listStages(eventId) { return connection.prepare('SELECT * FROM event_stages WHERE event_id=? ORDER BY position,id').all(eventId).map(toStage).map((stage)=>({...stage,groups:listGroups(stage.id),participants:listStageParticipants(stage.id)})); }
  function getStageLeaderboard(stageId, groupId = null) {
    const stage=requireStage(stageId); if(groupId){const group=requireGroup(groupId);if(group.stageId!==stage.id)throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');}
    const members=listStageParticipants(stage.id,groupId).filter((row)=>row.registrationStatus==='confirmed'&&row.competitiveStatus!=='disqualified'); const ids=members.map((row)=>row.participantId);
    let sql=`SELECT * FROM matches WHERE event_id=? AND match_status='VALID'`;
    const params=[stage.eventId];
    if(stage.resetPoints || stage.type==='group_stage'){sql+=' AND stage_id=?';params.push(stage.id);} else {sql+=' AND (stage_id IN (SELECT id FROM event_stages WHERE event_id=? AND position<=?))';params.push(stage.eventId,stage.position);}
    if(groupId){sql+=' AND group_id=?';params.push(groupId);} else if(stage.type==='final'&&stage.resetPoints){sql+=' AND group_id IS NULL';}
    sql+=' ORDER BY id';
    const matches=connection.prepare(sql).all(...params).map((row)=>({id:row.id,status:row.match_status,receivedAt:row.received_at,report:JSON.parse(row.payload_json)}));
    const resolutions=connection.prepare('SELECT higher_participant_id higherParticipantId,lower_participant_id lowerParticipantId FROM tie_resolutions WHERE stage_id=? AND (group_id IS ? OR group_id=?)').all(stage.id,groupId,groupId);
    const result=buildCompetitionLeaderboard(matches,{participantIds:ids,qualifiers:stage.type==='group_stage'?stage.qualifiersPerGroup:(stage.type==='final'?1:0),resolutions});
    const names=new Map(members.map((member)=>[member.participantId,member.displayName])); result.standings.forEach((row)=>{row.name=names.get(row.participantId)||row.name;});
    return {...result,stage,group:groupId?requireGroup(groupId):null};
  }
  function previewStageCompletion(stageId) {
    const stage=requireStage(stageId); const groups=listGroups(stage.id); const scopes=stage.type==='group_stage'?groups:[null]; const summaries=[]; const issues=[];
    for(const group of scopes){const leaderboard=getStageLeaderboard(stage.id,group?.id||null);const matchCount=connection.prepare("SELECT COUNT(DISTINCT match_number) total FROM matches WHERE stage_id=? AND (group_id IS ? OR group_id=?) AND match_status='VALID'").get(stage.id,group?.id||null,group?.id||null).total;const missing=Math.max(0,stage.matchesPerGroup-matchCount);if(missing)issues.push({code:'MISSING_MATCHES',groupId:group?.id||null,count:missing});if(stage.type==='group_stage'&&leaderboard.standings.length<stage.qualifiersPerGroup)issues.push({code:'INSUFFICIENT_PARTICIPANTS',groupId:group.id});if(leaderboard.cutoffTie)issues.push({code:stage.type==='final'?'CHAMPION_TIE':'CUTOFF_TIE',groupId:group?.id||null,participantIds:leaderboard.decisiveTieParticipantIds});summaries.push({group,matchCount,missingMatches:missing,leaderboard});}
    return {stage,summaries,issues,blocking:issues.some((issue)=>['CUTOFF_TIE','CHAMPION_TIE'].includes(issue.code))};
  }
  const completeTransaction=connection.transaction((stageId,force)=>{const current=requireStage(stageId);if(current.status!=='active')throw new CompetitionError('Sólo puede finalizarse una fase activa.','STAGE_NOT_ACTIVE',409);const preview=previewStageCompletion(stageId);if(preview.blocking)throw new CompetitionError('Hay un desempate decisivo pendiente.','DECISIVE_TIE',409);if(preview.issues.length&&!force)throw new CompetitionError('La fase tiene avisos pendientes. Confirma el cierre forzado.','STAGE_WARNINGS',409);const stage=preview.stage;const next=toStage(connection.prepare('SELECT * FROM event_stages WHERE event_id=? AND enabled=1 AND position>? ORDER BY position LIMIT 1').get(stage.eventId,stage.position));for(const summary of preview.summaries){const top=stage.type==='group_stage'?summary.leaderboard.standings.slice(0,stage.qualifiersPerGroup):summary.leaderboard.standings.slice(0,1);const qualified=new Set(top.map((row)=>row.participantId));connection.prepare(`UPDATE stage_participants SET competitive_status=CASE WHEN participant_id IN (${[...qualified].map(()=>'?').join(',')||'NULL'}) THEN ? ELSE 'eliminated' END WHERE stage_id=? AND (? IS NULL OR group_id=?)`).run(...qualified,stage.type==='final'?'champion':'qualified',stage.id,summary.group?.id||null,summary.group?.id||null);if(next){const insert=connection.prepare(`INSERT OR IGNORE INTO stage_participants(stage_id,participant_id,group_id,competitive_status,seed_order,advanced_from_stage_id) VALUES (?,?,NULL,'finalist',?,?)`);top.forEach((row,index)=>insert.run(next.id,row.participantId,index+1,stage.id));}}
    connection.prepare("UPDATE event_stages SET status='completed',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(stage.id);if(next)connection.prepare("UPDATE event_stages SET status='active' WHERE id=? AND status='pending'").run(next.id);return previewStageCompletion(stage.id);});
  return {
    listStages,getStage(id){return requireStage(id);},getGroup(id){return requireGroup(id);},listGroups,listStageParticipants,getStageLeaderboard,previewStageCompletion,
    createStage(eventId,input){const type=STAGE_TYPES.includes(input.type)?input.type:'league';const result=connection.prepare(`INSERT INTO event_stages(event_id,name,type,position,status,matches_per_group,qualifiers_per_group,reset_points,enabled) VALUES (?,?,?,?,?,?,?,?,?)`).run(eventId,String(input.name).trim(),type,Number(input.position),STAGE_STATUSES.includes(input.status)?input.status:'pending',Number(input.matchesPerGroup||1),Number(input.qualifiersPerGroup||0),Number(input.resetPoints!==false),Number(input.enabled!==false));return requireStage(Number(result.lastInsertRowid));},
    updateStage(id,input){const current=requireStage(id);const next={...current,...input};if(!STAGE_TYPES.includes(next.type)||!STAGE_STATUSES.includes(next.status))throw new CompetitionError('Tipo o estado de fase no válido.');if(current.status==='completed'&&next.status!=='completed')throw new CompetitionError('Una fase completada no puede reabrirse sin un flujo auditado.','STAGE_ALREADY_COMPLETED',409);if(current.status!=='completed'&&next.status==='completed')throw new CompetitionError('Finaliza la fase mediante la acción auditada.','USE_STAGE_COMPLETION',409);connection.prepare(`UPDATE event_stages SET name=?,type=?,position=?,status=?,matches_per_group=?,qualifiers_per_group=?,reset_points=?,enabled=? WHERE id=?`).run(String(next.name).trim(),next.type,Number(next.position),next.status,Number(next.matchesPerGroup),Number(next.qualifiersPerGroup),Number(next.resetPoints),Number(next.enabled),id);return requireStage(id);},
    replaceGroups(stageId,groups){const stage=requireStage(stageId);if(stage.groupsLocked)throw new CompetitionError('Los grupos están bloqueados.','GROUPS_LOCKED',409);if(!Array.isArray(groups)||groups.length<1)throw new CompetitionError('La fase necesita al menos un grupo.','GROUP_REQUIRED');connection.transaction(()=>{const existing=listGroups(stageId);const suppliedIds=groups.filter((group)=>group.id!==undefined&&group.id!==null).map((group)=>Number(group.id));if(new Set(suppliedIds).size!==suppliedIds.length)throw new CompetitionError('No se puede repetir un grupo.','DUPLICATE_GROUP');for(const id of suppliedIds){if(!existing.some((group)=>group.id===id))throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');}for(const group of existing.filter((row)=>!suppliedIds.includes(row.id))){const matchCount=connection.prepare('SELECT COUNT(*) total FROM matches WHERE group_id=?').get(group.id).total;const participantCount=connection.prepare('SELECT COUNT(*) total FROM stage_participants WHERE group_id=?').get(group.id).total;if(matchCount||participantCount)throw new CompetitionError(`No se puede eliminar ${group.name}: tiene participantes o partidas asociados.`,'GROUP_IN_USE',409);connection.prepare('DELETE FROM event_groups WHERE id=?').run(group.id);}const insert=connection.prepare('INSERT INTO event_groups(event_id,stage_id,name,position) VALUES (?,?,?,?)');const update=connection.prepare('UPDATE event_groups SET name=?,position=? WHERE id=? AND stage_id=?');groups.forEach((group,index)=>{const name=String(group.name||'').trim();if(!name)throw new CompetitionError('El grupo necesita nombre.');const position=Number(group.position??index+1);if(group.id!==undefined&&group.id!==null)update.run(name,position,Number(group.id),stage.id);else insert.run(stage.eventId,stage.id,name,position);});})();return listGroups(stageId);},
    distributeGroups(stageId){const stage=requireStage(stageId);if(stage.groupsLocked)throw new CompetitionError('Los grupos están bloqueados.','GROUPS_LOCKED',409);const groups=listGroups(stageId);const participants=connection.prepare("SELECT id FROM event_participants WHERE event_id=? AND status='confirmed' ORDER BY id").all(stage.eventId).map((row)=>row.id);const distribution=balanceParticipants(participants,groups.map((group)=>group.id));connection.transaction(()=>{connection.prepare('DELETE FROM stage_participants WHERE stage_id=?').run(stageId);const insert=connection.prepare("INSERT INTO stage_participants(stage_id,participant_id,group_id,competitive_status,seed_order) VALUES (?,?,?,'competing',?)");distribution.forEach((bucket)=>bucket.participantIds.forEach((participantId,index)=>insert.run(stageId,participantId,bucket.groupId,index+1)));})();return listStageParticipants(stageId);},
    assignParticipant(stageId,participantId,groupId){const stage=requireStage(stageId);if(stage.groupsLocked)throw new CompetitionError('Los grupos están bloqueados.','GROUPS_LOCKED',409);if(groupId!==null&&requireGroup(groupId).stageId!==stage.id)throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');const participant=connection.prepare('SELECT * FROM event_participants WHERE id=? AND event_id=?').get(participantId,stage.eventId);if(!participant||participant.status!=='confirmed')throw new CompetitionError('Sólo pueden asignarse participantes confirmados.','PARTICIPANT_NOT_CONFIRMED',409);connection.prepare(`INSERT INTO stage_participants(stage_id,participant_id,group_id,competitive_status) VALUES (?,?,?,'competing') ON CONFLICT(stage_id,participant_id) DO UPDATE SET group_id=excluded.group_id,competitive_status='competing'`).run(stageId,participantId,groupId);return listStageParticipants(stageId);},
    setGroupsLocked(stageId,locked){requireStage(stageId);connection.prepare('UPDATE event_stages SET groups_locked=? WHERE id=?').run(Number(Boolean(locked)),stageId);return requireStage(stageId);},
    listHosts(eventId){return connection.prepare('SELECT * FROM event_hosts WHERE event_id=? ORDER BY id').all(eventId).map(toHost);},
    getHost(eventId,hostIdOrIdentifier){const row=Number.isInteger(hostIdOrIdentifier)?connection.prepare('SELECT * FROM event_hosts WHERE event_id=? AND id=?').get(eventId,hostIdOrIdentifier):connection.prepare('SELECT * FROM event_hosts WHERE event_id=? AND identifier=?').get(eventId,String(hostIdOrIdentifier));return toHost(row);},
    findHostByReporterTokenHashAnywhere(tokenHash){const row=connection.prepare('SELECT * FROM event_hosts WHERE reporter_token_hash=?').get(tokenHash);return row?{host:toHost(row),eventId:row.event_id}:null;},
    setHostAssignment(eventId,hostId,{stageId=null,groupId=null}={}){const host=this.getHost(eventId,hostId);if(!host)throw new CompetitionError('El host no pertenece al evento.','HOST_EVENT_MISMATCH',404);
      const normalizedStageId=stageId===null||stageId===undefined||stageId===''?null:Number(stageId);
      const normalizedGroupId=groupId===null||groupId===undefined||groupId===''?null:Number(groupId);
      if(normalizedStageId===null){if(normalizedGroupId!==null)throw new CompetitionError('Asigna primero una fase al host.','HOST_STAGE_REQUIRED');connection.prepare('UPDATE event_hosts SET assigned_stage_id=NULL,assigned_group_id=NULL WHERE event_id=? AND id=?').run(eventId,host.id);return this.getHost(eventId,host.id);}
      if(!Number.isInteger(normalizedStageId))throw new CompetitionError('El id de fase no es válido.','INVALID_STAGE_ID');
      const stage=requireStage(normalizedStageId);
      if(stage.eventId!==eventId)throw new CompetitionError('La fase no pertenece al evento.','STAGE_EVENT_MISMATCH');
      if(stage.type==='group_stage'){if(normalizedGroupId===null)throw new CompetitionError('Una fase de grupos necesita un grupo asignado.','GROUP_REQUIRED');}
      else if(normalizedGroupId!==null)throw new CompetitionError('Esta fase no admite grupo.','STAGE_GROUP_NOT_ALLOWED');
      if(normalizedGroupId!==null){if(!Number.isInteger(normalizedGroupId))throw new CompetitionError('El id de grupo no es válido.','INVALID_GROUP_ID');const group=requireGroup(normalizedGroupId);if(group.stageId!==stage.id)throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');}
      const conflict=connection.prepare('SELECT identifier FROM event_hosts WHERE event_id=? AND id<>? AND enabled=1 AND assigned_stage_id=? AND (assigned_group_id IS ? OR assigned_group_id=?)').get(eventId,host.id,stage.id,normalizedGroupId,normalizedGroupId);
      if(conflict)throw new CompetitionError(`${conflict.identifier} ya cubre esa fase y grupo. Un mismo grupo no puede tener dos hosts activos.`,'HOST_ASSIGNMENT_CONFLICT',409);
      connection.prepare('UPDATE event_hosts SET assigned_stage_id=?,assigned_group_id=? WHERE event_id=? AND id=?').run(stage.id,normalizedGroupId,eventId,host.id);
      return this.getHost(eventId,host.id);},
    listReporterRoster(eventId,stageId,groupId=null){return connection.prepare(`SELECT sp.participant_id participantId,p.display_name displayName,p.internal_friend_code internalFriendCode
      FROM stage_participants sp JOIN event_participants p ON p.id=sp.participant_id
      WHERE sp.stage_id=? AND (? IS NULL OR sp.group_id=?) AND p.event_id=? AND p.status='confirmed' AND sp.competitive_status<>'disqualified'
      ORDER BY p.display_name COLLATE NOCASE,sp.participant_id`).all(stageId,groupId,groupId,eventId);},
    listOccupiedMatchNumbers(eventId,stageId,groupId=null){return connection.prepare("SELECT DISTINCT match_number FROM matches WHERE event_id=? AND stage_id=? AND (group_id IS ? OR group_id=?) AND match_number IS NOT NULL AND match_status='VALID' ORDER BY match_number").all(eventId,stageId,groupId,groupId).map((row)=>row.match_number);},
    findHostByReporterTokenHash(eventId,tokenHash){return toHost(connection.prepare('SELECT * FROM event_hosts WHERE event_id=? AND reporter_token_hash=?').get(eventId,tokenHash));},
    setHostReporterToken(eventId,hostId,{tokenHash,createdAt}={}){if(typeof tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(tokenHash))throw new CompetitionError('El hash de credencial Reporter no es válido.','REPORTER_TOKEN_HASH_INVALID');const result=connection.prepare("UPDATE event_hosts SET reporter_token_hash=?,reporter_token_created_at=COALESCE(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')),reporter_last_seen_at=NULL WHERE event_id=? AND id=?").run(tokenHash,createdAt??null,eventId,hostId);if(!result.changes)throw new CompetitionError('El host no pertenece al evento.','HOST_EVENT_MISMATCH',404);return this.getHost(eventId,hostId);},
    revokeHostReporterToken(eventId,hostId){const result=connection.prepare('UPDATE event_hosts SET reporter_token_hash=NULL,reporter_token_created_at=NULL,reporter_last_seen_at=NULL WHERE event_id=? AND id=?').run(eventId,hostId);if(!result.changes)throw new CompetitionError('El host no pertenece al evento.','HOST_EVENT_MISMATCH',404);return this.getHost(eventId,hostId);},
    touchHostReporterToken(eventId,hostId){const result=connection.prepare("UPDATE event_hosts SET reporter_last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=? AND id=?").run(eventId,hostId);if(!result.changes)throw new CompetitionError('El host no pertenece al evento.','HOST_EVENT_MISMATCH',404);return this.getHost(eventId,hostId);},
    replaceHosts(eventId,rows){connection.transaction(()=>{const existing=this.listHosts(eventId);const suppliedIds=rows.filter((row)=>row.id!==undefined&&row.id!==null).map((row)=>Number(row.id));if(new Set(suppliedIds).size!==suppliedIds.length)throw new CompetitionError('No se puede repetir un host.','DUPLICATE_HOST');for(const id of suppliedIds){if(!existing.some((host)=>host.id===id))throw new CompetitionError('El host no pertenece al evento.','HOST_EVENT_MISMATCH');}for(const row of rows.filter((item)=>item.id!==undefined&&item.id!==null)){const current=existing.find((host)=>host.id===Number(row.id));const nextIdentifier=String(row.identifier||'').trim();if(current?.tokenConfigured&&nextIdentifier!==current.identifier)throw new CompetitionError('Revoca la configuración Reporter antes de cambiar el identificador del host.','HOST_IDENTIFIER_LOCKED',409);}for(const host of existing.filter((row)=>!suppliedIds.includes(row.id))){if(connection.prepare('SELECT COUNT(*) total FROM matches WHERE host_id=?').get(host.id).total)throw new CompetitionError(`No se puede eliminar ${host.identifier}: tiene partidas asociadas.`,'HOST_IN_USE',409);connection.prepare('DELETE FROM event_hosts WHERE id=?').run(host.id);}const insert=connection.prepare("INSERT INTO event_hosts(event_id,name,identifier,enabled,created_at) VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))");const update=connection.prepare('UPDATE event_hosts SET name=?,identifier=?,enabled=? WHERE id=? AND event_id=?');rows.forEach((row)=>{const values=[String(row.name||'').trim(),String(row.identifier||'').trim(),Number(row.enabled!==false)];if(!values[0]||!values[1])throw new CompetitionError('Cada host necesita nombre e identificador.');if(row.id!==undefined&&row.id!==null)update.run(...values,Number(row.id),eventId);else insert.run(eventId,...values);});})();return this.listHosts(eventId);},
    listSchedule(eventId){return connection.prepare('SELECT id,event_id eventId,time,title,description,position FROM event_schedule WHERE event_id=? ORDER BY position,id').all(eventId);},
    replaceSchedule(eventId,rows){replaceSimple('event_schedule',eventId,rows,'INSERT INTO event_schedule(event_id,time,title,description,position) VALUES (?,?,?,?,?)',(row,index)=>[eventId,String(row.time).trim(),String(row.title).trim(),String(row.description||'').trim(),Number(row.position??index+1)]);return this.listSchedule(eventId);},
    listPrizes(eventId,{publicOnly=false}={}){return connection.prepare(`SELECT id,event_id eventId,title,description,prize_value prizeValue,stat_key statKey,position,enabled FROM event_prizes WHERE event_id=? ${publicOnly?'AND enabled=1':''} ORDER BY position,id`).all(eventId).map((row)=>({...row,enabled:Boolean(row.enabled)}));},
    replacePrizes(eventId,rows){replaceSimple('event_prizes',eventId,rows,'INSERT INTO event_prizes(event_id,title,description,prize_value,stat_key,position,enabled) VALUES (?,?,?,?,?,?,?)',(row,index)=>[eventId,String(row.title).trim(),String(row.description||'').trim(),String(row.prizeValue||'').trim()||null,String(row.statKey||'').trim()||null,Number(row.position??index+1),Number(row.enabled!==false)]);return this.listPrizes(eventId);},
    resolveTie(stageId,input){const stage=requireStage(stageId);const groupId=input.groupId===undefined||input.groupId===null?null:Number(input.groupId);if(groupId!==null&&requireGroup(groupId).stageId!==stage.id)throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');const higher=Number(input.higherParticipantId),lower=Number(input.lowerParticipantId);if(!Number.isInteger(higher)||!Number.isInteger(lower)||higher===lower)throw new CompetitionError('El desempate necesita dos participantes distintos.');const reason=String(input.reason||'').trim();if(!reason)throw new CompetitionError('El desempate necesita un motivo auditable.','TIE_REASON_REQUIRED');const memberships=connection.prepare('SELECT participant_id participantId,group_id groupId,competitive_status competitiveStatus FROM stage_participants WHERE stage_id=? AND participant_id IN (?,?)').all(stage.id,higher,lower);if(memberships.length!==2||memberships.some((row)=>row.competitiveStatus==='disqualified'||(groupId!==null&&row.groupId!==groupId)))throw new CompetitionError('Los jugadores no pertenecen al ámbito del desempate.','TIE_PARTICIPANT_SCOPE',409);const board=getStageLeaderboard(stage.id,groupId);const higherRow=board.standings.find((row)=>row.participantId===higher),lowerRow=board.standings.find((row)=>row.participantId===lower);if(!higherRow||!lowerRow||automaticCompare(higherRow,lowerRow)!==0)throw new CompetitionError('Sólo se pueden resolver jugadores empatados en todos los criterios.','PLAYERS_NOT_TIED',409);const resolutions=this.listTieResolutions(stage.id).filter((row)=>row.groupId===groupId);const existing=resolutions.find((row)=>row.higherParticipantId===higher&&row.lowerParticipantId===lower);if(!existing&&resolutionPath(lower,higher,resolutions))throw new CompetitionError('La resolución crearía un ciclo contradictorio.','TIE_RESOLUTION_CYCLE',409);if(existing)connection.prepare("UPDATE tie_resolutions SET reason=?,resolved_by='ADMIN',created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(reason,existing.id);else connection.prepare(`INSERT INTO tie_resolutions(event_id,stage_id,group_id,higher_participant_id,lower_participant_id,reason,resolved_by) VALUES (?,?,?,?,?,?,?)`).run(stage.eventId,stage.id,groupId,higher,lower,reason,'ADMIN');return this.listTieResolutions(stageId);},
    listTieResolutions(stageId){return connection.prepare('SELECT id,event_id eventId,stage_id stageId,group_id groupId,higher_participant_id higherParticipantId,lower_participant_id lowerParticipantId,reason,resolved_by resolvedBy,created_at createdAt FROM tie_resolutions WHERE stage_id=? ORDER BY id').all(stageId);},
    completeStage(stageId,{force=false}={}){return completeTransaction(stageId,force);},
    validateContext(eventId,context={}){const stage=context.stageId?requireStage(Number(context.stageId)):null;if(stage&&stage.eventId!==eventId)throw new CompetitionError('La fase no pertenece al evento.','STAGE_EVENT_MISMATCH');const group=context.groupId?requireGroup(Number(context.groupId)):null;if(group&&(!stage||group.stageId!==stage.id))throw new CompetitionError('El grupo no pertenece a la fase.','GROUP_STAGE_MISMATCH');const host=context.hostId?this.getHost(eventId,/^\d+$/.test(String(context.hostId))?Number(context.hostId):String(context.hostId)):null;if(context.hostId&&(!host||!host.enabled))throw new CompetitionError('El host no pertenece al evento o está deshabilitado.','HOST_EVENT_MISMATCH');return {stage,group,host};},
    findValidMatchBySlot(eventId,stageId,groupId,matchNumber){const row=connection.prepare("SELECT id,payload_json FROM matches WHERE event_id=? AND stage_id=? AND (group_id IS ? OR group_id=?) AND match_number=? AND match_status='VALID' LIMIT 1").get(eventId,stageId,groupId,groupId,matchNumber);if(!row)return null;return {id:row.id,reportId:JSON.parse(row.payload_json).reportId||null};},
    resolveReportPlayerIdentities(eventId,players){if(!Array.isArray(players))throw new CompetitionError('El resultado necesita jugadores.','REPORT_PLAYERS_REQUIRED');return players.map((player)=>{let participantId=Number(player.participantId);let participant=Number.isInteger(participantId)&&participantId>0?connection.prepare('SELECT * FROM event_participants WHERE id=? AND event_id=?').get(participantId,eventId):null;if(!participant&&player.friendCode)participant=connection.prepare('SELECT * FROM event_participants WHERE event_id=? AND internal_friend_code=?').get(eventId,String(player.friendCode).trim());if(!participant)throw new CompetitionError('No se ha podido vincular un jugador con su inscripción.','PLAYER_NOT_LINKED',409);const copy={...player,participantId:participant.id,name:participant.display_name};delete copy.friendCode;return copy;});},
    resolveReportPlayers(eventId,stageId,groupId,players){if(!Array.isArray(players)||players.length<1)throw new CompetitionError('El resultado necesita jugadores.','REPORT_PLAYERS_REQUIRED');return players.map((player)=>{let participantId=Number(player.participantId);let participant=Number.isInteger(participantId)&&participantId>0?connection.prepare('SELECT * FROM event_participants WHERE id=? AND event_id=?').get(participantId,eventId):null;if(!participant&&player.friendCode)participant=connection.prepare('SELECT * FROM event_participants WHERE event_id=? AND internal_friend_code=?').get(eventId,String(player.friendCode).trim());if(!participant)throw new CompetitionError('No se ha podido vincular un jugador con su inscripción.','PLAYER_NOT_LINKED',409);const membership=connection.prepare('SELECT * FROM stage_participants WHERE stage_id=? AND participant_id=?').get(stageId,participant.id);if(participant.status==='disqualified'||membership?.competitive_status==='disqualified')throw new CompetitionError(`${participant.display_name} está descalificado.`,'PLAYER_DISQUALIFIED',409);if(participant.status!=='confirmed'||!membership||(groupId!==null&&membership.group_id!==groupId))throw new CompetitionError(`${participant.display_name} no pertenece a esta fase o grupo.`,'PLAYER_SCOPE_MISMATCH',409);const copy={...player,participantId:participant.id,name:participant.display_name};delete copy.friendCode;return copy;});}
  };
}

module.exports = { createCompetitionStore, migrateCompetition };
