// Group name normalisation (mirror of the client function) and the list of allowed groups.
const LOOKALIKE = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };

function normalizeGroup(s) {
  return String(s == null ? '' : s)
    .toUpperCase()
    .replace(/[\s\-_.]+/g, '')
    .replace(/[A-Z]/g, (ch) => LOOKALIKE[ch] || ch)
    .slice(0, 40);
}

function allowedGroups() {
  const raw = process.env.ALLOWED_GROUPS;
  const list = raw && raw.trim()
    ? raw.split(',').map(normalizeGroup).filter(Boolean)
    : ['24ОФ1', '24ОФ2', '24ОФ3', '24ОФ4'];
  return Array.from(new Set(list));
}

module.exports = { normalizeGroup, allowedGroups };
