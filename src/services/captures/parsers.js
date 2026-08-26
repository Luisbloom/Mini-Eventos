'use strict';

/**
 * De texto reconocido a datos de una partida.
 *
 * Regla que gobierna todo esto: **si un dato no está visible, es null, no cero**.
 * Un 0 inventado en ADR contamina la media del torneo y nadie vuelve a saber si
 * ese jugador hizo cero daño o si la captura no traía la columna.
 *
 * Hay dos interfaces reales y no se parecen:
 *
 * - El **cliente de Valorant** enseña la pantalla en el idioma de quien juega,
 *   pone el nombre y el agente en dos renglones, junta K/D/A en una celda y
 *   ordena las diez filas por rendimiento, **mezclando los equipos**.
 * - **Tracker** separa Team A y Team B, trae muchas más columnas y pone la
 *   etiqueta del Riot ID aparte, en pequeño y en gris.
 *
 * Ninguna de las dos se lee buscando cadenas en el texto plano: se usan las
 * cajas de cada palabra, porque `text.includes('13')` encuentra el 13 de un ACS
 * de 130.
 */

const { KINDS } = require('./classify');
const {
  findHeader, nameLimit, nameColumnStart, readRow, mergeContinuationLines, numero, esNumero,
  anchoDe, centroX, alto, normalizeHeader
} = require('./layout');

/** Nombres de mapa que puede llevar una captura. */
const MAP_NAMES = Object.freeze({
  ascent: 'Ascent', bind: 'Bind', breeze: 'Breeze', fracture: 'Fracture',
  haven: 'Haven', icebox: 'Icebox', lotus: 'Lotus', pearl: 'Pearl',
  split: 'Split', sunset: 'Sunset', abyss: 'Abyss', corrode: 'Corrode'
});

const AGENTS = Object.freeze([
  'Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade',
  'Gekko', 'Harbor', 'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Neon', 'Omen', 'Phoenix',
  'Raze', 'Reyna', 'Sage', 'Skye', 'Sova', 'Tejo', 'Viper', 'Vyse', 'Waylay', 'Yoru'
]);

const AGENTES_NORMALIZADOS = new Map(AGENTS.map((agente) => [normalizeHeader(agente), agente]));

/** Se mantiene por compatibilidad: la tabla viva está en columns.js. */
const { COLUMN_ALIASES: COLUMNS } = require('./columns');

const VACIO = Object.freeze({
  map: null, teamARounds: null, teamBRounds: null, scorePair: null,
  teamNames: [], players: []
});

// ------------------------------------------------------------------ utilidades

/** Riot ID completo: gameName#tagLine. */
const RIOT_ID = /^(.+?)#([A-Za-z0-9]{2,6})$/;
/** Una etiqueta suelta, con o sin almohadilla. */
const TAG_SUELTO = /^#?([A-Za-z0-9]{2,6})$/;

function partirRiotId(bruto) {
  const encontrado = RIOT_ID.exec(String(bruto || '').trim());
  if (!encontrado) return { gameName: String(bruto || '').trim(), tagLine: null, riotId: null };
  return {
    gameName: encontrado[1].trim(),
    tagLine: encontrado[2],
    riotId: `${encontrado[1].trim()}#${encontrado[2]}`
  };
}

function buscarMapa(texto) {
  const mayusculas = normalizeHeader(texto);
  for (const [clave, nombre] of Object.entries(MAP_NAMES)) {
    if (new RegExp(`\\b${nombre.toUpperCase()}\\b`).test(mayusculas)) {
      return { key: clave, name: nombre };
    }
  }
  return null;
}

function buscarAgente(palabras) {
  for (const palabra of palabras) {
    const encontrado = AGENTES_NORMALIZADOS.get(normalizeHeader(palabra));
    if (encontrado) return encontrado;
  }
  return null;
}

const esAgente = (texto) => AGENTES_NORMALIZADOS.has(normalizeHeader(texto));

