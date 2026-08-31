'use strict';

/**
 * Formato oficial del evento real de VALORANT.
 *
 * Esta configuración pertenece al slug, no al motor reutilizable. El motor
 * puede seguir ejecutando ligas de 4/5/6 equipos, pero este evento concreto no.
 * Fuente: Jartiland_Torneo_VALORANT_Informacion.pdf (23-08-2026).
 */
const OFFICIAL_VALORANT_SLUG = 'torneo-valorant';

const OFFICIAL_VALORANT_FORMAT = Object.freeze({
  source: Object.freeze({ document: 'Jartiland_Torneo_VALORANT_Informacion.pdf', version: '2026-08-23' }),
  players: 20,
  teams: 4,
  teamSize: 5,
  captains: 4,
  draftEligible: 16,
  draftPicks: 16,
  draftRounds: 4,
  regularSeason: Object.freeze({
    format: 'ROUND_ROBIN',
    bestOf: 1,
    series: 6,
    seriesPerTeam: 3,
    matchdays: 3,
    matchesPerMatchday: 2,
    playoffQualifiers: 4,
    allTeamsAdvance: true
  }),
  playoffs: Object.freeze({
    teams: 4,
    bestOf: 3,
    grandFinalBestOf: 3,
    grandFinalAllowedBestOf: Object.freeze([3, 5]),
    doubleElimination: true,
    grandFinalReset: true,
    openingPairings: Object.freeze(['1º vs 4º', '2º vs 3º'])
  }),
  guaranteedSeriesPerTeam: 5,
  tiebreakers: Object.freeze({
    primary: 'wins',
    twoTeam: Object.freeze(['head_to_head', 'round_diff']),
    final: 'ADMIN_REQUIRED'
  }),
  /*
    Los mapas los decide la organización y se anuncian antes de cada serie. No
    hay veto ni sorteo entre los equipos: prometerlo obligaría a un
    procedimiento que no existe.
  */
  maps: Object.freeze({
    chosenBy: 'ORGANISATION',
    announcedBeforeSeries: true,
    status: 'MAP_POOL_NOT_ANNOUNCED',
    pool: null
  }),
  pending: Object.freeze([
    'Fecha',
    'Horarios',
    'Orden definitivo del draft',
    'Map pool',
    'Criterio definitivo de desempate',
    'Servidor o región',
    'Reglas de pausa',
    'Configuración exacta de las salas'
  ]),
  public: Object.freeze({
    headline: '20 jugadores. 4 equipos. Un solo campeón.',
    summary: 'Primero se forman cuatro equipos mediante un draft en directo. Después juegan todos contra todos para ordenar el seeding. Los cuatro equipos entran en playoffs de doble eliminación.',
    captains: 'Los cuatro jugadores considerados de mayor nivel serán capitanes. Los otros 16 participantes quedarán disponibles para ser elegidos. Cada equipo terminará con un capitán y cuatro jugadores elegidos.',
    draft: 'El draft se realizará en directo, en un canal de voz y con elecciones públicas por turnos. Habrá cuatro rondas de elección. La organización anunciará el orden definitivo antes del draft y podrá utilizar orden serpiente.',
    regularSeason: 'Cada equipo se enfrentará una vez a cada rival: tres BO1 por equipo, seis series totales y tres jornadas. Esta fase no elimina a nadie; sólo ordena del 1º al 4º.',
    standings: 'Las victorias son la prioridad. Todos clasifican a playoffs y la posición obtenida determina los cruces.',
    tiebreakers: 'En caso de empate se utilizarán criterios deportivos como enfrentamiento directo y diferencia de rondas. Si fuese necesario, la organización resolverá el desempate.',
    playoffs: 'El 1º jugará contra el 4º y el 2º contra el 3º. La primera derrota envía al cuadro inferior; la segunda elimina. Todas las series de playoffs serán BO3.',
    grandFinalReset: 'Si el equipo procedente del cuadro inferior gana la primera Gran Final al equipo que seguía invicto, se disputará una serie final de desempate, ya que ambos tendrán entonces una derrota.',
    matches: 'Las series se jugarán en partidas personalizadas de VALORANT. Los horarios, servidor, reglas de pausa y configuración exacta de las salas se publicarán junto al calendario definitivo.',
    formats: 'BO1: un mapa. BO3: primero en ganar dos mapas. La Gran Final será BO3 por defecto y podrá anunciarse previamente como BO5 si el horario lo permite.',
    maps: 'Los mapas los decide la organización y se anuncian antes de cada serie: no hay veto ni sorteo entre los equipos. En BO3 no se repite mapa dentro de la misma serie. El map pool se publicará antes del torneo.',
    results: 'Los resultados oficiales se registrarán en la plataforma y serán revisados por la organización.',
    stats: 'Los marcadores y estadísticas confirmados de las partidas personalizadas se publicarán en la plataforma.',
    registration: 'Las inscripciones todavía no están abiertas.'
  }),
  participantJourney: Object.freeze([
    'Te inscribes y entras en el grupo de jugadores disponibles.',
    'Los cuatro capitanes realizan el draft en directo y quedas asignado a un equipo.',
    'Tu equipo juega tres BO1, uno contra cada rival.',
    'La clasificación coloca a los equipos del 1º al 4º.',
    'Todos entran en playoffs. La primera derrota no elimina; la segunda sí.',
    'Los equipos supervivientes disputan la fase final hasta decidir al campeón.'
  ])
});

function officialValorantFormatForSlug(slug) {
  return String(slug || '').trim().toLowerCase() === OFFICIAL_VALORANT_SLUG
    ? OFFICIAL_VALORANT_FORMAT
    : null;
}

module.exports = {
  OFFICIAL_VALORANT_SLUG,
  OFFICIAL_VALORANT_FORMAT,
  officialValorantFormatForSlug
};
