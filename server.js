require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 5501;
const API_KEY = process.env.YANDEX_RASP_API_KEY;

// Удельная, код Яндекс.Расписаний
const STATION_CODE = 's9603463';
const RESULT_TZ = 'Europe/Moscow';

// Модель: на сколько минут до/после прибытия считаем шлагбаум закрытым
const CLOSED_BEFORE_MIN = 2;
const CLOSED_AFTER_MIN = 4;

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

// ====== КЭШ ДЛЯ /api/closures ======
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов, можешь сделать 6 или 24
let closuresCache = null; 
// формат:
// {
//   date: '2025-12-04',
//   generatedAt: '2025-12-04T09:30:00.000Z',
//   data: { intervals: [...], meta: {...} }
// }

async function fetchClosuresFromYandex(dateStr) {
  if (!API_KEY) {
    // если вдруг кто-то вызовет напрямую без ключа
    throw new Error('Не задан YANDEX_RASP_API_KEY в .env');
  }

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
    throw new Error(
      `Ошибка от Яндекс.Расписаний: ${resp.status} ${text.slice(0, 300)}`
    );
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

  return {
    intervals,
    meta: {
      station: STATION_CODE,
      date: dateStr,
      closedBeforeMin: CLOSED_BEFORE_MIN,
      closedAfterMin: CLOSED_AFTER_MIN
    }
  };
}


app.get('/api/closures', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Не задан YANDEX_RASP_API_KEY в .env' });
  }

  const dateStr = todayIsoDate();
  const now = Date.now();

  // если в кэше уже есть данные на сегодняшнюю дату и они не протухли
  if (closuresCache && closuresCache.date === dateStr) {
    const age = now - new Date(closuresCache.generatedAt).getTime();
    if (age < CACHE_TTL_MS) {
      // отдаём кэш, даже если фронт дёргает раз в секунду
      return res.json(closuresCache.data);
    }
  }

  // кэша нет или он устарел — идём в Яндекс, обновляем кэш
  try {
    const data = await fetchClosuresFromYandex(dateStr);

    closuresCache = {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      data
    };

    res.json(data);
  } catch (err) {
    console.error('Ошибка при запросе к API/кэшу:', err);
    res.status(500).json({
      error: 'Ошибка запроса к API расписаний',
      detail: err.message || String(err)
    });
  }
});


app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
