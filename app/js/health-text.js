// Parses text copied by the iOS Shortcut, e.g. "kroki=8 512 kcal=430,5 sen=7,2 tetno=58 waga=87,6 tluszcz=27".
// Every key is optional; numbers may use a comma and spaces as in Polish formatting.
export function parseHealthText(text) {
  const grab = (key, digits = 0) => {
    const m = text.match(new RegExp(`(?:${key})\\s*[=:]\\s*([\\d\\s\\u00a0.,]+)`, 'i'));
    if (!m) return null;
    const v = Number(m[1].replace(/[\s ]/g, '').replace(',', '.'));
    return Number.isFinite(v) && v > 0 ? Math.round(v * 10 ** digits) / 10 ** digits : null;
  };
  const sleepH = grab('sen|sleep', 2);
  return {
    steps: grab('kroki|steps'),
    activeKcal: grab('kcal|energia'),
    sleepMin: sleepH != null ? Math.round(sleepH * 60) : null,
    restingHr: grab('tetno|tętno|hr'),
    weightKg: grab('waga|weight', 1),
    bodyFatPct: grab('tluszcz|tłuszcz|fat', 1),
  };
}
