PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      reason TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (1,2,'admin','RIOT_ID_UPDATED','participant:1','fixture legacy','{"previous":null,"riotId":"Vega#000"}','2026-08-26T16:15:41.919Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (2,2,'admin','RIOT_ID_UPDATED','participant:2','fixture legacy','{"previous":null,"riotId":"Duna#001"}','2026-08-26T16:15:41.919Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (3,2,'admin','RIOT_ID_UPDATED','participant:3','fixture legacy','{"previous":null,"riotId":"Sirena#002"}','2026-08-26T16:15:41.919Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (4,2,'admin','RIOT_ID_UPDATED','participant:4','fixture legacy','{"previous":null,"riotId":"Lobo#003"}','2026-08-26T16:15:41.920Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (5,2,'admin','RIOT_ID_UPDATED','participant:5','fixture legacy','{"previous":null,"riotId":"Cierzo#004"}','2026-08-26T16:15:41.920Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (6,2,'admin','RIOT_ID_UPDATED','participant:6','fixture legacy','{"previous":null,"riotId":"Trueno#005"}','2026-08-26T16:15:41.921Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (7,2,'admin','RIOT_ID_UPDATED','participant:7','fixture legacy','{"previous":null,"riotId":"Ambar#006"}','2026-08-26T16:15:41.921Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (8,2,'admin','RIOT_ID_UPDATED','participant:8','fixture legacy','{"previous":null,"riotId":"Zorro#007"}','2026-08-26T16:15:41.922Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (9,2,'admin','RIOT_ID_UPDATED','participant:9','fixture legacy','{"previous":null,"riotId":"Marea#008"}','2026-08-26T16:15:41.922Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (10,2,'admin','RIOT_ID_UPDATED','participant:10','fixture legacy','{"previous":null,"riotId":"Quilla#009"}','2026-08-26T16:15:41.922Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (11,2,'admin','RIOT_ID_UPDATED','participant:11','fixture legacy','{"previous":null,"riotId":"Brisa#010"}','2026-08-26T16:15:41.923Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (12,2,'admin','RIOT_ID_UPDATED','participant:12','fixture legacy','{"previous":null,"riotId":"Norte#011"}','2026-08-26T16:15:41.923Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (13,2,'admin','RIOT_ID_UPDATED','participant:13','fixture legacy','{"previous":null,"riotId":"Faro#012"}','2026-08-26T16:15:41.924Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (14,2,'admin','RIOT_ID_UPDATED','participant:14','fixture legacy','{"previous":null,"riotId":"Ancla#013"}','2026-08-26T16:15:41.924Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (15,2,'admin','RIOT_ID_UPDATED','participant:15','fixture legacy','{"previous":null,"riotId":"Rada#014"}','2026-08-26T16:15:41.924Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (16,2,'admin','RIOT_ID_UPDATED','participant:16','fixture legacy','{"previous":null,"riotId":"Delta#015"}','2026-08-26T16:15:41.925Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (17,2,'admin','RIOT_ID_UPDATED','participant:17','fixture legacy','{"previous":null,"riotId":"Coral#016"}','2026-08-26T16:15:41.925Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (18,2,'admin','RIOT_ID_UPDATED','participant:18','fixture legacy','{"previous":null,"riotId":"Nieve#017"}','2026-08-26T16:15:41.925Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (19,2,'admin','RIOT_ID_UPDATED','participant:19','fixture legacy','{"previous":null,"riotId":"Rayo#018"}','2026-08-26T16:15:41.925Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (20,2,'admin','RIOT_ID_UPDATED','participant:20','fixture legacy','{"previous":null,"riotId":"Barro#019"}','2026-08-26T16:15:41.927Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (21,2,'admin','DRAFT_CONFIGURED','draft:1',NULL,'{"captains":[1,2,3,4],"teamCount":4,"teamSize":5}','2026-08-26T16:15:41.928Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (22,2,'admin','DRAFT_STARTED','draft:1',NULL,'{"picks":16}','2026-08-26T16:15:41.929Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (23,2,'admin','TEAM_RENAMED','team:1',NULL,'{"anterior":"Equipo de Vega","nuevo":"Los Filtradores"}','2026-08-26T16:15:41.937Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (24,2,'admin','TEAM_RENAMED','team:2',NULL,'{"anterior":"Equipo de Duna","nuevo":"Chorizo Power"}','2026-08-26T16:15:41.937Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (25,2,'admin','TEAM_RENAMED','team:3',NULL,'{"anterior":"Equipo de Sirena","nuevo":"Marea Roja"}','2026-08-26T16:15:41.937Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (26,2,'admin','TEAM_RENAMED','team:4',NULL,'{"anterior":"Equipo de Lobo","nuevo":"Cierzo FC"}','2026-08-26T16:15:41.938Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (27,2,'fixture-legacy','COMPETITION_SETTINGS_UPDATED',NULL,NULL,'{"tiebreakers":["wins","round_diff","rounds_for"]}','2026-08-26T16:15:41.938Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (28,2,'admin','MAP_POOL_UPDATED',NULL,NULL,'{"enabled":["ascent","bind","haven","lotus","split"]}','2026-08-26T16:15:41.939Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (29,2,'admin','REGULAR_SEASON_GENERATED',NULL,NULL,'{"teams":4,"teamCount":4,"matchdays":3,"matchesPerMatchday":2,"totalMatches":6,"matchesPerTeam":3,"hasByes":false}','2026-08-26T16:15:41.940Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (30,2,'admin','MAP_ASSIGNED','series:1',NULL,'{"gameNumber":1,"mapKey":"bind"}','2026-08-26T16:15:41.941Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (31,2,'admin','MAP_ASSIGNED','series:2',NULL,'{"gameNumber":1,"mapKey":"ascent"}','2026-08-26T16:15:41.941Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (32,2,'admin','MAP_ASSIGNED','series:3',NULL,'{"gameNumber":1,"mapKey":"haven"}','2026-08-26T16:15:41.941Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (33,2,'admin','MAP_ASSIGNED','series:4',NULL,'{"gameNumber":1,"mapKey":"lotus"}','2026-08-26T16:15:41.941Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (34,2,'admin','MAP_ASSIGNED','series:5',NULL,'{"gameNumber":1,"mapKey":"split"}','2026-08-26T16:15:41.941Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (35,2,'admin','MAP_ASSIGNED','series:6',NULL,'{"gameNumber":1,"mapKey":"bind"}','2026-08-26T16:15:41.943Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (36,2,'admin','RESULT_RECORDED','series:1',NULL,'{"gameNumber":1,"teamARounds":13,"teamBRounds":10,"source":"SCREENSHOT","winnerTeamId":1,"overtime":false}','2026-08-26T16:15:41.945Z');
INSERT INTO "admin_audit" ("id","event_id","actor","action","target","reason","details_json","created_at") VALUES (37,2,'admin','RESULT_RECORDED','series:2','sin capturas disponibles','{"gameNumber":1,"teamARounds":8,"teamBRounds":13,"source":"MANUAL","winnerTeamId":3,"overtime":false}','2026-08-26T16:15:41.945Z');
CREATE TABLE app_settings (
        setting_key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL CHECK (json_valid(value_json))
      );
INSERT INTO "app_settings" ("setting_key","value_json") VALUES ('default_event_id','1');
INSERT INTO "app_settings" ("setting_key","value_json") VALUES ('friend_code_field_v1','true');
INSERT INTO "app_settings" ("setting_key","value_json") VALUES ('discord_sessions_hashed_v1','true');
CREATE TABLE discord_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
CREATE TABLE discord_sessions (
      id TEXT PRIMARY KEY,
      discord_account_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY(discord_account_id) REFERENCES discord_accounts(id) ON DELETE CASCADE
    );
CREATE TABLE draft_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER NOT NULL,
      pick_number INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      captain_participant_id INTEGER NOT NULL,
      selected_participant_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(draft_id, pick_number),
      UNIQUE(draft_id, selected_participant_id),
      FOREIGN KEY(draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(selected_participant_id) REFERENCES event_participants(id) ON DELETE CASCADE
    );
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (1,1,1,1,1,1,5,'2026-08-26T16:15:41.929Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (2,1,2,1,2,2,6,'2026-08-26T16:15:41.930Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (3,1,3,1,3,3,7,'2026-08-26T16:15:41.931Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (4,1,4,1,4,4,8,'2026-08-26T16:15:41.931Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (5,1,5,2,4,4,9,'2026-08-26T16:15:41.931Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (6,1,6,2,3,3,10,'2026-08-26T16:15:41.932Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (7,1,7,2,2,2,11,'2026-08-26T16:15:41.932Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (8,1,8,2,1,1,12,'2026-08-26T16:15:41.933Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (9,1,9,3,1,1,13,'2026-08-26T16:15:41.933Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (10,1,10,3,2,2,14,'2026-08-26T16:15:41.934Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (11,1,11,3,3,3,15,'2026-08-26T16:15:41.934Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (12,1,12,3,4,4,16,'2026-08-26T16:15:41.935Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (13,1,13,4,4,4,17,'2026-08-26T16:15:41.935Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (14,1,14,4,3,3,18,'2026-08-26T16:15:41.935Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (15,1,15,4,2,2,19,'2026-08-26T16:15:41.936Z');
INSERT INTO "draft_picks" ("id","draft_id","pick_number","round_number","team_id","captain_participant_id","selected_participant_id","created_at") VALUES (16,1,16,4,1,1,20,'2026-08-26T16:15:41.936Z');
CREATE TABLE drafts (
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
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(current_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );
INSERT INTO "drafts" ("id","event_id","status","team_count","team_size","current_pick","current_round","direction","current_team_id","started_at","completed_at","created_at","updated_at") VALUES (1,2,'COMPLETED',4,5,17,4,-1,NULL,'2026-08-26T16:15:41.929Z','2026-08-26T16:15:41.936Z','2026-08-26T16:15:41.928Z','2026-08-26T16:15:41.936Z');
CREATE TABLE event_groups (
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
INSERT INTO "event_groups" ("id","event_id","stage_id","name","position") VALUES (1,1,1,'Grupo A',1);
INSERT INTO "event_groups" ("id","event_id","stage_id","name","position") VALUES (2,1,1,'Grupo B',2);
CREATE TABLE event_hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        identifier TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        reporter_token_hash TEXT CHECK (
  reporter_token_hash IS NULL OR (
    length(reporter_token_hash) = 64
    AND reporter_token_hash NOT GLOB '*[^0-9a-f]*'
  )
),
        reporter_token_created_at TEXT,
        reporter_last_seen_at TEXT,
        assigned_stage_id INTEGER,
        assigned_group_id INTEGER,
        UNIQUE(event_id, identifier),
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
INSERT INTO "event_hosts" ("id","event_id","name","identifier","enabled","created_at","reporter_token_hash","reporter_token_created_at","reporter_last_seen_at","assigned_stage_id","assigned_group_id") VALUES (1,1,'Host Grupo A','HOST_1',1,'2026-08-26T16:15:41.907Z',NULL,NULL,NULL,NULL,NULL);
INSERT INTO "event_hosts" ("id","event_id","name","identifier","enabled","created_at","reporter_token_hash","reporter_token_created_at","reporter_last_seen_at","assigned_stage_id","assigned_group_id") VALUES (2,1,'Host Grupo B','HOST_2',1,'2026-08-26T16:15:41.907Z',NULL,NULL,NULL,NULL,NULL);
CREATE TABLE event_information (
        event_id INTEGER PRIMARY KEY,
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
INSERT INTO "event_information" ("event_id","content_json","updated_at") VALUES (1,'{"general":{"intro":"El Torneo de Among Us de Jartiland es una competición individual entre miembros de la comunidad. Aunque Among Us se juega por equipos, cada participante acumula sus propios puntos según los resultados y acciones de cada partida. Los resultados se registran automáticamente para construir la clasificación general.","date":"","time":"","participantCount":null,"status":"Próximamente","phase":"Preparación"},"format":{"groupsEnabled":false,"classification":"Los participantes disputarán varias partidas y acumularán puntos individualmente. Si el número de inscripciones lo requiere, se repartirán en grupos equilibrados. Los jugadores con mayor puntuación pasarán a la Gran Final.","final":"Los jugadores clasificados disputarán una última serie de partidas. La clasificación de esta fase determinará al campeón del torneo."},"rules":["Está prohibido compartir información obtenida después de morir con jugadores que sigan vivos.","Está prohibido mirar streams, pantallas o información de otros participantes.","Está prohibido utilizar mods, herramientas o programas que proporcionen información o ventajas no autorizadas.","Los jugadores deben respetar las reglas normales de comunicación establecidas para las partidas.","No se permite colaborar intencionadamente con un equipo contrario para perjudicar la partida.","Está prohibido abandonar deliberadamente una partida para manipular resultados.","En caso de desconexión o fallo técnico importante, la organización decidirá si la partida continúa, se repite o se anula.","Las decisiones de la organización sobre partidas anuladas, bugs o situaciones excepcionales serán definitivas.","Cualquier intento de manipular la clasificación o los resultados podrá provocar la descalificación.","Se espera un comportamiento razonable y respetuoso hacia el resto de participantes."],"tiebreakers":["Mayor número de puntos.","Mayor número de victorias.","Mayor número de victorias como impostor.","Mayor número de kills válidas.","Si continúa el empate, se aplicará una partida o criterio decidido por la organización."],"faqs":[{"question":"¿Tengo que instalar algún mod?","answer":"No. El sistema del torneo se ejecutará desde el host. Los participantes podrán jugar normalmente salvo que la organización indique lo contrario."},{"question":"¿Las puntuaciones se apuntan manualmente?","answer":"No. El sistema está diseñado para registrar automáticamente los datos de cada partida y calcular la clasificación."},{"question":"¿Si muero el primero pierdo todos los puntos?","answer":"No. Puedes seguir obteniendo los puntos correspondientes a la victoria del equipo y completar tus tareas como fantasma."},{"question":"¿Sobrevivir da puntos?","answer":"No. La supervivencia puede mostrarse como estadística, pero no aporta puntos directamente."},{"question":"¿Los votos correctos dan puntos?","answer":"No. Podrán registrarse como estadística, pero inicialmente no forman parte de la puntuación."},{"question":"¿Puedo cambiar mi nombre de Among Us?","answer":"Sí. El sistema puede identificar internamente a cada participante aunque haya pequeños cambios de nombre."}]}','2026-08-26T16:15:41.900Z');
INSERT INTO "event_information" ("event_id","content_json","updated_at") VALUES (2,'{"general":{"intro":"Este evento de Valorant forma parte de Mini Eventos Jartiland. Aquí se publicarán el formato, los horarios y las indicaciones necesarias para participar.","date":"","time":"","participantCount":null,"status":"Próximamente","phase":"Preparación"},"format":{"groupsEnabled":false,"classification":"La organización publicará el formato definitivo antes del inicio del evento.","final":"Si existe una fase final, sus participantes y condiciones se anunciarán en esta página."},"rules":["Respeta al resto de participantes y las indicaciones de la organización.","No se permite utilizar herramientas o ventajas no autorizadas.","Cualquier intento de manipular resultados puede provocar la descalificación."],"tiebreakers":["Se aplicarán los criterios publicados por la organización para este evento."],"faqs":[{"question":"¿Dónde se anunciarán los detalles?","answer":"La información confirmada se actualizará en esta página y en los canales de la comunidad."}]}','2026-08-26T16:15:41.917Z');
CREATE TABLE "event_participants" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      discord_username TEXT NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      field_values_json TEXT NOT NULL CHECK (json_valid(field_values_json)),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','absent','disqualified')),
      internal_friend_code TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), discord_account_id INTEGER REFERENCES discord_accounts(id) ON DELETE SET NULL, riot_game_name TEXT, riot_tag_line TEXT, riot_id_normalized TEXT, riot_puuid TEXT,
      UNIQUE (event_id, discord_username),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (1,2,'vega#discord','Vega','{"discord_username":"vega#discord","game_name":"Vega","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.918Z','2026-08-26T16:15:41.918Z',NULL,'Vega','000','vega#000',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (2,2,'duna#discord','Duna','{"discord_username":"duna#discord","game_name":"Duna","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.919Z','2026-08-26T16:15:41.919Z',NULL,'Duna','001','duna#001',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (3,2,'sirena#discord','Sirena','{"discord_username":"sirena#discord","game_name":"Sirena","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.919Z','2026-08-26T16:15:41.919Z',NULL,'Sirena','002','sirena#002',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (4,2,'lobo#discord','Lobo','{"discord_username":"lobo#discord","game_name":"Lobo","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.920Z','2026-08-26T16:15:41.920Z',NULL,'Lobo','003','lobo#003',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (5,2,'cierzo#discord','Cierzo','{"discord_username":"cierzo#discord","game_name":"Cierzo","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.920Z','2026-08-26T16:15:41.920Z',NULL,'Cierzo','004','cierzo#004',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (6,2,'trueno#discord','Trueno','{"discord_username":"trueno#discord","game_name":"Trueno","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.920Z','2026-08-26T16:15:41.920Z',NULL,'Trueno','005','trueno#005',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (7,2,'ambar#discord','Ambar','{"discord_username":"ambar#discord","game_name":"Ambar","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.921Z','2026-08-26T16:15:41.921Z',NULL,'Ambar','006','ambar#006',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (8,2,'zorro#discord','Zorro','{"discord_username":"zorro#discord","game_name":"Zorro","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.921Z','2026-08-26T16:15:41.921Z',NULL,'Zorro','007','zorro#007',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (9,2,'marea#discord','Marea','{"discord_username":"marea#discord","game_name":"Marea","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.922Z','2026-08-26T16:15:41.922Z',NULL,'Marea','008','marea#008',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (10,2,'quilla#discord','Quilla','{"discord_username":"quilla#discord","game_name":"Quilla","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.922Z','2026-08-26T16:15:41.922Z',NULL,'Quilla','009','quilla#009',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (11,2,'brisa#discord','Brisa','{"discord_username":"brisa#discord","game_name":"Brisa","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.923Z','2026-08-26T16:15:41.923Z',NULL,'Brisa','010','brisa#010',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (12,2,'norte#discord','Norte','{"discord_username":"norte#discord","game_name":"Norte","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.923Z','2026-08-26T16:15:41.923Z',NULL,'Norte','011','norte#011',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (13,2,'faro#discord','Faro','{"discord_username":"faro#discord","game_name":"Faro","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.923Z','2026-08-26T16:15:41.923Z',NULL,'Faro','012','faro#012',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (14,2,'ancla#discord','Ancla','{"discord_username":"ancla#discord","game_name":"Ancla","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.924Z','2026-08-26T16:15:41.924Z',NULL,'Ancla','013','ancla#013',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (15,2,'rada#discord','Rada','{"discord_username":"rada#discord","game_name":"Rada","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.924Z','2026-08-26T16:15:41.924Z',NULL,'Rada','014','rada#014',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (16,2,'delta#discord','Delta','{"discord_username":"delta#discord","game_name":"Delta","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.925Z','2026-08-26T16:15:41.925Z',NULL,'Delta','015','delta#015',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (17,2,'coral#discord','Coral','{"discord_username":"coral#discord","game_name":"Coral","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.925Z','2026-08-26T16:15:41.925Z',NULL,'Coral','016','coral#016',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (18,2,'nieve#discord','Nieve','{"discord_username":"nieve#discord","game_name":"Nieve","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.925Z','2026-08-26T16:15:41.925Z',NULL,'Nieve','017','nieve#017',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (19,2,'rayo#discord','Rayo','{"discord_username":"rayo#discord","game_name":"Rayo","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.925Z','2026-08-26T16:15:41.925Z',NULL,'Rayo','018','rayo#018',NULL);
INSERT INTO "event_participants" ("id","event_id","discord_username","display_name","field_values_json","status","internal_friend_code","created_at","updated_at","discord_account_id","riot_game_name","riot_tag_line","riot_id_normalized","riot_puuid") VALUES (20,2,'barro#discord','Barro','{"discord_username":"barro#discord","game_name":"Barro","same_as_discord":false}','confirmed',NULL,'2026-08-26T16:15:41.927Z','2026-08-26T16:15:41.927Z',NULL,'Barro','019','barro#019',NULL);
CREATE TABLE event_prizes (
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
INSERT INTO "event_prizes" ("id","event_id","title","description","prize_value","stat_key","position","enabled") VALUES (1,1,'1.º puesto','Campeón del torneo','50 Jartis + rol especial',NULL,1,1);
INSERT INTO "event_prizes" ("id","event_id","title","description","prize_value","stat_key","position","enabled") VALUES (2,1,'2.º puesto','Subcampeón del torneo','Premio por confirmar',NULL,2,1);
INSERT INTO "event_prizes" ("id","event_id","title","description","prize_value","stat_key","position","enabled") VALUES (3,1,'3.º puesto','Tercer clasificado','Premio por confirmar',NULL,3,1);
INSERT INTO "event_prizes" ("id","event_id","title","description","prize_value","stat_key","position","enabled") VALUES (4,1,'Mayor número de kills','Premio estadístico','Reconocimiento especial','kills',4,1);
CREATE TABLE event_registration_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        field_key TEXT NOT NULL,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK (field_type IN ('text', 'select', 'checkbox')),
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
        placeholder TEXT NOT NULL DEFAULT '',
        options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
        position INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        UNIQUE (event_id, field_key),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (1,1,'discord_username','Usuario de Discord','text',1,'Tu usuario de Discord','[]',1,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (2,1,'game_name','Nombre en Among Us','text',1,'El nombre que usarás en la partida','[]',2,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (3,1,'friend_code','Friend Code de Among Us (tu @ fijo)','text',1,'Cuenta > Friend Code. No es tu nombre en la partida. Ejemplo: jugador#1234','[]',3,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (4,1,'same_as_discord','Mi nombre de Among Us es el mismo que mi usuario de Discord','checkbox',0,'','[]',4,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (6,2,'discord_username','Usuario de Discord','text',1,'Tu usuario de Discord','[]',1,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (7,2,'game_name','Nombre en Valorant','text',1,'Tu nombre en Valorant','[]',2,1);
INSERT INTO "event_registration_fields" ("id","event_id","field_key","label","field_type","required","placeholder","options_json","position","enabled") VALUES (8,2,'same_as_discord','Mi nombre de Among Us es el mismo que mi usuario de Discord','checkbox',0,'','[]',4,1);
CREATE TABLE event_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        time TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
INSERT INTO "event_schedule" ("id","event_id","time","title","description","position") VALUES (1,1,'16:00','Inicio del torneo','Bienvenida y preparación de lobbies',1);
INSERT INTO "event_schedule" ("id","event_id","time","title","description","position") VALUES (2,1,'16:10','Fase de clasificación','Inicio simultáneo de Grupo A y Grupo B',2);
INSERT INTO "event_schedule" ("id","event_id","time","title","description","position") VALUES (3,1,'17:45','Publicación de finalistas','Confirmación del top de cada grupo',3);
INSERT INTO "event_schedule" ("id","event_id","time","title","description","position") VALUES (4,1,'18:00','Gran Final','Cinco partidas con puntos reiniciados',4);
INSERT INTO "event_schedule" ("id","event_id","time","title","description","position") VALUES (5,1,'19:30','Entrega de premios','Cierre del torneo',5);
CREATE TABLE event_stages (
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
INSERT INTO "event_stages" ("id","event_id","name","type","position","status","matches_per_group","qualifiers_per_group","reset_points","groups_locked","enabled","completed_at") VALUES (1,1,'Fase de Clasificación','group_stage',1,'pending',5,5,1,0,1,NULL);
INSERT INTO "event_stages" ("id","event_id","name","type","position","status","matches_per_group","qualifiers_per_group","reset_points","groups_locked","enabled","completed_at") VALUES (2,1,'Gran Final','final',2,'pending',5,0,1,0,1,NULL);
CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        game TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        starts_at TEXT,
        registration_opens_at TEXT,
        registration_closes_at TEXT,
        min_participants INTEGER CHECK (min_participants IS NULL OR min_participants > 0),
        max_participants INTEGER CHECK (max_participants IS NULL OR max_participants > 0),
        registrations_open INTEGER NOT NULL DEFAULT 0 CHECK (registrations_open IN (0, 1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        modules_json TEXT NOT NULL CHECK (json_valid(modules_json)),
        accent_color TEXT NOT NULL DEFAULT '#d7ff3f',
        icon TEXT NOT NULL DEFAULT 'gamepad',
        cover_image TEXT NOT NULL DEFAULT '/images/events/default-event-cover.png',
        banner_image TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
INSERT INTO "events" ("id","slug","name","game","description","status","starts_at","registration_opens_at","registration_closes_at","min_participants","max_participants","registrations_open","archived","modules_json","accent_color","icon","cover_image","banner_image","created_at","updated_at") VALUES (1,'among-us-agosto-2026','Torneo Among Us','Among Us','Engaños, tareas y deducción social en el primer Mini Evento de Jartiland.','Próximamente',NULL,NULL,NULL,20,NULL,1,0,'{"information":true,"participants":true,"leaderboard":true,"matches":true,"registration":true,"competition":1,"schedule":1,"prizes":1,"draft":false}','#d7ff3f','crewmate','/images/events/among-us-cover.jpg','/images/events/among-us-banner.jpg','2026-08-26T16:15:41.902Z','2026-08-26T16:15:41.902Z');
INSERT INTO "events" ("id","slug","name","game","description","status","starts_at","registration_opens_at","registration_closes_at","min_participants","max_participants","registrations_open","archived","modules_json","accent_color","icon","cover_image","banner_image","created_at","updated_at") VALUES (2,'torneo-legacy','Torneo Valorant · Legacy','Valorant','Base anterior a las eliminatorias.','Inscripciones abiertas',NULL,NULL,NULL,20,NULL,1,0,'{"information":true,"participants":true,"leaderboard":true,"matches":true,"registration":true,"competition":true,"schedule":true,"prizes":true,"draft":true}','#ff4655','crosshair','/images/events/default-event-cover.png',NULL,'2026-08-26T16:15:41.917Z','2026-08-26T16:15:41.917Z');
CREATE TABLE match_report_ids (
        event_id INTEGER NOT NULL,
        report_id TEXT NOT NULL,
        match_id INTEGER NOT NULL UNIQUE,
        PRIMARY KEY (event_id, report_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
      );
CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      source_ip TEXT,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      report_fingerprint TEXT CHECK (report_fingerprint IS NULL OR (length(report_fingerprint)=64 AND report_fingerprint NOT GLOB '*[^0-9a-f]*'))
    , event_id INTEGER, stage_id INTEGER, group_id INTEGER, host_id INTEGER, match_number INTEGER, played_at TEXT, match_status TEXT NOT NULL DEFAULT 'VALID', void_reason TEXT, origin TEXT NOT NULL DEFAULT 'REPORTER', submitted_by TEXT);
CREATE TABLE oauth_states (
      state TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL,
      redirect_to TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
CREATE TABLE stage_participants (
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
CREATE TABLE team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('captain','player')),
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(event_id, participant_id),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES event_participants(id) ON DELETE CASCADE
    );
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (1,1,2,1,'captain','2026-08-26T16:15:41.928Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (2,2,2,2,'captain','2026-08-26T16:15:41.928Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (3,3,2,3,'captain','2026-08-26T16:15:41.928Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (4,4,2,4,'captain','2026-08-26T16:15:41.928Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (5,1,2,5,'player','2026-08-26T16:15:41.929Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (6,2,2,6,'player','2026-08-26T16:15:41.930Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (7,3,2,7,'player','2026-08-26T16:15:41.931Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (8,4,2,8,'player','2026-08-26T16:15:41.931Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (9,4,2,9,'player','2026-08-26T16:15:41.931Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (10,3,2,10,'player','2026-08-26T16:15:41.932Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (11,2,2,11,'player','2026-08-26T16:15:41.932Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (12,1,2,12,'player','2026-08-26T16:15:41.933Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (13,1,2,13,'player','2026-08-26T16:15:41.933Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (14,2,2,14,'player','2026-08-26T16:15:41.934Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (15,3,2,15,'player','2026-08-26T16:15:41.934Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (16,4,2,16,'player','2026-08-26T16:15:41.935Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (17,4,2,17,'player','2026-08-26T16:15:41.935Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (18,3,2,18,'player','2026-08-26T16:15:41.936Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (19,2,2,19,'player','2026-08-26T16:15:41.936Z');
INSERT INTO "team_members" ("id","team_id","event_id","participant_id","role","joined_at") VALUES (20,1,2,20,'player','2026-08-26T16:15:41.936Z');
CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      captain_participant_id INTEGER,
      seed INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(event_id, name),
      UNIQUE(event_id, seed),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(captain_participant_id) REFERENCES event_participants(id) ON DELETE SET NULL
    );
INSERT INTO "teams" ("id","event_id","name","captain_participant_id","seed","status","created_at","updated_at") VALUES (1,2,'Los Filtradores',1,1,'active','2026-08-26T16:15:41.928Z','2026-08-26T16:15:41.937Z');
INSERT INTO "teams" ("id","event_id","name","captain_participant_id","seed","status","created_at","updated_at") VALUES (2,2,'Chorizo Power',2,2,'active','2026-08-26T16:15:41.928Z','2026-08-26T16:15:41.937Z');
INSERT INTO "teams" ("id","event_id","name","captain_participant_id","seed","status","created_at","updated_at") VALUES (3,2,'Marea Roja',3,3,'active','2026-08-26T16:15:41.928Z','2026-08-26T16:15:41.937Z');
INSERT INTO "teams" ("id","event_id","name","captain_participant_id","seed","status","created_at","updated_at") VALUES (4,2,'Cierzo FC',4,4,'active','2026-08-26T16:15:41.928Z','2026-08-26T16:15:41.937Z');
CREATE TABLE tie_resolutions (
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
CREATE TABLE tournament_information (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
INSERT INTO "tournament_information" ("id","content_json","updated_at") VALUES (1,'{"general":{"intro":"El Torneo de Among Us de Jartiland es una competición individual entre miembros de la comunidad. Aunque Among Us se juega por equipos, cada participante acumula sus propios puntos según los resultados y acciones de cada partida. Los resultados se registran automáticamente para construir la clasificación general.","date":"","time":"","participantCount":null,"status":"Próximamente","phase":"Preparación"},"format":{"groupsEnabled":false,"classification":"Los participantes disputarán varias partidas y acumularán puntos individualmente. Si el número de inscripciones lo requiere, se repartirán en grupos equilibrados. Los jugadores con mayor puntuación pasarán a la Gran Final.","final":"Los jugadores clasificados disputarán una última serie de partidas. La clasificación de esta fase determinará al campeón del torneo."},"rules":["Está prohibido compartir información obtenida después de morir con jugadores que sigan vivos.","Está prohibido mirar streams, pantallas o información de otros participantes.","Está prohibido utilizar mods, herramientas o programas que proporcionen información o ventajas no autorizadas.","Los jugadores deben respetar las reglas normales de comunicación establecidas para las partidas.","No se permite colaborar intencionadamente con un equipo contrario para perjudicar la partida.","Está prohibido abandonar deliberadamente una partida para manipular resultados.","En caso de desconexión o fallo técnico importante, la organización decidirá si la partida continúa, se repite o se anula.","Las decisiones de la organización sobre partidas anuladas, bugs o situaciones excepcionales serán definitivas.","Cualquier intento de manipular la clasificación o los resultados podrá provocar la descalificación.","Se espera un comportamiento razonable y respetuoso hacia el resto de participantes."],"tiebreakers":["Mayor número de puntos.","Mayor número de victorias.","Mayor número de victorias como impostor.","Mayor número de kills válidas.","Si continúa el empate, se aplicará una partida o criterio decidido por la organización."],"faqs":[{"question":"¿Tengo que instalar algún mod?","answer":"No. El sistema del torneo se ejecutará desde el host. Los participantes podrán jugar normalmente salvo que la organización indique lo contrario."},{"question":"¿Las puntuaciones se apuntan manualmente?","answer":"No. El sistema está diseñado para registrar automáticamente los datos de cada partida y calcular la clasificación."},{"question":"¿Si muero el primero pierdo todos los puntos?","answer":"No. Puedes seguir obteniendo los puntos correspondientes a la victoria del equipo y completar tus tareas como fantasma."},{"question":"¿Sobrevivir da puntos?","answer":"No. La supervivencia puede mostrarse como estadística, pero no aporta puntos directamente."},{"question":"¿Los votos correctos dan puntos?","answer":"No. Podrán registrarse como estadística, pero inicialmente no forman parte de la puntuación."},{"question":"¿Puedo cambiar mi nombre de Among Us?","answer":"Sí. El sistema puede identificar internamente a cada participante aunque haya pequeños cambios de nombre."}]}','2026-08-26T16:15:41.900Z');
CREATE TABLE valorant_capture_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      series_id INTEGER NOT NULL,
      game_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED','PROCESSING','REVIEW_REQUIRED','READY','CONFIRMED','REJECTED')),
      detected_source TEXT,
      detected_map TEXT,
      detected_team_a_rounds INTEGER,
      detected_team_b_rounds INTEGER,
      confidence REAL,
      parsed_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(series_id) REFERENCES valorant_series(id) ON DELETE CASCADE
    );
INSERT INTO "valorant_capture_batches" ("id","event_id","series_id","game_number","status","detected_source","detected_map","detected_team_a_rounds","detected_team_b_rounds","confidence","parsed_json","error_code","error_message","created_at","confirmed_at","confirmed_by") VALUES (1,2,1,1,'CONFIRMED','VALORANT_SCOREBOARD','bind',13,10,0.91,'{"map":"bind"}',NULL,NULL,'2026-08-26T16:15:41.954Z','2026-08-20T10:00:00.000Z','admin');
CREATE TABLE valorant_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      original_filename TEXT,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      sha256 TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (source_kind IN ('VALORANT_POST_MATCH','VALORANT_SCOREBOARD','TRACKER_MATCH','UNKNOWN')),
      ocr_text TEXT,
      ocr_json TEXT,
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(batch_id, sha256),
      FOREIGN KEY(batch_id) REFERENCES valorant_capture_batches(id) ON DELETE CASCADE
    );
INSERT INTO "valorant_captures" ("id","batch_id","storage_key","original_filename","mime_type","width","height","bytes","sha256","source_kind","ocr_text","ocr_json","confidence","created_at") VALUES (1,1,'legacy/captura-uno.png','captura-uno.png','image/png',1920,1080,123456,'0000000000000000000000000000000000000000000000000000000000000000','VALORANT_SCOREBOARD','texto leido de la captura',NULL,0.9,'2026-08-26T16:15:41.955Z');
INSERT INTO "valorant_captures" ("id","batch_id","storage_key","original_filename","mime_type","width","height","bytes","sha256","source_kind","ocr_text","ocr_json","confidence","created_at") VALUES (2,1,'legacy/captura-dos.png','captura-dos.png','image/png',1920,1080,123456,'1111111111111111111111111111111111111111111111111111111111111111','TRACKER_MATCH','texto leido de la captura',NULL,0.9,'2026-08-26T16:15:41.955Z');
CREATE TABLE valorant_games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      game_number INTEGER NOT NULL,
      map_key TEXT,
      team_a_rounds INTEGER,
      team_b_rounds INTEGER,
      winner_team_id INTEGER,
      result_source TEXT CHECK (result_source IN ('SCREENSHOT','MANUAL','RIOT','HENRIK')),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(series_id, game_number),
      FOREIGN KEY(series_id) REFERENCES valorant_series(id) ON DELETE CASCADE,
      FOREIGN KEY(winner_team_id) REFERENCES teams(id) ON DELETE SET NULL
    );
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (1,1,1,'bind',13,10,1,'SCREENSHOT','COMPLETED','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.944Z');
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (2,2,1,'ascent',8,13,3,'MANUAL','COMPLETED','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.945Z');
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (3,3,1,'haven',NULL,NULL,NULL,NULL,'WAITING_RESULT','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (4,4,1,'lotus',NULL,NULL,NULL,NULL,'WAITING_RESULT','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (5,5,1,'split',NULL,NULL,NULL,NULL,'WAITING_RESULT','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_games" ("id","series_id","game_number","map_key","team_a_rounds","team_b_rounds","winner_team_id","result_source","status","created_at","updated_at") VALUES (6,6,1,'bind',NULL,NULL,NULL,NULL,'WAITING_RESULT','2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.943Z');
CREATE TABLE valorant_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      map_key TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(event_id, map_key),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (1,2,'ascent','Ascent',1,1);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (2,2,'bind','Bind',1,2);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (3,2,'breeze','Breeze',0,3);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (4,2,'fracture','Fracture',0,4);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (5,2,'haven','Haven',1,5);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (6,2,'icebox','Icebox',0,6);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (7,2,'lotus','Lotus',1,7);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (8,2,'pearl','Pearl',0,8);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (9,2,'split','Split',1,9);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (10,2,'sunset','Sunset',0,10);
INSERT INTO "valorant_maps" ("id","event_id","map_key","name","enabled","position") VALUES (11,2,'abyss','Abyss',0,11);
CREATE TABLE valorant_player_game_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      agent TEXT,
      acs INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      plus_minus INTEGER,
      adr INTEGER,
      hs_percent REAL,
      kast_percent REAL,
      first_kills INTEGER,
      first_deaths INTEGER,
      stats_json TEXT,
      source_capture_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), kd_ratio REAL, dd_delta INTEGER, multi_kills INTEGER, economy_rating INTEGER, spikes_planted INTEGER, defuses INTEGER, observations_json TEXT,
      UNIQUE(game_id, participant_id),
      FOREIGN KEY(game_id) REFERENCES valorant_games(id) ON DELETE CASCADE,
      FOREIGN KEY(participant_id) REFERENCES event_participants(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(source_capture_id) REFERENCES valorant_captures(id) ON DELETE SET NULL
    );
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (1,1,1,1,'jett',100,10,9,3,1,120,20,70,0,0,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,5,0,60,0,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (2,1,5,1,'sova',107,11,10,4,2,121,21,71,1,1,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,6,1,61,1,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (3,1,12,1,'omen',114,12,11,5,3,122,22,72,2,2,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,7,0,62,2,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (4,1,13,1,'sage',121,13,12,6,4,123,23,73,3,3,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,8,1,63,0,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (5,1,20,1,'raze',128,14,13,7,5,124,24,74,4,4,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,9,0,64,1,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (6,1,4,4,'jett',200,10,9,3,1,120,20,70,0,0,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,5,0,60,0,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (7,1,8,4,'sova',207,11,10,4,2,121,21,71,1,1,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,6,1,61,1,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (8,1,9,4,'omen',214,12,11,5,3,122,22,72,2,2,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,7,0,62,2,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (9,1,16,4,'sage',221,13,12,6,4,123,23,73,3,3,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,8,1,63,0,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (10,1,17,4,'raze',228,14,13,7,5,124,24,74,4,4,NULL,1,'2026-08-26T16:15:41.944Z','2026-08-26T16:15:41.944Z',1.1,9,0,64,1,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (11,2,2,2,'jett',100,10,9,3,1,120,20,70,0,0,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,5,0,60,0,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (12,2,6,2,'sova',107,11,10,4,2,121,21,71,1,1,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,6,1,61,1,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (13,2,11,2,'omen',114,12,11,5,3,122,22,72,2,2,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,7,0,62,2,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (14,2,14,2,'sage',121,13,12,6,4,123,23,73,3,3,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,8,1,63,0,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (15,2,19,2,'raze',128,14,13,7,5,124,24,74,4,4,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,9,0,64,1,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (16,2,3,3,'jett',200,10,9,3,1,120,20,70,0,0,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,5,0,60,0,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (17,2,7,3,'sova',207,11,10,4,2,121,21,71,1,1,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,6,1,61,1,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (18,2,10,3,'omen',214,12,11,5,3,122,22,72,2,2,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,7,0,62,2,0,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (19,2,15,3,'sage',221,13,12,6,4,123,23,73,3,3,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,8,1,63,0,1,NULL);
INSERT INTO "valorant_player_game_stats" ("id","game_id","participant_id","team_id","agent","acs","kills","deaths","assists","plus_minus","adr","hs_percent","kast_percent","first_kills","first_deaths","stats_json","source_capture_id","created_at","updated_at","kd_ratio","dd_delta","multi_kills","economy_rating","spikes_planted","defuses","observations_json") VALUES (20,2,18,3,'raze',228,14,13,7,5,124,24,74,4,4,NULL,NULL,'2026-08-26T16:15:41.945Z','2026-08-26T16:15:41.945Z',1.1,9,0,64,1,0,NULL);
CREATE TABLE valorant_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      stage TEXT NOT NULL DEFAULT 'REGULAR',
      matchday INTEGER NOT NULL,
      position INTEGER NOT NULL,
      team_a_id INTEGER NOT NULL,
      team_b_id INTEGER NOT NULL,
      best_of INTEGER NOT NULL DEFAULT 1 CHECK (best_of IN (1,3,5)),
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','READY','WAITING_RESULT','COMPLETED','REVIEW_REQUIRED')),
      winner_team_id INTEGER,
      scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK (team_a_id != team_b_id),
      UNIQUE(event_id, stage, matchday, position),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY(team_a_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(team_b_id) REFERENCES teams(id) ON DELETE CASCADE
    );
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (1,2,'REGULAR',1,1,1,4,1,'COMPLETED',1,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.945Z');
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (2,2,'REGULAR',1,2,2,3,1,'COMPLETED',3,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.945Z');
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (3,2,'REGULAR',2,1,3,1,1,'READY',NULL,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (4,2,'REGULAR',2,2,2,4,1,'READY',NULL,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (5,2,'REGULAR',3,1,1,2,1,'READY',NULL,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.941Z');
INSERT INTO "valorant_series" ("id","event_id","stage","matchday","position","team_a_id","team_b_id","best_of","status","winner_team_id","scheduled_at","created_at","updated_at") VALUES (6,2,'REGULAR',3,2,3,4,1,'READY',NULL,NULL,'2026-08-26T16:15:41.940Z','2026-08-26T16:15:41.943Z');
CREATE TABLE valorant_settings (
      event_id INTEGER PRIMARY KEY,
      tiebreakers_json TEXT NOT NULL DEFAULT '["wins","head_to_head","round_diff","rounds_for"]',
      qualifiers INTEGER NOT NULL DEFAULT 4,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO "valorant_settings" ("event_id","tiebreakers_json","qualifiers","updated_at") VALUES (2,'["round_diff","rounds_for"]',4,'2026-08-26T16:15:41.938Z');
CREATE INDEX idx_audit_event ON admin_audit(event_id, created_at DESC);
CREATE INDEX idx_batches_series ON valorant_capture_batches(series_id, game_number);
CREATE UNIQUE INDEX idx_event_hosts_reporter_token_hash
      ON event_hosts(reporter_token_hash)
      WHERE reporter_token_hash IS NOT NULL;
CREATE INDEX idx_fields_event_position ON event_registration_fields(event_id, position, id);
CREATE INDEX idx_matches_competition ON matches(event_id,stage_id,group_id,match_status,match_number);
CREATE INDEX idx_matches_event_received ON matches(event_id, received_at DESC, id DESC);
CREATE INDEX idx_matches_event_report_id ON matches(event_id, json_extract(payload_json, '$.reportId'))
        WHERE json_extract(payload_json, '$.reportId') IS NOT NULL;
CREATE INDEX idx_matches_received_at ON matches(received_at DESC, id DESC);
CREATE UNIQUE INDEX idx_participant_discord_event ON event_participants(event_id, discord_account_id) WHERE discord_account_id IS NOT NULL;
CREATE UNIQUE INDEX idx_participant_riot_event ON event_participants(event_id, riot_id_normalized) WHERE riot_id_normalized IS NOT NULL;
CREATE INDEX idx_participants_event_status ON event_participants(event_id,status,created_at);
CREATE INDEX idx_prizes_event_position ON event_prizes(event_id,position);
CREATE INDEX idx_schedule_event_position ON event_schedule(event_id,position);
CREATE INDEX idx_series_event_stage ON valorant_series(event_id, stage, matchday);
CREATE INDEX idx_sessions_account ON discord_sessions(discord_account_id);
CREATE INDEX idx_stage_participants_group ON stage_participants(stage_id,group_id,competitive_status);
CREATE INDEX idx_stats_participant ON valorant_player_game_stats(participant_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE UNIQUE INDEX ux_matches_competitive_slot
      ON matches(event_id,stage_id,COALESCE(group_id,0),match_number)
      WHERE stage_id IS NOT NULL AND match_status='VALID';
CREATE UNIQUE INDEX ux_tie_resolution_scope ON tie_resolutions(stage_id,COALESCE(group_id,0),higher_participant_id,lower_participant_id);
INSERT INTO sqlite_sequence (name,seq) VALUES ('events',2);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_registration_fields',8);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_participants',20);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_stages',2);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_groups',2);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_hosts',2);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_schedule',5);
INSERT INTO sqlite_sequence (name,seq) VALUES ('event_prizes',4);
INSERT INTO sqlite_sequence (name,seq) VALUES ('admin_audit',37);
INSERT INTO sqlite_sequence (name,seq) VALUES ('teams',4);
INSERT INTO sqlite_sequence (name,seq) VALUES ('team_members',20);
INSERT INTO sqlite_sequence (name,seq) VALUES ('drafts',1);
INSERT INTO sqlite_sequence (name,seq) VALUES ('draft_picks',16);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_maps',11);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_series',6);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_games',6);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_player_game_stats',20);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_capture_batches',1);
INSERT INTO sqlite_sequence (name,seq) VALUES ('valorant_captures',2);
COMMIT;

