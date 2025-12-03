require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YANDEX_RASP_API_KEY;

// Удельная, код Яндекс.Расписаний
const STATION_CODE = 's9603463';
const RESULT_TZ = 'Europe/Moscow';

// Модель: на сколько минут до/после прибытия считаем шлагбаум закрытым
const CLOSED_BEFORE_MIN = 3;
const CLOSED_AFTER_MIN = 2;

// Раздаём фронт
app.use(express.static(path.join(__dirname, 'public')));

// Хелпер: сегодняшняя дата (YYYY-MM-DD)
function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

app.get('/api/closures', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Не задан YANDEX_RASP_API_KEY в .env' });
  }

  const dateStr = todayIsoDate();

  const url = new URL('https://api.rasp.yandex.net/v3.0/schedule/');
  url.searchParams.set('apikey', API_KEY);
  url.searchParams.set('station', STATION_CODE);
  url.searchParams.set('transport_types', 'suburban');
  url.searchParams.set('event', 'arrival');
  url.searchParams.set('date', dateStr);
  url.searchParams.set('result_timezone', RESULT_TZ);

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({
        error: 'Ошибка от Яндекс.Расписаний',
        status: resp.status,
        body: text.slice(0, 300)
      });
    }

    const data = await resp.json();

    const schedule = Array.isArray(data.schedule) ? data.schedule : [];

    const intervals = schedule
      .filter(item => item.arrival && item.thread)
      .map(item => {
        const arrival = new Date(item.arrival);
        if (isNaN(arrival)) return null;

        const start = new Date(arrival.getTime() - CLOSED_BEFORE_MIN * 60 * 1000);
        const end   = new Date(arrival.getTime() + CLOSED_AFTER_MIN * 60 * 1000);

        return {
          start: start.toISOString(),
          end: end.toISOString(),
          arrival: arrival.toISOString(),
          title: item.thread.short_title || item.thread.title || 'Электропоезд',
          number: item.thread.number || '',
          stops: item.stops || '',
          days: item.days || ''
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    res.json({
      intervals,
      meta: {
        station: STATION_CODE,
        date: dateStr,
        closedBeforeMin: CLOSED_BEFORE_MIN,
        closedAfterMin: CLOSED_AFTER_MIN
      }
    });
  } catch (err) {
    console.error('Ошибка при запросе к API:', err);
    res.status(500).json({
      error: 'Ошибка запроса к API расписаний',
      detail: err.message || String(err)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
