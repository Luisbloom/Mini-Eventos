'use strict';

// Estado compartido por las dos mitades del contrato Reporter: el test de Node
// que valida el endpoint y el envío, y el test de C# que valida el parseo del
// contexto y la serialización del resultado. Ambos leen los mismos archivos de
// reporter/contract, así que si una mitad cambia el formato la otra falla.

const path = require('node:path');
const { openDatabase } = require('../../src/database');
const { hashReporterToken } = require('../../src/services/reporter-auth');

const CONTRACT_DIRECTORY = path.resolve(__dirname, '..', '..', 'reporter', 'contract');
const CONTEXT_FIXTURE = path.join(CONTRACT_DIRECTORY, 'reporter-context.json');
const PAYLOAD_FIXTURE = path.join(CONTRACT_DIRECTORY, 'reporter-payload.json');

const HOST_TOKEN = `jtr_${'C'.repeat(43)}`;

const PLAYERS = [
  { discord: 'jarti-uno', name: 'Luis', friendCode: 'luis#1001' },
  { discord: 'jarti-dos', name: 'Marta', friendCode: 'marta#1002' },
  { discord: 'jarti-tres', name: 'Nacho', friendCode: 'nacho#1003' },
  { discord: 'jarti-cuatro', name: 'Sara', friendCode: 'sara#1004' }
];

function seedContractDatabase(dbPath) {
  const database = openDatabase(dbPath);
  const event = database.getDefaultEvent();
  const [stage] = database.competition.listStages(event.id);
  database.competition.updateStage(stage.id, { status: 'active' });
  const [groupA] = database.competition.listGroups(stage.id);
  const [host] = database.competition.listHosts(event.id);

  const participants = PLAYERS.map((player) => {
    const created = database.createParticipant(event.id, {
      discord_username: player.discord,
      game_name: player.name,
      friend_code: player.friendCode
    });
    database.updateParticipant(created.id, { status: 'confirmed', internalFriendCode: player.friendCode });
    database.competition.assignParticipant(stage.id, created.id, groupA.id);
    return { ...player, participantId: created.id };
  });

  database.competition.setHostReporterToken(event.id, host.id, { tokenHash: hashReporterToken(HOST_TOKEN) });
  database.competition.setHostAssignment(event.id, host.id, { stageId: stage.id, groupId: groupA.id });

  return { database, event, stage, group: groupA, host, participants };
}

module.exports = {
  CONTRACT_DIRECTORY,
  CONTEXT_FIXTURE,
  PAYLOAD_FIXTURE,
  HOST_TOKEN,
  PLAYERS,
  seedContractDatabase
};
