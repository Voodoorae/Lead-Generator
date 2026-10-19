export function londonWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    outreachDue: ['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday) && Number(parts.hour)>=10 && Number(parts.hour)<17,
    due: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && ['10','13','15'].includes(parts.hour),
  };
}

const niches = ['accountants', 'solicitors', 'architects', 'surveyors', 'financial advisers', 'consultancies'];
const cities = ['Glasgow', 'Edinburgh', 'Aberdeen', 'Dundee', 'Inverness', 'Stirling', 'Perth'];
export function dailySearch(date) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  if (!Number.isFinite(day)) throw new Error('Invalid date');
  return { niche: niches[day % niches.length], location: `${cities[Math.floor(day / niches.length) % cities.length]}, Scotland` };
}
export function dailySearches(date) {
  return [0,6,12].map(offset=>dailySearch(new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10)));
}

// Scanner scores are research priorities. They are never sufficient permission
// to send, proof of a vulnerability, or proof of corporate legal status.
export function holdReason(score) {
  if (!score.domain || !score.website) return 'missing-website';
  if (score.status !== 'scored') return 'unreadable-site';
  if (!score.email) return 'missing-email';
  return 'awaiting-corporate-check-crm-dedup-email-validation-and-evidence-review';
}
