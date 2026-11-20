'use strict';
const ONLINE_WINDOW_MS = 30000;
function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function parseTelemetry(query, now = new Date()) {
  const temperature = numberOrNull(query.temp_sensor ?? query.temp_sersor);
  const ph = numberOrNull(query.ph_sensor);
  const oxygen = numberOrNull(query.do_sensor);
  const mode = numberOrNull(query.mode ?? 12);
  const seconds = numberOrNull(query.seconds_until_feed);
  const queueAge = numberOrNull(query.sample_age_ms ?? 0);
  if ([temperature, ph, oxygen].some(value => value === null)) {
    throw new Error('temp_sensor, ph_sensor and do_sensor must be finite numbers');
  }
  if (![6, 8, 12].includes(mode)) throw new Error('mode must be 6, 8 or 12');
  if (query.seconds_until_feed !== undefined &&
      (seconds === null || !Number.isInteger(seconds) || seconds < 0 || seconds > 31536000)) {
    throw new Error('seconds_until_feed must be a nonnegative integer up to 31536000');
  }
  if (queueAge === null || queueAge < 0 || queueAge > 300000) {
    throw new Error('sample_age_ms must be between 0 and 300000');
  }
  const sampleAt = new Date(now.getTime() - queueAge);
  return {
    temp_sensor: String(temperature), temp_sersor: String(temperature),
    ph_sensor: String(ph), do_sensor: String(oxygen), mode,
    seconds_until_feed: seconds,
    sample_at: sampleAt,
    next_feed_at: seconds === null ? null : new Date(sampleAt.getTime() + seconds * 1000),
    feeding: query.feeding === undefined ? null : ['1', 'true'].includes(String(query.feeding)),
    priming: ['1', 'true'].includes(String(query.priming)),
    water_change_active: ['1', 'true'].includes(String(query.water_change_active)),
    date_created: now
  };
}
function sensorResponse(latest, now = new Date()) {
  const empty = {
    temp: null, ph: null, do: null, tempStatus: 'NO DATA', phStatus: 'NO DATA',
    aerator_status: null, mode: null, seconds_until_feed: null,
    next_feed_at: null, feeding: null, priming: false, water_change_active: false,
    online: false, date_created: null, sample_at: null,
    server_now: now.toISOString(), online_window_ms: ONLINE_WINDOW_MS
  };
  if (!latest) return empty;
  const sampleAt = new Date(latest.sample_at || latest.date_created);
  const sampleMs = sampleAt.getTime();
  const seconds = numberOrNull(latest.seconds_until_feed);
  const deadlineMs = latest.next_feed_at ? new Date(latest.next_feed_at).getTime()
    : seconds === null ? NaN : sampleMs + seconds * 1000;
  return {
    ...empty,
    temp: numberOrNull(latest.temp_sensor ?? latest.temp_sersor),
    ph: numberOrNull(latest.ph_sensor), do: numberOrNull(latest.do_sensor),
    tempStatus: latest.temp_status, phStatus: latest.ph_status,
    aerator_status: latest.aerator_status, mode: latest.mode,
    seconds_until_feed: Number.isFinite(deadlineMs)
      ? Math.max(0, Math.ceil((deadlineMs - now.getTime()) / 1000)) : null,
    next_feed_at: Number.isFinite(deadlineMs) ? new Date(deadlineMs).toISOString() : null,
    feeding: latest.feeding ?? null, priming: latest.priming ?? false,
    water_change_active: latest.water_change_active ?? false,
    online: Number.isFinite(sampleMs) && now.getTime() - sampleMs >= 0 && now.getTime() - sampleMs < ONLINE_WINDOW_MS,
    date_created: latest.date_created,
    sample_at: Number.isFinite(sampleMs) ? sampleAt.toISOString() : null
  };
}
module.exports = { parseTelemetry, sensorResponse, ONLINE_WINDOW_MS };