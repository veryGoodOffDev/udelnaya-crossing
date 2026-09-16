const RESULT_TZ = 'Europe/Moscow';

// Ручные события для поездов, которые проходят Удельную без остановки
// и поэтому отсутствуют в станционном API Яндекс.Расписаний.
const MANUAL_TRAIN_EVENTS = Object.freeze([
  Object.freeze({
    id: 'lastochka-1930',
    title: 'Ласточка',
    subtitle: 'Скоростной, проходящий поезд',
    passTime: '19:30',
    closureStart: '19:29',
    closureEnd: '19:34',
    trainType: 'high_speed',
    nonStop: true,
    manual: true,
  }),
]);

function zonedIsoDate(date = new Date(), timeZone = RESULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function moscowDateTime(dateStr, time) {
  return new Date(`${dateStr}T${time}:00+03:00`).toISOString();
}

function createManualIntervals(dateStr) {
  return MANUAL_TRAIN_EVENTS.map((event) => ({
    id: `manual:${event.id}:${dateStr}`,
    start: moscowDateTime(dateStr, event.closureStart),
    end: moscowDateTime(dateStr, event.closureEnd),
    arrival: moscowDateTime(dateStr, event.passTime),
    title: event.title,
    subtitle: event.subtitle,
    number: '',
    stops: '',
    days: '',
    trainType: event.trainType,
    nonStop: event.nonStop,
    manual: event.manual,
  }));
}

function mergeIntervals(apiIntervals, manualIntervals) {
  const seenIds = new Set();
  const seenEvents = new Set();

  return [...apiIntervals, ...manualIntervals]
    .filter((interval) => {
      const eventKey = `${interval.title}|${interval.arrival}`;
      if ((interval.id && seenIds.has(interval.id)) || seenEvents.has(eventKey)) {
        return false;
      }
      if (interval.id) seenIds.add(interval.id);
      seenEvents.add(eventKey);
      return true;
    })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

module.exports = {
  MANUAL_TRAIN_EVENTS,
  RESULT_TZ,
  createManualIntervals,
  mergeIntervals,
  zonedIsoDate,
};
