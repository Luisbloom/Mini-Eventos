'use strict';

const crypto = require('node:crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalPlayedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? String(value) : instant.toISOString();
}

function canonicalRequest(report) {
  const normalized = {
    ...report,
    reportId: String(report?.reportId || '').trim(),
    winner: report?.winner ?? report?.winnerTeam ?? report?.winningTeam ?? null,
    playedAt: canonicalPlayedAt(report?.playedAt)
  };
  for (const key of ['eventId', 'stageId', 'groupId', 'hostId', 'matchNumber', 'winnerTeam', 'winningTeam']) {
    delete normalized[key];
  }
  return JSON.stringify(stableValue(normalized));
}

function fingerprintReport(report) {
  return crypto.createHash('sha256').update(canonicalRequest(report), 'utf8').digest('hex');
}

module.exports = { fingerprintReport };
