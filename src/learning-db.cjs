'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DB_FILENAME = 'ia-aprendizado.json';

function getDbPath() {
  return path.join(app.getPath('userData'), DB_FILENAME);
}

function load() {
  try {
    const raw = fs.readFileSync(getDbPath(), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.examples)) return data;
  } catch {
    // arquivo não existe ou inválido
  }
  return {
    version: 1,
    mode: 'observer', // observer | auto | approval
    examples: [],
    stats: {
      totalExamples: 0,
      lastUpdated: null,
    },
  };
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(getDbPath()), { recursive: true });
    fs.writeFileSync(getDbPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Erro ao salvar banco de aprendizado:', error);
  }
}

function addExample(incomingText, userReply, chatName = 'Desconhecido', extra = {}) {
  const data = load();
  const example = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    timestamp: new Date().toISOString(),
    chatName,
    incomingText: String(incomingText || '').trim(),
    userReply: String(userReply || '').trim(),
    modeAtTime: data.mode,
    ...extra,
  };
  data.examples.unshift(example); // mais recentes primeiro
  if (data.examples.length > 5000) data.examples.length = 5000; // limite de segurança
  data.stats.totalExamples = data.examples.length;
  data.stats.lastUpdated = example.timestamp;
  save(data);
  return example;
}

function getExamples(limit = 100) {
  const data = load();
  return data.examples.slice(0, limit);
}

function getMode() {
  return load().mode;
}

function setMode(mode) {
  const data = load();
  if (['observer', 'auto', 'approval'].includes(mode)) {
    data.mode = mode;
    save(data);
  }
  return data.mode;
}

function getStats() {
  return load().stats;
}

module.exports = {
  addExample,
  getExamples,
  getMode,
  setMode,
  getStats,
  getDbPath,
};
