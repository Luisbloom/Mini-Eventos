'use strict';

const form = document.querySelector('#information-form');
const saveButton = document.querySelector('#save-button');
const saveMessage = document.querySelector('#save-message');
const dot = document.querySelector('#admin-dot');
const state = document.querySelector('#admin-state');

function byId(id) {
  return document.querySelector(`#${id}`);
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parseFaqs(value) {
  return lines(value).map((line, index) => {
    const separator = line.indexOf('||');
    if (separator < 1 || separator >= line.length - 2) {
      throw new Error(`La FAQ de la línea ${index + 1} debe usar: Pregunta || Respuesta`);
    }
    return {
      question: line.slice(0, separator).trim(),
      answer: line.slice(separator + 2).trim()
    };
  });
}

function renderScoring(scoring) {
  byId('admin-scoring').replaceChildren(...scoring.rules.map((rule) => {
    const card = document.createElement('article');
    const label = document.createElement('span');
    label.textContent = rule.label;
    const points = document.createElement('strong');
    points.textContent = `${rule.points > 0 ? '+' : ''}${rule.points}`;
    card.append(label, points);
    return card;
  }));
}

function populate(data) {
  const { general, format, rules, tiebreakers, faqs } = data.information;
  byId('intro').value = general.intro;
  byId('date').value = general.date;
  byId('time').value = general.time;
  byId('participants').value = general.participantCount ?? '';
  byId('status').value = general.status;
  byId('phase').value = general.phase;
  byId('groups-enabled').checked = format.groupsEnabled;
  byId('classification').value = format.classification;
  byId('final').value = format.final;
  byId('rules').value = rules.join('\n');
  byId('tiebreakers').value = tiebreakers.join('\n');
  byId('faqs').value = faqs.map((faq) => `${faq.question} || ${faq.answer}`).join('\n');
  renderScoring(data.scoring);
}

function collectInformation() {
  const participantValue = byId('participants').value;
  return {
    general: {
      intro: byId('intro').value,
      date: byId('date').value,
      time: byId('time').value,
      participantCount: participantValue ? Number(participantValue) : null,
      status: byId('status').value,
      phase: byId('phase').value
    },
    format: {
      groupsEnabled: byId('groups-enabled').checked,
      classification: byId('classification').value,
      final: byId('final').value
    },
    rules: lines(byId('rules').value),
    tiebreakers: lines(byId('tiebreakers').value),
    faqs: parseFaqs(byId('faqs').value)
  };
}

function feedback(message, type = '') {
  saveMessage.className = type;
  saveMessage.textContent = message;
}

async function load() {
  try {
    const response = await fetch('/api/tournament-information', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    populate(await response.json());
    dot.className = 'live-dot live';
    state.textContent = 'EDITOR LISTO';
  } catch {
    dot.className = 'live-dot error';
    state.textContent = 'ERROR DE CARGA';
    feedback('No se pudo cargar la configuración del servidor.', 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = byId('admin-token').value;
  if (!token) {
    feedback('Introduce el ADMIN_TOKEN antes de guardar.', 'error');
    byId('admin-token').focus();
    return;
  }

  let information;
  try {
    information = collectInformation();
  } catch (error) {
    feedback(error.message, 'error');
    return;
  }

  saveButton.disabled = true;
  feedback('Guardando cambios…');
  try {
    const response = await fetch('/api/admin/tournament-information', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ information })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    feedback('Información guardada. /informacion ya muestra los nuevos datos.', 'success');
  } catch (error) {
    feedback(error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
});

load();
