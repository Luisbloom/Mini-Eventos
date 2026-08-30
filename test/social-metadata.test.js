'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SITE_NAME, MAX_TITLE, MAX_DESCRIPTION, buildMetadata, injectMetadata
} = require('../src/services/social-metadata');

const ORIGEN = 'https://eventos.example';
const EVENTO = {
  slug: 'torneo-valorant',
  name: 'Torneo Valorant',
  description: 'Veinte jugadores, cuatro equipos, un solo campeón.',
  coverImage: '/images/events/valorant-cover.jpg',
  bannerImage: null
};

const PLANTILLA = [
  '<!doctype html>',
  '<html lang="es">',
  '  <head>',
  '    <meta charset="utf-8">',
  '    <meta name="description" content="Evento de la comunidad Jartiland">',
  '    <title>Evento · Mini Eventos Jartiland</title>',
  '  </head>',
  '  <body></body>',
  '</html>'
].join('\n');

describe('metadatos sociales', () => {
  it('describe el evento concreto, no la plantilla', () => {
    const meta = buildMetadata({ event: EVENTO, origin: ORIGEN, path: '/eventos/torneo-valorant' });
    assert.equal(meta.title, `Torneo Valorant · ${SITE_NAME}`);
    assert.equal(meta.description, 'Veinte jugadores, cuatro equipos, un solo campeón.');
    assert.equal(meta.image, `${ORIGEN}/images/events/valorant-cover.jpg`);
    assert.equal(meta.url, `${ORIGEN}/eventos/torneo-valorant`);
  });

  it('prefiere el banner a la portada cuando el evento tiene los dos', () => {
    const meta = buildMetadata({
      event: { ...EVENTO, bannerImage: '/images/events/banner.jpg' }, origin: ORIGEN
    });
    assert.equal(meta.image, `${ORIGEN}/images/events/banner.jpg`);
  });

  it('distingue las secciones del evento', () => {
    const draft = buildMetadata({ event: EVENTO, section: 'draft', origin: ORIGEN });
    assert.equal(draft.title, `Draft · Torneo Valorant · ${SITE_NAME}`);
    assert.match(draft.description, /directo/);

    const competicion = buildMetadata({ event: EVENTO, section: 'competicion', origin: ORIGEN });
    assert.match(competicion.title, /^Competición · Torneo Valorant/);
  });

  it('sin evento describe el sitio', () => {
    const meta = buildMetadata({ origin: ORIGEN, path: '/' });
    assert.equal(meta.title, SITE_NAME);
    assert.equal(meta.image, `${ORIGEN}/images/logo.png`);
  });

  it('recorta por palabra lo que no cabe en una tarjeta', () => {
    const meta = buildMetadata({
      event: { ...EVENTO, description: 'palabra '.repeat(60) }, origin: ORIGEN
    });
    assert.ok(meta.description.length <= MAX_DESCRIPTION);
    assert.ok(meta.description.endsWith('…'));
    assert.ok(!meta.description.includes('palab…'), 'no debe partir una palabra por la mitad');
  });

  it('mantiene el titulo dentro del limite', () => {
    const meta = buildMetadata({ event: { ...EVENTO, name: 'T'.repeat(120) }, origin: ORIGEN });
    const sinSufijo = meta.title.replace(` · ${SITE_NAME}`, '');
    assert.ok(sinSufijo.length <= MAX_TITLE);
  });

  it('sin origen no inventa una URL absoluta', () => {
    const meta = buildMetadata({ event: EVENTO, path: '/eventos/torneo-valorant' });
    assert.equal(meta.image, null);
    assert.equal(meta.url, null);
  });

  it('respeta una imagen que ya es absoluta', () => {
    const meta = buildMetadata({
      event: { ...EVENTO, coverImage: 'https://cdn.example/a.png' }, origin: ORIGEN
    });
    assert.equal(meta.image, 'https://cdn.example/a.png');
  });
});

describe('inyeccion en el HTML', () => {
  const render = (evento) => injectMetadata(PLANTILLA,
    buildMetadata({ event: evento, origin: ORIGEN, path: '/eventos/x' }));

  it('sustituye titulo y descripcion en vez de duplicarlos', () => {
    const html = render(EVENTO);
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.equal((html.match(/name="description"/g) || []).length, 1);
    assert.match(html, /<title>Torneo Valorant · Mini Eventos Jartiland<\/title>/);
    assert.ok(!html.includes('Evento de la comunidad Jartiland'));
  });

  it('escribe Open Graph y Twitter dentro del head', () => {
    const html = render(EVENTO);
    const head = html.slice(0, html.indexOf('</head>'));
    for (const etiqueta of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name']) {
      assert.ok(head.includes(`property="${etiqueta}"`), `falta ${etiqueta}`);
    }
    assert.ok(head.includes('name="twitter:card" content="summary_large_image"'));
  });

  it('no deja dos veces las etiquetas si la plantilla ya traia unas', () => {
    const conOg = PLANTILLA.replace('  </head>',
      '    <meta property="og:title" content="Viejo">\n    <meta name="twitter:card" content="summary">\n  </head>');
    const html = injectMetadata(conOg, buildMetadata({ event: EVENTO, origin: ORIGEN }));
    assert.equal((html.match(/property="og:title"/g) || []).length, 1);
    assert.equal((html.match(/name="twitter:card"/g) || []).length, 1);
    assert.ok(!html.includes('content="Viejo"'));
  });

  it('escapa las comillas para no romper el atributo', () => {
    const html = render({ ...EVENTO, name: 'El "gran" torneo <b>', description: 'Con "comillas"' });
    assert.ok(!html.includes('content="El "gran"'));
    assert.match(html, /&quot;gran&quot;/);
    assert.ok(!html.includes('<b>'));
  });

  it('sin imagen usa tarjeta pequena', () => {
    const html = injectMetadata(PLANTILLA, buildMetadata({ event: EVENTO }));
    assert.ok(html.includes('name="twitter:card" content="summary"'));
    assert.ok(!html.includes('property="og:image"'));
  });
});
