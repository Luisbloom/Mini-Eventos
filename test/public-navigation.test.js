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
  it('en la portada sólo añade la utilidad global de perfil', () => {
    const portal = publicFile('index.html');
    assert.equal(navigationLinks(portal, 'Navegación principal'), 1);
    assert.match(portal, /class="profile-entry" href="\/perfil"/);
  });

  it('deja un único regreso y el perfil en las páginas interiores', () => {
    const event = publicFile('event.html');
    const information = publicFile('informacion.html');
    const draft = publicFile('draft.html');

    assert.equal(navigationLinks(event, 'Navegación principal'), 2);
    assert.equal(navigationLinks(information, 'Navegación principal'), 2);
    assert.equal((event.match(/href="\/perfil"/g) || []).length, 1);
    assert.equal((information.match(/href="\/perfil"/g) || []).length, 1);
    assert.match(draft, /class="competition-topbar"/);
    assert.equal((draft.match(/href="\/perfil"/g) || []).length, 1);
    assert.doesNotMatch(draft, /id="back-to-competition"/);
  });

  it('no mezcla el acceso de administracion con el indice publico', () => {
    assert.doesNotMatch(publicFile('informacion.html'), /class="admin-link"/);
  });
});
