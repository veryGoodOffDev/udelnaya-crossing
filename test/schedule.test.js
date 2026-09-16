const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createManualIntervals,
  mergeIntervals,
  zonedIsoDate,
} = require('../schedule');

test('creates the Lastochka closure in Moscow time with manual metadata', () => {
  const [event] = createManualIntervals('2026-09-16');

  assert.deepEqual(
    { start: event.start, arrival: event.arrival, end: event.end },
    {
      start: '2026-09-16T16:29:00.000Z',
      arrival: '2026-09-16T16:30:00.000Z',
      end: '2026-09-16T16:34:00.000Z',
    }
  );
  assert.equal(event.manual, true);
  assert.equal(event.nonStop, true);
  assert.equal(event.trainType, 'high_speed');
});

test('manual closure is active at its boundaries and inactive immediately after', () => {
  const [event] = createManualIntervals('2026-09-16');
  const isClosed = (iso) => {
    const now = new Date(iso);
    return new Date(event.start) <= now && now <= new Date(event.end);
  };

  assert.equal(isClosed('2026-09-16T16:29:00.000Z'), true);
  assert.equal(isClosed('2026-09-16T16:30:00.000Z'), true);
  assert.equal(isClosed('2026-09-16T16:34:00.000Z'), true);
  assert.equal(isClosed('2026-09-16T16:34:00.001Z'), false);
});

test('merges, sorts and removes duplicate schedule events', () => {
  const manual = createManualIntervals('2026-09-16');
  const api = [{
    id: 'api:later',
    start: '2026-09-16T18:00:00.000Z',
    arrival: '2026-09-16T18:02:00.000Z',
    end: '2026-09-16T18:06:00.000Z',
    title: 'Электропоезд',
  }];
  const merged = mergeIntervals(api, [...manual, ...manual]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, 'Ласточка');
});

test('does not duplicate a manual event if an equivalent API event appears', () => {
  const manual = createManualIntervals('2026-09-16');
  const apiEquivalent = { ...manual[0], id: undefined, manual: false };

  assert.equal(mergeIntervals([apiEquivalent], manual).length, 1);
});

test('uses Moscow calendar date near the UTC day boundary', () => {
  assert.equal(zonedIsoDate(new Date('2026-09-16T22:30:00.000Z')), '2026-09-17');
});
