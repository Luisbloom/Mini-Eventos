'use strict';

/**
 * Metadatos para cuando alguien pega un enlace en Discord o en una red.
 *
 * ⚠️ Esto TIENE que resolverse en el servidor. Los rastreadores que generan la
 * previsualización no ejecutan JavaScript: si el título y la portada se
 * rellenan en el navegador, la tarjeta que ve la gente sale con lo que trae el
 * HTML en crudo, es decir, el texto genérico de plantilla para todos los
 * eventos.
 */

const SITE_NAME = 'Mini Eventos Jartiland';
const DEFAULT_IMAGE = '/images/logo.png';

/** Longitudes por encima de las cuales las tarjetas recortan por su cuenta. */
const MAX_TITLE = 70;
const MAX_DESCRIPTION = 200;

const SECTIONS = Object.freeze({
  draft: { suffix: 'Draft', text: 'Sigue el draft en directo: elecciones por turnos y equipos formándose pick a pick.' },
  competicion: { suffix: 'Competición', text: 'Clasificación, jornadas, eliminatorias y estadísticas del torneo.' },
  informacion: { suffix: 'Información', text: 'Formato, reglas, horarios y premios del torneo.' }
});

function recortar(texto, limite) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= limite) return limpio;
  // Se corta por palabra: partir a mitad de una deja la tarjeta con un muñón.
  const cortado = limpio.slice(0, limite - 1);
  const espacio = cortado.lastIndexOf(' ');
  return `${(espacio > limite * 0.6 ? cortado.slice(0, espacio) : cortado).trimEnd()}…`;
}

/** El escapado va sobre el ATRIBUTO: comillas y `<` romperían la etiqueta. */
function escaparAtributo(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absolutizar(ruta, origen) {
  const valor = String(ruta || '').trim();
  if (!valor) return null;
  if (/^https?:\/\//i.test(valor)) return valor;
  if (!origen) return null;
  return `${origen.replace(/\/+$/, '')}/${valor.replace(/^\/+/, '')}`;
}

/**
 * Metadatos de un evento. Sin evento devuelve los del sitio, que es lo que
 * debe verse en la portada y en cualquier página que no cuelgue de un torneo.
 */
function buildMetadata({ event = null, section = null, origin = null, path: ruta = '/' } = {}) {
  const apartado = section ? SECTIONS[section] ?? null : null;

  const title = event
    ? recortar(apartado
      ? `${apartado.suffix} · ${event.name}`
      : event.name, MAX_TITLE)
    : SITE_NAME;

  const description = recortar(
    apartado?.text
      || (event?.description || '').trim()
      || 'Torneos y encuentros ocasionales para la comunidad de Jartiland.',
    MAX_DESCRIPTION);

  const imagen = event?.bannerImage || event?.coverImage || DEFAULT_IMAGE;

  return {
    title: event ? `${title} · ${SITE_NAME}` : SITE_NAME,
    description,
    image: absolutizar(imagen, origin),
    url: absolutizar(ruta, origin),
    siteName: SITE_NAME
  };
}

/**
 * Escribe los metadatos en el HTML de la plantilla.
 *
 * Sustituye el título y la descripción que ya traía en vez de añadir otros:
 * dos `<title>` o dos descripciones dejan a cada rastreador eligiendo por su
 * cuenta, y eligen distinto.
 */
function injectMetadata(html, metadata) {
  const etiquetas = [
    ['og:site_name', metadata.siteName],
    ['og:type', 'website'],
    ['og:title', metadata.title],
    ['og:description', metadata.description],
    ['og:url', metadata.url],
    ['og:image', metadata.image]
  ]
    .filter(([, valor]) => valor)
    .map(([propiedad, valor]) =>
      `    <meta property="${propiedad}" content="${escaparAtributo(valor)}">`);

  etiquetas.push(`    <meta name="twitter:card" content="${metadata.image ? 'summary_large_image' : 'summary'}">`);
  etiquetas.push(`    <meta name="twitter:title" content="${escaparAtributo(metadata.title)}">`);
  etiquetas.push(`    <meta name="twitter:description" content="${escaparAtributo(metadata.description)}">`);
  if (metadata.image) {
    etiquetas.push(`    <meta name="twitter:image" content="${escaparAtributo(metadata.image)}">`);
  }

  return html
    // Fuera lo que trajera la plantilla, para no dejar duplicados.
    .replace(/[ \t]*<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\r?\n?/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i,
      `<title>${escaparAtributo(metadata.title)}</title>`)
    .replace(/[ \t]*<meta\s+name="description"[^>]*>/i,
      `    <meta name="description" content="${escaparAtributo(metadata.description)}">`)
    .replace(/([ \t]*)<\/head>/i, `${etiquetas.join('\n')}\n$1</head>`);
}

module.exports = {
  SITE_NAME,
  MAX_TITLE,
  MAX_DESCRIPTION,
  buildMetadata,
  injectMetadata
};
