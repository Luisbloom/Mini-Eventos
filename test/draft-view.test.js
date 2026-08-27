'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/draft-view');

/**
 * La lógica de la pantalla, probada sin navegador. Decidir quién ve el botón de
 * elegir es exactamente lo que no debe romperse, y atarlo a un DOM significaría
 * no probarlo nunca.
 */
describe('lógica de la pantalla del draft', () => {
  const equipo = (id, captainId, miembros = []) => ({
    id, name: `Equipo ${id}`, seed: id, captainParticipantId: captainId,
    members: [
      { participantId: captainId, displayName: `Capitán ${id}`, role: 'captain' },
      ...miembros
    ]
  });

  const draftActivo = (currentTeamId = 1) => ({
    status: 'ACTIVE', round: 1, pick: 1, totalPicks: 16, teamCount: 4, teamSize: 5,
    currentTeamId,
    teams: [equipo(1, 101), equipo(2, 102), equipo(3, 103), equipo(4, 104)],
    available: [{ participantId: 200, displayName: 'Jugador 200' }],
    picks: []
  });

  const sesionDe = (participantId) => ({
    authenticated: true, displayName: 'Alguien', event: { participantId }
  });

  describe('escapar texto', () => {
    it('convierte en texto lo que intenta ser HTML', () => {
      assert.equal(V.escapeHtml('<img src=x onerror=alert(1)>'),
        '&lt;img src=x onerror=alert(1)&gt;');
      assert.equal(V.escapeHtml('<script>alert(1)</script>'),
        '&lt;script&gt;alert(1)&lt;/script&gt;');
      assert.equal(V.escapeHtml('<b>ABIERTO</b>'), '&lt;b&gt;ABIERTO&lt;/b&gt;');
      assert.equal(V.escapeHtml('Los "Filtradores" & Cía'),
        'Los &quot;Filtradores&quot; &amp; Cía');
      assert.equal(V.escapeHtml("O'Brien"), 'O&#39;Brien');
    });

    it('no rompe con lo que no es texto', () => {
      assert.equal(V.escapeHtml(null), '');
      assert.equal(V.escapeHtml(undefined), '');
      assert.equal(V.escapeHtml(42), '42');
    });

    it('las iniciales salen del nombre, sin traer nada de Discord', () => {
      assert.equal(V.initials('Luis Miguel'), 'LM');
      assert.equal(V.initials('Sella'), 'S');
      assert.equal(V.initials('  '), '?');
      assert.equal(V.initials(null), '?');
    });
  });

  describe('qué pantalla toca en la inscripción', () => {
    it('un evento Próximamente sigue siendo una portada pública con inscripciones cerradas', () => {
      assert.deepEqual(V.publicEventMode({
        status: 'Próximamente', registration: { available: false }
      }), { upcoming: true, registrationsOpen: false });
    });

    it('sin Discord configurado y sin sesión, no se ofrece entrar', () => {
      assert.equal(V.registrationState({ discordConfigured: false, me: { authenticated: false } }),
        'unavailable');
    });

    it('configurado y sin sesión, se ofrece entrar', () => {
      assert.equal(V.registrationState({ discordConfigured: true, me: { authenticated: false } }),
        'login');
    });

    it('con sesión y las inscripciones cerradas, no se enseña un formulario imposible', () => {
      assert.equal(V.registrationState({
        discordConfigured: true,
        me: { authenticated: true, event: { registrationsOpen: false, registered: false } }
      }), 'closed');
    });

    it('con sesión y abiertas, formulario', () => {
      assert.equal(V.registrationState({
        discordConfigured: true,
        me: { authenticated: true, event: { registrationsOpen: true, registered: false } }
      }), 'form');
    });

    it('ya inscrito manda sobre todo lo demás', () => {
      assert.equal(V.registrationState({
        discordConfigured: true,
        me: { authenticated: true, event: { registrationsOpen: false, registered: true } }
      }), 'registered');
    });
  });

  describe('estado del draft', () => {
    it('traduce los estados', () => {
      assert.equal(V.draftLabel('PENDING'), 'PENDIENTE');
      assert.equal(V.draftLabel('ACTIVE'), 'EN DIRECTO');
      assert.equal(V.draftLabel('PAUSED'), 'PAUSADO');
      assert.equal(V.draftLabel('COMPLETED'), 'FINALIZADO');
      assert.equal(V.draftLabel(undefined), 'PENDIENTE');
    });

    it('sólo hay turno mientras está en marcha', () => {
      assert.equal(V.currentTeam(draftActivo(2)).id, 2);
      assert.equal(V.currentTeam({ ...draftActivo(), status: 'PAUSED' }), null);
      assert.equal(V.currentTeam({ ...draftActivo(), status: 'COMPLETED' }), null);
      assert.equal(V.currentTeam(null), null);
    });

    it('resume la situación en una línea', () => {
      assert.match(V.draftHeadline({ ...draftActivo(), status: 'PENDING' }), /todavía no ha empezado/);
      assert.match(V.draftHeadline({ ...draftActivo(), status: 'PAUSED' }), /pausado/);
      assert.match(V.draftHeadline({ ...draftActivo(), status: 'COMPLETED' }), /terminado/);
      assert.match(V.draftHeadline(draftActivo(3)), /Turno de Equipo 3/);
    });

    it('los huecos libres se ven, no se esconden', () => {
      const slots = V.teamSlots(equipo(1, 101, [
        { participantId: 200, displayName: 'A', role: 'player' }
      ]), 5);
      assert.equal(slots.length, 5);
      assert.equal(slots[0].role, 'captain', 'el capitán va primero');
      assert.equal(slots[2], null);
      assert.equal(slots.filter((s) => s === null).length, 3);
    });
  });

  describe('quién puede elegir', () => {
    it('un visitante no es nadie', () => {
      assert.equal(V.viewerRole(draftActivo(), { authenticated: false }), 'visitor');
      assert.equal(V.canPick(draftActivo(), { authenticated: false }), false);
    });

    it('alguien identificado pero sin inscripción tampoco', () => {
      assert.equal(V.viewerRole(draftActivo(), { authenticated: true, event: {} }), 'visitor');
    });

    it('un participante normal ve pero no elige', () => {
      const me = sesionDe(200);
      assert.equal(V.viewerRole(draftActivo(), me), 'participant');
      assert.equal(V.canPick(draftActivo(), me), false);
    });

    it('un capitán al que no le toca, tampoco', () => {
      const me = sesionDe(102);
      assert.equal(V.viewerRole(draftActivo(1), me), 'captain');
      assert.equal(V.canPick(draftActivo(1), me), false, 'el turno es del equipo 1');
    });

    it('sólo el capitán del turno', () => {
      const me = sesionDe(101);
      assert.equal(V.canPick(draftActivo(1), me), true);
    });

    it('ni pausado ni terminado dejan elegir a nadie', () => {
      const me = sesionDe(101);
      assert.equal(V.canPick({ ...draftActivo(1), status: 'PAUSED' }, me), false);
      assert.equal(V.canPick({ ...draftActivo(1), status: 'COMPLETED' }, me), false);
      assert.equal(V.canPick({ ...draftActivo(1), status: 'PENDING' }, me), false);
    });
  });

  describe('juntar los avisos del directo', () => {
    it('tres avisos seguidos no lanzan tres peticiones', async () => {
      let veces = 0;
      let resolver;
      const enCurso = new Promise((r) => { resolver = r; });
      const refrescar = V.createRefreshQueue(async () => { veces += 1; await enCurso; });

      const primera = refrescar();
      refrescar();          // llegan mientras la primera sigue
      refrescar();
      assert.equal(veces, 1, 'sólo una en vuelo');

      resolver();
      await primera;
      // Al terminar se hace UNA más, no dos, porque los avisos se juntan.
      assert.equal(veces, 2);
    });

    it('sin solapamiento cada aviso es una petición', async () => {
      let veces = 0;
      const refrescar = V.createRefreshQueue(async () => { veces += 1; });
      await refrescar();
      await refrescar();
      assert.equal(veces, 2);
    });

    it('un fallo no deja la cola bloqueada', async () => {
      let veces = 0;
      const refrescar = V.createRefreshQueue(async () => {
        veces += 1;
        if (veces === 1) throw new Error('sin red');
      });
      await assert.rejects(() => refrescar());
      await refrescar();
      assert.equal(veces, 2, 'se puede volver a refrescar');
    });
  });
});
