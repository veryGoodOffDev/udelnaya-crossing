const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_FILE = path.join(__dirname, 'data', 'manual-trains.json');
const DATA_FILE = process.env.MANUAL_TRAINS_FILE
  ? path.resolve(process.env.MANUAL_TRAINS_FILE)
  : DEFAULT_FILE;

const VALID_DIRECTIONS = new Set(['from_spb', 'to_spb', 'unspecified']);
const VALID_TYPES = new Set(['regular', 'express', 'high_speed', 'lastochka', 'other']);
const TIME_RE = /^([01]\\d|2[0-3]):([0-5]\\d)$/;

const DEFAULT_TRAINS = [
  {
    id: 'lastochka-1930',
    title: 'Ласточка',
    subtitle: 'Скоростной, проходящий поезд',
    passTime: '19:30',
    closureStart: '19:29',
    closureEnd: '19:34',
    direction: 'unspecified',
    trainType: 'lastochka',
    nonStop: true,
    active: true,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
  },
];

function ensureStorage() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_TRAINS, null, 2) + '\n', 'utf8');
  }
}

function readAll() {
  ensureStorage();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) throw new Error('manual trains storage must contain a JSON array');
  return parsed;
}

function writeAll(items) {
  ensureStorage();
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(items, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, DATA_FILE);
}

function normalizeDays(value) {
  if (!Array.isArray(value) || value.length === 0) return [1, 2, 3, 4, 5, 6, 7];
  const days = [...new Set(value.map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort();
  if (!days.length) throw new Error('daysOfWeek must contain values from 1 to 7');
  return days;
}

function cleanText(value, max, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (text.length > max) throw new Error(`field is too long (max ${max})`);
  return text;
}

function validateInput(input, existing = null) {
  const data = { ...(existing || {}), ...(input || {}) };
  const title = cleanText(data.title, 80);
  if (!title) throw new Error('title is required');

  const passTime = cleanText(data.passTime, 5);
  const closureStart = cleanText(data.closureStart, 5);
  const closureEnd = cleanText(data.closureEnd, 5);
  for (const [name, value] of Object.entries({ passTime, closureStart, closureEnd })) {
    if (!TIME_RE.test(value)) throw new Error(`${name} must be HH:MM`);
  }

  const direction = VALID_DIRECTIONS.has(data.direction) ? data.direction : 'unspecified';
  const trainType = VALID_TYPES.has(data.trainType) ? data.trainType : 'other';

  return {
    ...existing,
    title,
    subtitle: cleanText(data.subtitle, 140),
    passTime,
    closureStart,
    closureEnd,
    direction,
    trainType,
    nonStop: data.nonStop !== false,
    active: data.active !== false,
    daysOfWeek: normalizeDays(data.daysOfWeek),
  };
}

function list({ includeInactive = false } = {}) {
  const items = readAll();
  return includeInactive ? items : items.filter((item) => item.active !== false);
}

function create(input) {
  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    ...validateInput(input),
    createdAt: now,
    updatedAt: now,
  };
  const items = readAll();
  items.push(item);
  writeAll(items);
  return item;
}

function update(id, input) {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = items[index];
  items[index] = {
    ...validateInput(input, current),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  writeAll(items);
  return items[index];
}

function remove(id) {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return false;
  items.splice(index, 1);
  writeAll(items);
  return true;
}

module.exports = { DATA_FILE, DEFAULT_TRAINS, list, create, update, remove, validateInput };
