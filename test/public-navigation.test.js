'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function publicFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
}

function navigationLinks(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const navigation = html.match(new RegExp(`<nav[^>]+aria-label="${escaped}"[^>]*>([\\s\\S]*?)<\\/nav>`));
  assert.ok(navigation, `Falta la navegacion: ${label}`);
  return [...navigation[1].matchAll(/<a\b/g)].length;
}

describe('navegacion publica simplificada', () => {
  it('sitúa el perfil como utilidad independiente a la derecha de la portada', () => {
    const portal = publicFile('index.html');
    assert.doesNotMatch(portal, /class="primary-nav"/);
    assert.match(portal, /class="topbar-utilities">[\s\S]*class="profile-entry" href="\/perfil"/);
  });

  it('deja la navegación contextual separada del perfil en las páginas interiores', () => {
    const event = publicFile('event.html');
    const information = publicFile('informacion.html');
    const draft = publicFile('draft.html');

    assert.equal(navigationLinks(event, 'Navegación principal'), 1);
    assert.equal(navigationLinks(information, 'Navegación principal'), 1);
    assert.equal((event.match(/href="\/perfil"/g) || []).length, 1);
    assert.equal((information.match(/href="\/perfil"/g) || []).length, 1);
    assert.match(event, /class="topbar-utilities">[\s\S]*class="profile-entry"/);
    assert.match(information, /class="topbar-utilities">[\s\S]*class="profile-entry"/);
    assert.match(draft, /class="competition-topbar"/);
    assert.equal(navigationLinks(draft, 'Accesos generales'), 1);
    assert.equal((draft.match(/href="\/perfil"/g) || []).length, 1);
    assert.match(draft, /class="topbar-utilities">[\s\S]*class="profile-entry"/);
    assert.doesNotMatch(draft, /id="back-to-competition"/);
  });

  it('no mezcla el acceso de administracion con el indice publico', () => {
    assert.doesNotMatch(publicFile('informacion.html'), /class="admin-link"/);
  });
});
