// Enums kept in sync with the web app (public/index.html): STATUS, MOODS, DEPT_COLORS.
export const STATUS = [
  { key: 'office',   n: 'В офісі',        icon: '🏢' },
  { key: 'remote',   n: 'Працюю з дому',  icon: '🏠' },
  { key: 'absent',   n: 'Немає в офісі',  icon: '🚶' },
  { key: 'sick',     n: 'Хворію',         icon: '🤒' },
  { key: 'vacation', n: 'У відпустці',    icon: '🌴' },
];

export const MOODS = [
  { key: 'great',    n: 'Чудовий',    e: '😄' },
  { key: 'good',     n: 'Гарний',     e: '🙂' },
  { key: 'ok',       n: 'Нормально',  e: '😐' },
  { key: 'tired',    n: 'Втомлений',  e: '😴' },
  { key: 'stressed', n: 'У стресі',   e: '😫' },
];

export const COLORS = ['#E2001A', '#F28C28', '#F2C036', '#5DBE7C', '#3EA8C9', '#5B76E6', '#A36BE0', '#E06CA6'];

export const statusName = (k) => (STATUS.find((s) => s.key === k) || STATUS[0]);
export const moodName = (k) => (MOODS.find((m) => m.key === k) || MOODS[1]);
