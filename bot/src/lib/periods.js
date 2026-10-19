// Spec 008: report periods in the office time zone ('YYYY-MM-DD', inclusive).
export function localDay(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const shift = (k, n) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);

// Previous full Mon–Sun week relative to `today`.
export function lastWeek(today) {
  const wd = new Date(today + 'T12:00:00Z').getUTCDay() || 7; // Mon = 1 … Sun = 7
  const to = shift(today, -wd);                               // last Sunday
  return { from: shift(to, -6), to };
}
// Previous calendar month relative to `today`.
export function lastMonth(today) {
  const first = today.slice(0, 8) + '01', to = shift(first, -1);
  return { from: to.slice(0, 8) + '01', to };
}