/**
 * Reconstruye el Riot ID cuando el nombre y la etiqueta llegan por separado.
 *
 * En Tracker la etiqueta va al lado, más pequeña y en gris, así que el OCR la
 * devuelve como otra palabra. Se pega sólo si va pegada de verdad y tiene forma
 * de etiqueta: cualquier texto pequeño cercano no vale, o acabaríamos metiendo
 * el rango o una columna dentro del nombre.
 */
/**
 * Confianza mínima para aceptar una etiqueta.
 *
 * Va en gris y en cuerpo pequeño, así que es lo primero que el OCR se inventa:
 * medido sobre la captura real, «#NANO» sale como «#znd» y «#EUW» como «#zw».
 * Y una etiqueta equivocada es PEOR que ninguna: sin ella el jugador se asocia
 * igual por su nombre, y con ella se busca un Riot ID que no existe.
 */
const CONFIANZA_ETIQUETA = 75;

function reconstruirRiotId(palabras, ancho) {
  if (palabras.length === 0) return { raw: '', ...partirRiotId('') };

  const ordenadas = [...palabras].sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
  const junto = ordenadas.map((p) => p.text).join(' ');

  // Si ya viene entero, no hay nada que reconstruir. Aun así, la parte de la
  // etiqueta tiene que haberse leído con seguridad.
  const directo = partirRiotId(junto.replace(/\s*#\s*/, '#'));
  if (directo.riotId) {
    const conAlmohadilla = ordenadas.find((palabra) => palabra.text.includes('#'));
    if ((conAlmohadilla?.confidence ?? 100) >= CONFIANZA_ETIQUETA) {
      return { raw: junto, ...directo };
    }
    return { raw: directo.gameName, gameName: directo.gameName, tagLine: null, riotId: null };
  }

  const ultima = ordenadas[ordenadas.length - 1];
  const anterior = ordenadas[ordenadas.length - 2];
  const posibleTag = TAG_SUELTO.exec(ultima.text);

  if (posibleTag && anterior) {
    const separacion = ultima.bbox.x0 - anterior.bbox.x1;
    const masPequena = alto(ultima) <= alto(anterior) * 1.15;
    const lleveAlmohadilla = ultima.text.startsWith('#');
    // Con almohadilla basta; sin ella hay que exigir que esté pegada y en
    // letra más pequeña, o un número de una columna se colaría como etiqueta.
    const pegada = separacion >= 0 && separacion < ancho * 0.02;
    // Si el motor no está seguro de lo que ha leído ahí, no se usa.
    const legible = (ultima.confidence ?? 100) >= CONFIANZA_ETIQUETA;
    const pareceEtiqueta = lleveAlmohadilla || (pegada && masPequena && !esNumero(ultima.text));

    if (pareceEtiqueta) {
      const nombre = ordenadas.slice(0, -1).map((p) => p.text).join(' ').trim();
      if (nombre) {
        // Si se ha leído con seguridad, se usa. Si no, ese trozo se descarta
        // igualmente: es la etiqueta, sólo que ilegible, y dejarla dentro del
        // nombre haría que no se pareciera al de nadie.
        // Una «etiqueta» que parece una palabra normal casi nunca lo es: suele
        // ser un trozo del propio nombre con una almohadilla inventada. Se
        // devuelve al nombre en vez de tirarla.
        const pareceUnaPalabra = /^[A-Z][a-z]{3,}$/.test(posibleTag[1]);
        if (pareceUnaPalabra) {
          const entero = `${nombre} ${posibleTag[1]}`.trim();
          return { raw: entero, gameName: entero, tagLine: null, riotId: null };
        }

        return legible
          ? {
            raw: `${nombre}#${posibleTag[1]}`, gameName: nombre,
            tagLine: posibleTag[1], riotId: `${nombre}#${posibleTag[1]}`
          }
          : { raw: nombre, gameName: nombre, tagLine: null, riotId: null };
      }
    }
  }

  return { raw: junto, gameName: junto, tagLine: null, riotId: null };
}

/**
 * Las palabras de una fila que están a la izquierda de la primera columna.
 *
 * La frontera incluye las cabeceras que no traen datos, como «Current Rank»:
 * sin eso, el rango del jugador se pegaría a su nombre y el Riot ID no se
 * reconstruiría nunca.
 */
function palabrasDeNombre(linea, cabecera, inicioNombre = null) {
  const limite = nameLimit(cabecera);
  // Sin filas suficientes para deducir la columna, no se filtra nada: el
  // margen tiene que dejar pasar todo, no bloquearlo todo.
  const margen = inicioNombre === null ? -Infinity : inicioNombre;
  return linea.words
    .filter((palabra) => centroX(palabra) < limite)
    // Lo que empieza claramente antes de la columna del nombre es el retrato,
    // el nivel o el rango: no forma parte de cómo se llama nadie.
    .filter((palabra) => palabra.bbox.x1 > margen)
    .sort((uno, otro) => uno.bbox.x0 - otro.bbox.x0);
}

/**
 * Une las filas que el OCR ha partido en dos renglones.
 *
 * En la captura real del cliente pasa con varias: el nombre queda en un renglon
 * y sus numeros en el de al lado, unas veces encima y otras debajo. Si no se
 * juntan, esas filas se pierden, y son jugadores enteros.
 *
 * Se detecta por lo que le FALTA a cada mitad, no por su contenido: un renglon
 * con numeros y sin nombre solo puede ser la continuacion del de al lado.
 */
function unirFilasPartidas(filas, cabecera, ancho) {
  const limite = nameLimit(cabecera);

  const describir = (fila) => {
    const stats = readRow(fila, cabecera, ancho);
    return {
      datos: stats.acs !== undefined || stats.kills !== undefined,
      // El agente no cuenta como nombre: va en su propio renglon.
      nombre: fila.words.some((palabra) => centroX(palabra) < limite
        && /[a-zA-Z]{3,}/.test(palabra.text) && !esAgente(palabra.text))
    };
  };

  const salida = [];
  for (const fila of filas) {
    const actual = describir(fila);
    const anterior = salida[salida.length - 1];

    if (anterior) {
      const antes = describir(anterior);
      const altura = Math.max(1, fila.bbox.y1 - fila.bbox.y0);
      const cerca = fila.bbox.y0 - anterior.bbox.y1 < altura * 1.4;
      const complementarias =
        (antes.datos && !antes.nombre && !actual.datos && actual.nombre)
        || (antes.nombre && !antes.datos && actual.datos && !actual.nombre);

      if (cerca && complementarias) {
        anterior.words = [...anterior.words, ...fila.words];
        anterior.text = anterior.text + ' ' + fila.text;
        anterior.bbox = {
          x0: Math.min(anterior.bbox.x0, fila.bbox.x0),
          y0: Math.min(anterior.bbox.y0, fila.bbox.y0),
          x1: Math.max(anterior.bbox.x1, fila.bbox.x1),
          y1: Math.max(anterior.bbox.y1, fila.bbox.y1)
        };
        continue;
      }
    }
    salida.push({ ...fila, words: [...fila.words] });
  }
  return salida;
}

/**
 * Basura que el OCR saca de los iconos que rodean al nombre.
 *
 * Un Riot ID sólo lleva letras, cifras, espacios y guiones bajos. Un trozo
 * corto con dos puntos o puntos en medio («s:7:c», «z.cx») no es parte de
 * ningún nombre: es el nivel o el rango leídos a medias. Y dejarlo dentro hace
 * que la misma persona no se reconozca entre las dos capturas.
 */
const esRuido = (texto) => {
  const limpio = String(texto || '').trim();
  if (limpio.length === 0) return true;
  // Una etiqueta puede ser sólo cifras («#1409»): lleva almohadilla y no es ruido.
  if (/^#[A-Za-z0-9]{2,6}$/.test(limpio)) return false;
  if (!/[a-zA-Z]/.test(limpio)) return true;                 // sólo signos o cifras
  if (limpio.length <= 2 && /[^a-zA-Z]/.test(limpio)) return true;   // «x.», «.%»
  // La almohadilla sí puede aparecer: es la etiqueta del Riot ID.
  return limpio.length <= 6 && /[^a-zA-Z0-9_# -]/.test(limpio);
};

/**
 * Quita de los extremos lo que no puede ser parte de un nombre.
 *
 * Se hace por los bordes y no por el medio: un nombre puede tener trozos raros
 * dentro («Hakai Shin Sella»), pero lo que sobra siempre viene pegado delante
 * (el retrato) o detrás (el nivel).
 */
function recortarRuido(palabras) {
  let inicio = 0;
  let fin = palabras.length;
  while (inicio < fin && esRuido(palabras[inicio].text)) inicio += 1;
  while (fin > inicio && esRuido(palabras[fin - 1].text)) fin -= 1;
  return palabras.slice(inicio, fin);
}

// --------------------------------------------------------------- marcadores

/** «13 : 10», «13 - 10» o dos números sueltos con algo en medio. */
function parMarcador(texto) {
  const limpio = String(texto || '');
  const conSeparador = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/.exec(limpio);
  if (conSeparador) return [Number(conSeparador[1]), Number(conSeparador[2])];
  // «10 DERROTA 13» / «13 VICTORY 10»
  const conPalabra = /\b(\d{1,2})\b[^\d]{2,30}?\b(\d{1,2})\b/.exec(limpio);
  if (conPalabra) return [Number(conPalabra[1]), Number(conPalabra[2])];
  return null;
}

/**
 * El marcador de la franja de rondas de Tracker.
 *
 * Encima de la tabla hay dos renglones, uno por equipo, cada uno con su tanteo
 * a la izquierda seguido de los iconos ronda a ronda. Es la lectura MÁS fiable
 * de esta pantalla: el «13 : 10» del encabezado va sobre arte de fondo y se
 * pierde con facilidad, pero esos dos números están sobre banda plana.
 *
 * Y de paso orienta: el primer renglón es el Team A de la captura.
 *
 * Se busca por estructura, no por texto: dos renglones seguidos, alineados por
 * la izquierda, cuyo primer número está en el rango de un marcador. Las
 * etiquetas («Team A») llegan del OCR como «Tama», «mre» o «re», así que no se
 * puede depender de leerlas.
 */
function marcadorPorFranja(lines, ancho) {
  for (let i = 0; i < lines.length - 1; i++) {
    const arriba = primerNumeroALaIzquierda(lines[i], ancho);
    const abajo = primerNumeroALaIzquierda(lines[i + 1], ancho);
    if (arriba === null || abajo === null) continue;
    if (arriba === abajo) continue;                       // no hay empates
    if (Math.max(arriba, abajo) < 13) continue;           // nadie ha ganado
    if (Math.max(arriba, abajo) > 30) continue;

    // Los dos tanteos tienen que estar en la misma columna.
    const desviacion = Math.abs(lines[i].words[0].bbox.x0 - lines[i + 1].words[0].bbox.x0);
    if (desviacion > ancho * 0.06) continue;

    return [arriba, abajo];
  }
  return null;
}

/** El primer número de un renglón, si está en su tercio izquierdo. */
function primerNumeroALaIzquierda(linea, ancho) {
  for (const palabra of linea.words) {
    if (centroX(palabra) > ancho * 0.33) return null;
    const valor = numero(palabra.text);
    if (valor !== null) return valor;
  }
  return null;
}

/** Un marcador creíble: alguien llegó a la meta y no hay empate. */
const marcadorPlausible = (par) =>
  Array.isArray(par) && par[0] !== par[1] && Math.max(...par) >= 13 && Math.min(...par) >= 0
  && Math.max(...par) <= 40;

// ============================================================ CLIENTE VALORANT

/**
 * La pantalla de puntuaciones del cliente.
 *
 * Dos cosas que hay que tener presentes y que no son evidentes:
 *
 * 1. Las filas están **ordenadas por rendimiento, no por equipo**. Dar por hecho
 *    que los cinco primeros son un equipo mete a media plantilla en el bando
 *    equivocado.
 * 2. El marcador («10 DERROTA 13») está desde el punto de vista de quien jugó,
 *    así que **no dice qué equipo del torneo hizo 13**. Se devuelve como par sin
 *    orientar y lo orienta otra fuente.
 */
function parseValorantScoreboard(ocr, opciones = {}) {
  const lines = ocr.lines || [];
  const ancho = anchoDe(lines);
  const cabecera = opciones.header ?? findHeader(lines);

  // El marcador está por encima de la tabla, así que se busca ANTES de exigir
  // cabecera: cuando se lee sólo la banda de arriba no hay tabla que encontrar,
  // y aun así es justo de donde tiene que salir el tanteo.
  const hasta = cabecera ? cabecera.index : lines.length;
  let par = null;
  for (const linea of lines.slice(0, hasta)) {
    const candidato = parMarcador(linea.text);
    if (marcadorPlausible(candidato)) { par = candidato; break; }
  }

  if (!cabecera) {
    return { ...VACIO, kind: KINDS.VALORANT_SCOREBOARD, scorePair: par };
  }

  // Nombre y agente van en dos renglones: se juntan antes de leer la tabla.
  const conAgente = mergeContinuationLines(lines.slice(cabecera.index + 1), {
    esContinuacion: (linea) =>
      linea.words.length <= 3 && linea.words.every((palabra) => !esNumero(palabra.text))
      && (linea.words.some((palabra) => esAgente(palabra.text)) || linea.words.length === 1)
  });
  // Y algunas filas llegan partidas: el nombre en un renglon y sus numeros en
  // el siguiente, o al reves.
  const filas = unirFilasPartidas(conAgente, cabecera, ancho);

  const conDatos = filas.filter((fila) => {
    const stats = readRow(fila, cabecera, ancho);
    return stats.acs !== undefined || stats.kills !== undefined;
  });
  const inicioNombre = nameColumnStart(conDatos, nameLimit(cabecera));

  const jugadores = [];
  for (const fila of filas) {
    const stats = readRow(fila, cabecera, ancho);
    // Sin ACS ni bajas no es una fila de jugador: será un pie de tabla.
    if (stats.acs === undefined && stats.kills === undefined) continue;

    const nombre = recortarRuido(
      palabrasDeNombre(fila, cabecera, inicioNombre).filter((palabra) => !esAgente(palabra.text)));
    const identidad = reconstruirRiotId(nombre, ancho);
    if (!identidad.gameName) continue;

    jugadores.push({
      ...identidad,
      agent: buscarAgente(nombre.map((palabra) => palabra.text))
        ?? buscarAgente(fila.words.map((palabra) => palabra.text)),
      // El cliente no separa equipos: quién juega con quién sale del roster.
      visualTeam: null,
      confidence: fila.confidence / 100,
      ...stats
    });
  }

  return {
    kind: KINDS.VALORANT_SCOREBOARD,
    map: buscarMapa(ocr.text),
    // Sin orientar a propósito: esta pantalla no sabe qué lado es cuál.
    teamARounds: null,
    teamBRounds: null,
    scorePair: par,
    teamNames: [],
    players: jugadores
  };
}

// ==================================================================== TRACKER

/** Las cabeceras de equipo de Tracker: «Team A • Avg. Rank: Silver I». */
const CABECERA_EQUIPO = /\bTEAM\s*([AB])\b/;

/**
 * La pantalla de partida de Tracker.
 *
 * Sí separa los dos equipos, así que es la que **orienta el marcador**. Cada
 * fila se queda con el lado en el que estaba (`visualTeam`), pero ese lado no es
 * autoridad: que Tracker llame «Team A» a un bando no dice cuál de los dos
 * equipos del torneo es. Eso lo resuelve después el roster.
 */
function parseTrackerMatch(ocr, opciones = {}) {
  const lines = ocr.lines || [];
  const ancho = anchoDe(lines);
  // La cabecera puede venir de otra lectura de la MISMA imagen: la banda de
  // arriba se lee con un tratamiento distinto y a veces saca columnas que en
  // la pasada de la tabla se pierden.
  const cabecera = opciones.header ?? findHeader(lines);

  const mapa = buscarMapa(ocr.text);

  // El marcador va arriba. Primero la franja de rondas, que es lo que mejor se
  // lee; si no aparece, el «13 : 10» del encabezado.
  const limite = cabecera ? cabecera.index : lines.length;
  const arriba = lines.slice(0, limite);

  let par = marcadorPorFranja(arriba, ancho);
  if (!marcadorPlausible(par)) {
    par = null;
    for (const linea of arriba) {
      const candidato = parMarcador(linea.text);
      if (marcadorPlausible(candidato)) { par = candidato; break; }
    }
  }

  if (!cabecera) {
    return {
      kind: KINDS.TRACKER_MATCH, map: mapa,
      teamARounds: par ? par[0] : null, teamBRounds: par ? par[1] : null,
      scorePair: par, teamNames: [], players: []
    };
  }

  const jugadores = [];

  /*
    En la captura real la cabecera de equipo y la de columnas comparten renglón:
    «Team A • Avg. Rank: Silver I   Current Rank  ACS  K  D  A …».
    Así que el lado del primer bloque hay que sacarlo de la propia fila de
    cabeceras; si se espera a encontrar una línea suelta, esos cinco jugadores
    se quedan sin lado y el marcador no se puede orientar.
  */
  const enCabecera = CABECERA_EQUIPO.exec(normalizeHeader(cabecera.line.text));
  let ladoActual = enCabecera ? enCabecera[1] : null;

  // Las filas con datos definen dónde empieza la columna del nombre.
  const conDatos = lines.slice(cabecera.index + 1).filter((linea) => {
    const stats = readRow(linea, cabecera, ancho);
    return stats.acs !== undefined || stats.kills !== undefined;
  });
  const inicioNombre = nameColumnStart(conDatos, nameLimit(cabecera));

  for (const linea of lines.slice(cabecera.index + 1)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion) { ladoActual = seccion[1]; continue; }

    const stats = readRow(linea, cabecera, ancho);
    if (stats.acs === undefined && stats.kills === undefined) continue;

    const nombre = recortarRuido(palabrasDeNombre(linea, cabecera, inicioNombre));
    const identidad = reconstruirRiotId(nombre, ancho);
    if (!identidad.gameName) continue;

    jugadores.push({
      ...identidad,
      agent: buscarAgente(linea.words.map((palabra) => palabra.text)),
      visualTeam: ladoActual,
      confidence: linea.confidence / 100,
      // Hace falta para repartir los equipos cuando sus cabeceras no se leen.
      top: linea.bbox.y0,
      ...stats
    });
  }

  // Si no se han podido leer las cabeceras de equipo, quedan dos formas de
  // saber dónde acaba un bloque y empieza el otro.
  if (jugadores.length >= 6 && jugadores.every((jugador) => !jugador.visualTeam)) {
    const lados = ladosPorCabeceraPrevia(lines, cabecera.index) ?? ['A', 'B'];
    const corte = corteEntreEquipos(jugadores);
    if (corte) {
      jugadores.forEach((jugador, indice) => {
        jugador.visualTeam = indice < corte ? lados[0] : lados[1];
      });
    }
  }

  return {
    kind: KINDS.TRACKER_MATCH,
    map: mapa,
    // Tracker sí orienta: su Team A es el primer número.
    teamARounds: par ? par[0] : null,
    teamBRounds: par ? par[1] : null,
    scorePair: par,
    teamNames: nombresDeEquipo(lines, cabecera.index),
    players: jugadores
  };
}

/**
 * Por dónde se parte la lista en dos equipos.
 *
 * Entre el último jugador de un bloque y el primero del siguiente va la
 * cabecera del segundo equipo, así que ahí hay un hueco vertical mayor que el
 * que separa dos filas seguidas. Se busca ese hueco y no una posición fija:
 * vale igual para cinco y cinco que para una tabla con alguna fila perdida.
 */
function corteEntreEquipos(jugadores) {
  const huecos = [];
  for (let i = 1; i < jugadores.length; i++) {
    huecos.push({ indice: i, hueco: jugadores[i].top - jugadores[i - 1].top });
  }
  if (huecos.length === 0) return null;

  const normales = [...huecos].sort((uno, otro) => uno.hueco - otro.hueco);
  const tipico = normales[Math.floor(normales.length / 2)].hueco;
  const mayor = huecos.reduce((mejor, actual) => actual.hueco > mejor.hueco ? actual : mejor, huecos[0]);

  // Tiene que destacar de verdad; si todas las filas están igual de separadas,
  // es que no hay cabecera en medio y no se puede repartir.
  if (tipico <= 0 || mayor.hueco < tipico * 1.5) return null;
  return mayor.indice;
}

function ladosPorCabeceraPrevia(lines, hasta) {
  const encontrados = [];
  for (const linea of lines.slice(0, hasta)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion && !encontrados.includes(seccion[1])) encontrados.push(seccion[1]);
  }
  return encontrados.length === 2 ? encontrados : null;
}

function nombresDeEquipo(lines, hasta) {
  const nombres = [];
  for (const linea of lines.slice(0, hasta)) {
    const seccion = CABECERA_EQUIPO.exec(normalizeHeader(linea.text));
    if (seccion) nombres.push(`Team ${seccion[1]}`);
  }
  return nombres;
}

// ============================================== resumen genérico (sintéticos)

/**
 * El resumen de fin de partida sin más señas: se lee como el scoreboard, pero
 * aceptando además que el marcador venga como dos líneas de «EQUIPO n».
 */
function parseValorantPostMatch(ocr, opciones = {}) {
  const leido = parseValorantScoreboard(ocr, opciones);
  const lines = ocr.lines || [];
  const cabecera = findHeader(lines);
  const hasta = cabecera ? cabecera.index : lines.length;

  let par = leido.scorePair;
  const equipos = [];

  if (!par) {
    for (const linea of lines.slice(0, hasta)) {
      const ultima = linea.words[linea.words.length - 1];
      const valor = numero(ultima?.text);
      if (valor === null || linea.words.length < 2) continue;
      const nombre = linea.words.slice(0, -1).map((p) => p.text).join(' ').trim();
      if (!nombre || buscarMapa(nombre)) continue;
      equipos.push({ name: nombre, rounds: valor });
    }
    if (equipos.length >= 2) par = [equipos[0].rounds, equipos[1].rounds];
  }

  return {
    ...leido,
    kind: KINDS.VALORANT_POST_MATCH,
    // Estas capturas tampoco orientan por sí solas, pero cuando traen los
    // nombres de los equipos el marcador ya viene en su orden.
    teamARounds: equipos.length >= 2 && par ? par[0] : null,
    teamBRounds: equipos.length >= 2 && par ? par[1] : null,
    scorePair: par,
    teamNames: equipos.map((equipo) => equipo.name)
  };
}

const PARSERS = Object.freeze({
  [KINDS.VALORANT_POST_MATCH]: parseValorantPostMatch,
  [KINDS.VALORANT_SCOREBOARD]: parseValorantScoreboard,
  [KINDS.TRACKER_MATCH]: parseTrackerMatch
});

/** Aplica el parser que toque. UNKNOWN no se adivina: se devuelve vacío. */
function parseCapture(kind, ocr, opciones = {}) {
  const parser = PARSERS[kind];
  if (!parser) return { kind: KINDS.UNKNOWN, ...VACIO };
  return parser(ocr, opciones);
}

module.exports = {
  parseCapture, parseValorantPostMatch, parseValorantScoreboard, parseTrackerMatch,
  marcadorPorFranja, CONFIANZA_ETIQUETA,
  partirRiotId, reconstruirRiotId, buscarMapa, buscarAgente, numero,
  parMarcador, marcadorPlausible,
  encontrarCabecera: findHeader,
  MAP_NAMES, AGENTS, COLUMNS
};
