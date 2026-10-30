const RESULT_TZ = 'Europe/Moscow';

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

function moscowWeekday(dateStr) {
  const date = new Date(`${dateStr}T12:00:00+03:00`);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: RESULT_TZ,
    weekday: 'short',
  }).format(date);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekday];
}

function runsOnDate(event, dateStr) {
  if (event.active === false) return false;
  const days = Array.isArray(event.daysOfWeek) && event.daysOfWeek.length
    ? event.daysOfWeek
    : [1, 2, 3, 4, 5, 6, 7];
  return days.includes(moscowWeekday(dateStr));
}

function createManualIntervals(dateStr, events = []) {
  return events
    .filter((event) => runsOnDate(event, dateStr))
    .map((event) => ({
      id: `manual:${event.id}:${dateStr}`,
      start: moscowDateTime(dateStr, event.closureStart),
      end: moscowDateTime(dateStr, event.closureEnd),
      arrival: moscowDateTime(dateStr, event.passTime),
      title: event.title,
      subtitle: event.subtitle || '',
      number: '',
      stops: '',
      days: '',
      direction: event.direction || 'unspecified',
      trainType: event.trainType || 'other',
      nonStop: event.nonStop !== false,
      manual: true,
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
  RESULT_TZ,
  createManualIntervals,
  mergeIntervals,
  zonedIsoDate,
  moscowWeekday,
  runsOnDate,
};
