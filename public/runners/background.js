// iOS Background Runner (runs in a separate, sandboxed JS context while the app is
// suspended — no DOM, no access to the encrypted DB). It refreshes the forecast and
// re-schedules the morning briefing so it is accurate even if the app wasn't opened.
// The main app hands over only coordinates, the briefing time and the agenda lines.

const MORNING_ID = 1001;

addEventListener('configure', (resolve, reject, details) => {
  try {
    CapacitorKV.set('cfg', JSON.stringify(details || {}));
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('refresh', async (resolve, reject) => {
  try {
    const raw = CapacitorKV.get('cfg');
    const cfg = raw && raw.value ? JSON.parse(raw.value) : null;
    if (!cfg || cfg.lat == null || !cfg.morning) return resolve();

    const [h, m] = cfg.morning.split(':').map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    const day = at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');

    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.lat + '&longitude=' + cfg.lon +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3';
    const res = await fetch(url);
    const j = await res.json();
    const i = j.daily.time.indexOf(day);
    const parts = [];
    if (i >= 0) {
      const pop = j.daily.precipitation_probability_max[i];
      parts.push(Math.round(j.daily.temperature_2m_min[i]) + '–' + Math.round(j.daily.temperature_2m_max[i]) + '°' + (pop >= 40 ? ', rain ' + pop + ' %' : ''));
      if (pop >= 60) parts.push('take an umbrella');
    }
    const agenda = (cfg.agenda || []).find((a) => a.date === day);
    if (agenda && agenda.line) parts.push(agenda.line);

    CapacitorNotifications.schedule([
      { id: MORNING_ID, title: 'Your day at a glance', body: parts.join(' · ') || 'Have a great day.', scheduleAt: at },
    ]);
    resolve();
  } catch (e) {
    reject(e);
  }
});
