/**
 * Renders a self-hosted stats card into dist/stats.svg.
 *
 * Exists because the shared github-readme-stats instance returns 503 often
 * enough that the profile shows broken images. This runs inside the same
 * Action, uses only the public API plus GITHUB_TOKEN for rate limit, and
 * commits a plain SVG, so nothing on the profile depends on a third party
 * staying up.
 */

const USER = process.env.GITHUB_USER || "myanptl";
const TOKEN = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${USER}-profile-stats`,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

// Warm ramp shared with the header and the snake. Deliberately not the
// stock language colours, which clash with everything else here.
const RAMP = ["#d97757", "#c98a2b", "#7ea24f", "#b8794a", "#8a7f6d"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const user = await api(`/users/${USER}`);

// Only repos he owns; forks would inflate both stars and language totals.
const repos = [];
for (let page = 1; page <= 4; page++) {
  const batch = await api(`/users/${USER}/repos?per_page=100&type=owner&page=${page}`);
  repos.push(...batch);
  if (batch.length < 100) break;
}
const owned = repos.filter((r) => !r.fork);

// Contributions over the trailing year. Deliberately chosen over stars and
// followers: those are popularity numbers, and for someone who ships steadily
// without marketing the repos they read as weakness rather than signal.
// GITHUB_TOKEN is not guaranteed the scope for this, so it degrades quietly.
async function contributionsPastYear() {
  if (!TOKEN) return null;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions } } } }`,
        variables: { login: USER },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? null;
  } catch {
    return null;
  }
}

const contributions = await contributionsPastYear();

// Byte counts per language beat counting repos: one big TypeScript app should
// outweigh three tiny shell repos.
const bytes = {};
for (const repo of owned) {
  try {
    const langs = await api(`/repos/${USER}/${repo.name}/languages`);
    for (const [lang, n] of Object.entries(langs)) bytes[lang] = (bytes[lang] || 0) + n;
  } catch {
    /* a repo that vanishes mid-run should not fail the card */
  }
}

const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
const top = Object.entries(bytes)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([name, n], i) => ({ name, pct: (n / total) * 100, color: RAMP[i] }));

const W = 520;
const H = 200;
const BAR_X = 26;
const BAR_W = W - BAR_X * 2;

let x = BAR_X;
const segments = top
  .map((l) => {
    const w = (l.pct / 100) * BAR_W;
    const seg = `<rect x="${x.toFixed(1)}" y="126" width="${Math.max(w - 2, 1).toFixed(1)}" height="9" rx="4.5" fill="${l.color}"/>`;
    x += w;
    return seg;
  })
  .join("\n    ");

let lx = BAR_X;
const legend = top
  .map((l) => {
    const item = `<circle cx="${lx + 4}" cy="164" r="4" fill="${l.color}"/>
    <text class="lg" x="${lx + 14}" y="168">${esc(l.name)} ${l.pct.toFixed(0)}%</text>`;
    lx += 22 + esc(l.name).length * 7.4;
    return item;
  })
  .join("\n    ");

// Built as a list so the card still balances if contributions are unavailable.
const stats = [
  ["REPOS", String(user.public_repos)],
  ["LANGUAGES", String(Object.keys(bytes).length)],
  // Labelled "PUBLIC" deliberately. GITHUB_TOKEN only sees public
  // contributions, so this number is lower than the one on the profile graph
  // above it, which includes private repos. An unqualified "CONTRIBUTIONS"
  // reading 328 directly under a graph saying 362 looks like a bug.
  ...(contributions !== null ? [["PUBLIC CONTRIBUTIONS", fmt(contributions)]] : []),
];

const statBlocks = stats
  .map(([label, value], i) => {
    const cx = BAR_X + i * (BAR_W / stats.length);
    return `<text class="num" x="${cx.toFixed(1)}" y="82">${value}</text>
    <text class="lbl" x="${cx.toFixed(1)}" y="102">${label}</text>`;
  })
  .join("\n    ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub stats for ${esc(USER)}">
  <style>
    .n { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    .hd  { font-size: 12px; fill: #d97757; letter-spacing: 2px; }
    .num { font-size: 34px; font-weight: 700; fill: #f2ece2; }
    .lbl { font-size: 11px; fill: #8e8779; letter-spacing: 1.2px; }
    .lg  { font-size: 11px; fill: #a89e8f; }
    .ft  { font-size: 10px; fill: #6f685c; }
  </style>
  <g class="n">
    <rect width="${W}" height="${H}" rx="10" fill="#1c1815" stroke="#2b2521"/>
    <rect x="0" y="0" width="4" height="${H}" rx="2" fill="#d97757"/>

    <text class="hd" x="${BAR_X}" y="42">MYANPTL</text>

    ${statBlocks}

    ${segments}
    ${legend}

    <text class="ft" x="${BAR_X}" y="190">updated ${new Date().toISOString().slice(0, 10)}</text>
  </g>
</svg>
`;

const { mkdir, writeFile } = await import("node:fs/promises");
await mkdir("dist", { recursive: true });
await writeFile("dist/stats.svg", svg);
console.log(
  `stats.svg written: ${user.public_repos} repos, ${Object.keys(bytes).length} languages, ` +
    `contributions=${contributions ?? "unavailable"}`
);
