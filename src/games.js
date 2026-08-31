'use strict';

/**
 * Qué sabe la plataforma de cada juego.
 *
 * La web aloja torneos de juegos distintos —Among Us, Valorant, y los que
 * vengan— y cada uno necesita cosas distintas: un identificador propio del
 * jugador, un draft por equipos, capturas del marcador, una portada de
 * competición u otra.
 *
 * ⚠️ Antes esto vivía repartido en comparaciones sueltas del tipo
 * `event.game.toLowerCase() === 'valorant'`, en siete sitios y con dos
 * normalizaciones distintas. Añadir un juego obligaba a encontrarlas todas y
 * acertar en cuáles aplicaban. Aquí se declara una vez.
 *
 * Para dar de alta un juego nuevo basta con añadir su entrada. Lo que NO esté
 * declarado se comporta como un torneo básico: inscripción y participantes,
 * sin draft ni capturas, que es lo que se puede sostener sin código propio.
 */

/** Lo que hace un juego del que no sabemos nada en particular. */
const BASE = Object.freeze({
  key: null,
  playerIdField: null,
  hasDraft: false,
  hasTeams: false,
  hasCaptures: false,
  hasAutomaticReports: false,
  competitionPage: 'competition-page.html'
});

const GAMES = Object.freeze({
  'among us': Object.freeze({
    ...BASE,
    key: 'among-us',
    name: 'Among Us',
    // El Friend Code identifica al jugador dentro de la partida.
    playerIdField: 'friend_code',
    // Los resultados los envía el mod, no se teclean ni se leen de una foto.
    hasAutomaticReports: true,
    competitionPage: 'amongus-competition.html'
  }),
  valorant: Object.freeze({
    ...BASE,
    key: 'valorant',
    name: 'Valorant',
    playerIdField: 'riot_id',
    hasDraft: true,
    hasTeams: true,
    // El marcador se lee de las capturas de la partida.
    hasCaptures: true
  })
});

/**
 * Una sola forma de normalizar, para que `CS:GO`, `cs:go` y ` CS:GO ` sean el
 * mismo juego se compare donde se compare.
 */
function normalizeGame(game) {
  return String(game ?? '').trim().toLocaleLowerCase('es');
}

/** Lo que la plataforma sabe de ese juego. Nunca devuelve null. */
function gameProfile(game) {
  return GAMES[normalizeGame(game)] ?? { ...BASE, name: String(game ?? '').trim() };
}

const isAmongUs = (game) => gameProfile(game).key === 'among-us';
const isValorant = (game) => gameProfile(game).key === 'valorant';

module.exports = {
  GAMES,
  BASE_GAME_PROFILE: BASE,
  normalizeGame,
  gameProfile,
  isAmongUs,
  isValorant
};
