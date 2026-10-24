// Draws the contribution calendar as isometric blocks in the portfolio's olive.
// Run by .github/workflows/calendar.yml every day. Needs GITHUB_TOKEN and GITHUB_USER.
import { writeFileSync } from 'node:fs';

const user = process.env.GITHUB_USER;
const out = process.argv[2] ?? 'calendar.svg';

const query = `query($login: String!) { user(login: $login) { contributionsCollection {
  contributionCalendar { totalContributions weeks { contributionDays { contributionCount contributionLevel } } } } } }`;

const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { login: user } }),
});
if (!res.ok) throw new Error(`GitHub API ${res.status}`);
const { data, errors } = await res.json();
if (errors) throw new Error(errors[0].message);
const cal = data.user.contributionsCollection.contributionCalendar;

// top, left side, right side for each level
const COLORS = {
  NONE: ['#9ca3af55', '#9ca3af40', '#9ca3af30'],
  FIRST_QUARTILE: ['#c9c48a', '#aea96f', '#94905c'],
  SECOND_QUARTILE: ['#a39c52', '#8a843f', '#736e33'],
  THIRD_QUARTILE: ['#7d763a', '#68622d', '#555023'],
  FOURTH_QUARTILE: ['#5a5426', '#48431d', '#383415'],
};
// Each week steps right and slightly down, each weekday steps down and left,
// so the year reads left to right as a long low block.
const WK = [10, 3];
const DY = [-4.5, 5];
const MAX_H = 44;
const max = Math.max(1, ...cal.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));

const cubes = cal.weeks.flatMap((w, x) => w.contributionDays.map((d, y) => ({ x, y, ...d })))
  .sort((a, b) => a.x * WK[1] + a.y * DY[1] - (b.x * WK[1] + b.y * DY[1]));

const ox = 7 * -DY[0] + 8;
const oy = MAX_H + 28;
const add = ([a, b], [c, d]) => [a + c, b + d];
const p = (pts) => pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

const shapes = cubes.map(({ x, y, contributionCount: n, contributionLevel: lvl }) => {
  const h = n ? 3 + Math.sqrt(n / max) * MAX_H : 1;
  const [top, left, right] = COLORS[lvl];
  const b = [ox + x * WK[0] + y * DY[0], oy + x * WK[1] + y * DY[1]];
  const bw = add(b, WK), bd = add(b, DY), bwd = add(bw, DY);
  const up = ([a, c]) => [a, c - h];
  return `<polygon fill="${left}" points="${p([up(bd), up(bwd), bwd, bd])}"/>`
    + `<polygon fill="${right}" points="${p([up(bw), up(bwd), bwd, bw])}"/>`
    + `<polygon fill="${top}" points="${p([up(b), up(bw), up(bwd), up(bd)])}"/>`;
}).join('');

const W = ox + cal.weeks.length * WK[0] + 8;
const H = oy + cal.weeks.length * WK[1] + 7 * DY[1] + 8;
const label = `${cal.totalContributions.toLocaleString('en-US')} contributions in the last year`;

writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}">`
  + `<text x="8" y="16" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11" fill="#8b8f96">${label}</text>`
  + `${shapes}</svg>\n`);
console.log(`${out}: ${label}`);
