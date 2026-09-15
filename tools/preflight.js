#!/usr/bin/env node
'use strict';

/**
 * Comprobación de antes del torneo.
 *
 *   sudo node /opt/jartiland-amongus/tools/preflight.js [--slug torneo-valorant]
 *
 * Una sola pantalla que dice si hoy se puede jugar, y qué falta si no. Existe
 * porque el torneo tiene muchas piezas para 20 personas —Discord, draft en
 * directo, capturas con OCR, mod del reportero, doble eliminación— y cada una
 * puede fallar ese día. Mejor saberlo una hora antes que con la gente esperando.
 *
 * Sólo lee: no cambia nada de la base ni del servicio. Habla con la web por
 * 127.0.0.1 con el token de administración de .env, así que nunca cuenta como
 * intento fallido de administración (si el token falta, ni lo intenta).
 *
 * Sale con código 1 si hay algún FALLO. Los AVISOS no impiden jugar.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { officialRosterState, OFFICIAL_VALORANT_FORMAT } = require(path.join(__dirname, '..', 'src', 'valorant-event-format.js'));
const MAX_PLAYERS = OFFICIAL_VALORANT_FORMAT.maxPlayers;

const argumento = (nombre, porDefecto) => {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice > -1 ? process.argv[indice + 1] : porDefecto;
};
const SLUG = argumento('slug', 'torneo-valorant');
const BASE = argumento('base', 'http://127.0.0.1:3100');
const ENV = argumento('env', path.join(__dirname, '..', '.env'));
const VIGILANTE = '/usr/local/sbin/jartiland-vigilante';

const filas = [];
const ok = (nombre, detalle) => filas.push(['ok', nombre, detalle]);
const aviso = (nombre, detalle) => filas.push(['AVISO', nombre, detalle]);
const fallo = (nombre, detalle) => filas.push(['FALLO', nombre, detalle]);

function tokenDeAdministracion() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const linea = fs.readFileSync(ENV, 'utf8').split('\n').find((l) => l.startsWith('ADMIN_TOKEN='));
    return linea ? linea.slice('ADMIN_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

async function pedir(ruta, token) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10000)
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  return { estado: respuesta.status, cuerpo };
}

async function comprobar() {
  // ── la web ───────────────────────────────────────────────────────────────
  let salud;
  try {
    salud = await pedir('/api/health');
  } catch (error) {
    fallo('web', `no responde en ${BASE}: ${error.message}. Ver «La web no carga» en docs/DIA-DEL-TORNEO.md`);
    return;
  }
  if (salud.cuerpo.database === 'ok') ok('web', `en marcha desde hace ${Math.round(salud.cuerpo.uptimeSeconds / 60)} min`);
  else fallo('web', 'responde, pero la base de datos no');

  const discord = await pedir('/api/auth/discord/status');
  if (discord.cuerpo.configured) ok('discord', 'inicio de sesión configurado');
  else fallo('discord', 'sin configurar: nadie puede inscribirse ni elegir en el draft');

  // ── el evento ────────────────────────────────────────────────────────────
  const token = tokenDeAdministracion();
  if (!token) {
    fallo('administración', `no hay ADMIN_TOKEN en ${ENV} (¿falta sudo?). No se comprueba nada más`);
    return;
  }
  const eventos = await pedir('/api/admin/events', token);
  if (eventos.estado !== 200) {
    fallo('administración', `el token no vale (HTTP ${eventos.estado}). No se reintenta para no bloquear la IP`);
    return;
  }
  const evento = (eventos.cuerpo.events || []).find((e) => e.slug === SLUG);
  if (!evento) {
    fallo('evento', `no existe ${SLUG}`);
    return;
  }
  ok('evento', `${evento.name} · ${evento.status}`);

  // ── la gente ─────────────────────────────────────────────────────────────
  const { cuerpo: { participants = [] } } = await pedir(`/api/admin/events/${evento.id}/participants`, token);
  const confirmados = participants.filter((p) => p.status === 'confirmed').length;
  const pendientes = participants.filter((p) => p.status === 'pending').length;
  const plantilla = officialRosterState(confirmados);
  const extra = pendientes ? ` (y ${pendientes} pendientes de confirmar)` : '';
  if (!plantilla.playable) {
    fallo('jugadores', `${confirmados} confirmados${extra}: hacen falta al menos 20 para jugar`);
  } else if (plantilla.leftOut > 0) {
    aviso('jugadores', `${confirmados} confirmados${extra}: se juega con ${plantilla.playable.players} y ${plantilla.leftOut} se quedan fuera. Faltan ${plantilla.missingForNext} para ${plantilla.next?.players ?? MAX_PLAYERS}`);
  } else {
    ok('jugadores', `${confirmados} confirmados${extra}: ${plantilla.playable.teams} equipos de 5`);
  }

  // ── draft y competición ──────────────────────────────────────────────────
  const { cuerpo: competicion } = await pedir(`/api/admin/events/${evento.id}/competition`, token);
  const draft = competicion.draft;
  const equipos = competicion.teams || [];
  if (!draft) {
    aviso('draft', 'sin preparar. Se hace otro día por Discord; sin él no hay equipos ni calendario');
  } else if (draft.status === 'COMPLETED') {
    // Sin miembros cuenta como incompleto: suponer que está lleno taparía justo lo que se busca.
    const incompletos = equipos.filter((e) => (e.members || []).length !== draft.teamSize);
    if (incompletos.length) fallo('draft', `terminado, pero ${incompletos.map((e) => e.name).join(', ')} no tienen ${draft.teamSize}`);
    else ok('draft', `terminado: ${equipos.length} equipos de ${draft.teamSize}`);
  } else {
    aviso('draft', `en estado ${draft.status} (elección ${draft.currentPick} de ${draft.totalPicks})`);
  }

  const mapas = competicion.maps || [];
  const activos = mapas.filter((m) => m.enabled).length;
  if (competicion.mapPolicy?.status === 'MAP_POOL_ANNOUNCED') ok('mapas', `pool anunciado: ${activos} mapas`);
  else aviso('mapas', `pool sin anunciar (${activos} habilitados). Se anuncia el mismo día, antes de la primera serie`);

  const jornadas = competicion.matchdays || [];
  if (draft?.status === 'COMPLETED' && jornadas.length === 0) aviso('liga', 'el draft ha terminado y la liga no está generada');
  else if (jornadas.length) ok('liga', `${jornadas.length} jornadas generadas`);
}

function comprobarOperacion() {
  if (!fs.existsSync(VIGILANTE)) {
    aviso('operación', `no está ${VIGILANTE}: ¿se ejecuta fuera del servidor?`);
    return;
  }
  let salida;
  try {
    salida = execFileSync(VIGILANTE, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (error) {
    salida = `${error.stdout || ''}`;
    if (!salida) {
      fallo('operación', `el vigilante no se pudo ejecutar: ${error.message}`);
      return;
    }
  }
  const lineas = salida.split('\n').filter((l) => /^(ok|FALLO)\s/.test(l));
  const caidas = lineas.filter((l) => l.startsWith('FALLO'));
  if (caidas.length) caidas.forEach((l) => fallo('operación', l.replace(/^FALLO\s+/, '')));
  else ok('operación', `copias, disco, certificado y restauración: ${lineas.length} comprobaciones en orden`);
}

(async () => {
  try {
    await comprobar();
  } catch (error) {
    fallo('preflight', `se ha roto a mitad: ${error.message}`);
  }
  comprobarOperacion();

  const ancho = Math.max(...filas.map(([, nombre]) => nombre.length));
  console.log(`\nAntes del torneo · ${SLUG} · ${new Date().toLocaleString('es-ES')}\n`);
  for (const [nivel, nombre, detalle] of filas) {
    console.log(`${nivel.padEnd(6)} ${nombre.padEnd(ancho)}  ${detalle}`);
  }
  const fallos = filas.filter(([nivel]) => nivel === 'FALLO').length;
  const avisos = filas.filter(([nivel]) => nivel === 'AVISO').length;
  console.log(fallos
    ? `\n✖ ${fallos} fallo(s): mira docs/DIA-DEL-TORNEO.md antes de empezar.`
    : `\n✔ Se puede jugar${avisos ? ` (${avisos} aviso(s) que conviene leer)` : ''}.`);
  process.exitCode = fallos ? 1 : 0;
})();
