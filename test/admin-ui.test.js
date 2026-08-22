'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', 'public');

describe('panel de hosts y auditoría', () => {
  it('sitúa la configuración de hosts dentro de Partidas / Reporter', () => {
    const html = fs.readFileSync(path.join(publicDirectory, 'admin.html'), 'utf8');
    const reporterStart = html.indexOf('id="reporter-simulator-section"');
    const reporterEnd = html.indexOf('id="fields-section"');
    const scheduleStart = html.indexOf('id="schedule-admin-section"');
    const scheduleEnd = reporterStart;

    assert.ok(reporterStart > -1);
    assert.match(html.slice(reporterStart, reporterEnd), /id="admin-hosts"/);
    assert.match(html.slice(reporterStart, reporterEnd), /Hosts del torneo/);
    assert.doesNotMatch(html.slice(scheduleStart, scheduleEnd), /id="admin-hosts"/);
    assert.match(html, /id="host-credential-feedback"[^>]+aria-live="polite"/);
  });

  it('descarga la configuración de una sola visualización sin persistir el secreto en el navegador', () => {
    const script = fs.readFileSync(path.join(publicDirectory, 'admin-competition.js'), 'utf8');

    assert.match(script, /hosts\/\$\{host\.id\}\/token/);
    assert.match(script, /new Blob\(\[config\]/);
    assert.match(script, /`\$\{identifier\}-reporter\.ini`/);
    assert.match(script, /navigator\.clipboard\.writeText\(config\)/);
    assert.match(script, /method:'DELETE'/);
    assert.match(script, /confirm\(/);
    assert.match(script, /identifier\.disabled\s*=\s*host\.tokenConfigured/);
    assert.match(script, /Revoca[^'"`]+cambiar[^'"`]+identificador/i);
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
    assert.doesNotMatch(script, /dataset\.(?:token|reporterToken)|textContent\s*=\s*data\.token/);
  });

  it('permite asignar fase y grupo a cada host y muestra si podrá reportar', () => {
    const script = fs.readFileSync(path.join(publicDirectory, 'admin-competition.js'), 'utf8');

    assert.match(script, /hosts\/\$\{host\.id\}\/assignment/);
    assert.match(script, /method:'PUT'/);
    assert.match(script, /FASE QUE CUBRE ESTE PC/);
    assert.match(script, /ASIGNAR FASE/);
    assert.match(script, /host\.assignedStageId/);
    assert.match(script, /host\.assignedGroupId/);
    assert.match(script, /context\.reportingEnabled/);
    // La tarjeta refleja el motivo que da el backend en vez de inventarse uno.
    assert.match(script, /No enviará resultados: \$\{context\.message\}/);
    assert.match(script, /renderHostAssignment\(host\)/);
  });

  it('presenta la auditoría con nombres humanos y sin datos sensibles', () => {
    const script = fs.readFileSync(path.join(publicDirectory, 'admin.js'), 'utf8');

    for (const field of ['stageName', 'groupName', 'hostIdentifier', 'hostName', 'origin', 'submittedBy', 'matchStatus', 'reportId', 'receivedAt', 'playedAt']) {
      assert.match(script, new RegExp(`match\\.${field}|match\\.report\\?\\.${field}`));
    }
    assert.doesNotMatch(script.slice(script.indexOf('function renderMatchAudit'), script.indexOf('function renderResults')), /sourceIp|friendCode|reporterToken/);
  });
});
