// Name matching (order-insensitive) ────────────────────────────────────────
// Names are typed by hand, sometimes surname-first ("Тахтаулова Аліна"). An entry
// matches when every one of its words appears in the name, in any order, ignoring
// case and apostrophe variants — so "Руслан Зубар" matches "Зубар Руслан Станіславович".
const words = (s) => String(s || '').toLocaleLowerCase('uk').replace(/[’'ʼ`]/g, '').split(/[\s,]+/).filter(Boolean);
export function nameMatches(name, entry) {
  const have = new Set(words(name)), need = words(entry);
  return need.length > 0 && need.every((w) => have.has(w));
}
