// Same rule as the api (api/src/lib/names.js): every word of the configured name present, in any order.
const words = (s) => String(s || '').toLocaleLowerCase('uk').replace(/[’'ʼ`]/g, '').split(/[\s,]+/).filter(Boolean);
export const nameMatches = (name, entry) => { const have = new Set(words(name)), need = words(entry); return need.length > 0 && need.every((w) => have.has(w)); };
