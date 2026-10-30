require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const {
  RESULT_TZ,
  createManualIntervals,
  mergeIntervals,
  zonedIsoDate,
} = require('./schedule');
const manualTrains = require('./manual-trains-store');

const app = express();

const PORT = process.env.PORT || 5501;
const API_KEY = process.env.YANDEX_RASP_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const STATION_CODE = 's9603463';
const CLOSED_BEFORE_MIN = 2;
const CLOSED_AFTER_MIN = 4;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const adminSessions = new Map();

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function todayIsoDate() {
  return zonedIsoDate(new Date(), RESULT_TZ);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const idx = part.indexOf('=');
      return idx < 0
        ? [decodeURIComponent(part), '']
        : [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
    })
  );
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions.entries()) {
    if (expiresAt <= now) adminSessions.delete(token);
  }
}

function getAdminSession(req) {
  cleanupSessions();
  const token = parseCookies(req).udelnaya_admin;
  if (!token) return null;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  return { token, expiresAt };
}

function requireAdminApi(req, res, next) {
  if (!getAdminSession(req)) {
    return res.status(401).json({ error: 'Требуется вход администратора' });
  }
  next();
}

function requireAdminPage(req, res, next) {
  if (!getAdminSession(req)) return res.redirect('/admin/login');
  next();
}

function setAdminCookie(req, res, token) {
  const parts = [
    `udelnaya_admin=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminCookie(req, res) {
  const parts = [
    'udelnaya_admin=',
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let closuresCache = null;

function invalidateClosuresCache() {
  closuresCache = null;
}

async function fetchClosuresFromYandex(dateStr) {
  if (!API_KEY) throw new Error('Не задан YANDEX_RASP_API_KEY в .env');

  const url = new URL('https://api.rasp.yandex.net/v3.0/schedule/');
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('station', STATION_CODE);
  url.searchParams.set('transport_types', 'suburban');
  url.searchParams.set('event', 'arrival');
  url.searchParams.set('date', dateStr);
  url.searchParams.set('result_timezone', RESULT_TZ);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ошибка от Яндекс.Расписаний: ${resp.status} ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const schedule = Array.isArray(data.schedule) ? data.schedule : [];

  const apiIntervals = schedule
    .filter((item) => item.arrival && item.thread)
    .map((item) => {
      const arrival = new Date(item.arrival);
      if (isNaN(arrival)) return null;
      const start = new Date(arrival.getTime() - CLOSED_BEFORE_MIN * 60 * 1000);
      const end = new Date(arrival.getTime() + CLOSED_AFTER_MIN * 60 * 1000);
      return {
        start: start.toISOString(),
        end: end.toISOString(),
        arrival: arrival.toISOString(),
        title: item.thread.short_title || item.thread.title || 'Электропоезд',
        number: item.thread.number || '',
        stops: item.stops || '',
        days: item.days || '',
      };
    })
    .filter(Boolean);

  const manualIntervals = createManualIntervals(dateStr, manualTrains.list());
  const intervals = mergeIntervals(apiIntervals, manualIntervals);

  return {
    intervals,
    meta: {
      station: STATION_CODE,
      date: dateStr,
      closedBeforeMin: CLOSED_BEFORE_MIN,
      closedAfterMin: CLOSED_AFTER_MIN,
      manualEventsIncluded: true,
    },
  };
}

app.get('/admin/login', (req, res) => {
  if (getAdminSession(req)) return res.redirect('/admin/trains');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/trains', requireAdminPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'trains.html'));
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD не настроен на сервере' });
  }
  const password = req.body?.password;
  if (!constantTimeEqual(password || '', ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  setAdminCookie(req, res, token);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const session = getAdminSession(req);
  if (session) adminSessions.delete(session.token);
  clearAdminCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: Boolean(getAdminSession(req)) });
});

app.get('/api/manual-trains', (req, res) => {
  res.json({ items: manualTrains.list() });
});

app.get('/api/admin/manual-trains', requireAdminApi, (req, res) => {
  res.json({ items: manualTrains.list({ includeInactive: true }) });
});

app.post('/api/admin/manual-trains', requireAdminApi, (req, res) => {
  try {
    const item = manualTrains.create(req.body);
    invalidateClosuresCache();
    res.status(201).json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Некорректные данные' });
  }
});

app.patch('/api/admin/manual-trains/:id', requireAdminApi, (req, res) => {
  try {
    const item = manualTrains.update(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: 'Поезд не найден' });
    invalidateClosuresCache();
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Некорректные данные' });
  }
});

app.delete('/api/admin/manual-trains/:id', requireAdminApi, (req, res) => {
  if (!manualTrains.remove(req.params.id)) {
    return res.status(404).json({ error: 'Поезд не найден' });
  }
  invalidateClosuresCache();
  res.status(204).end();
});

app.get('/api/closures', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Не задан YANDEX_RASP_API_KEY в .env' });
  }

  const dateStr = todayIsoDate();
  const now = Date.now();

  if (closuresCache && closuresCache.date === dateStr) {
    const age = now - new Date(closuresCache.generatedAt).getTime();
    if (age < CACHE_TTL_MS) return res.json(closuresCache.data);
  }

  try {
    const data = await fetchClosuresFromYandex(dateStr);
    closuresCache = {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      data,
    };
    res.json(data);
  } catch (err) {
    console.error('Ошибка при запросе к API/кэшу:', err);
    res.status(500).json({
      error: 'Ошибка запроса к API расписаний',
      detail: err.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
