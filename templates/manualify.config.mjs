// manualify config — everything is optional except baseURL. Docs: node_modules/manualify/docs/config.md
export default {
  baseURL: 'http://localhost:3000',          // where your app runs while recording
  viewport: { width: 1920, height: 1080 },  // CSS px the page is laid out at
  scale: 1.5,                                // recorded at viewport × scale → zooms up to ×1.5 stay sharp
  locale: 'en-US',
  readingSpeed: 15,                          // caption chars/second (≈13 for Thai, ≈15 English, ≈8 CJK)

  // Hosts the page may call while recording (your app's host + localhost are always allowed).
  // Anything else is blocked and listed in `check`, so a demo never emails, charges or posts for real.
  allow: [],
  // Canned responses for calls you don't want to make for real (AI, payments, third-party APIs).
  routes: [
    // { url: '**/api/ai/suggest', json: { text: 'Looks good!' } },
  ],

  // Log in before each script (only if the script has `@user` or you set defaultUser).
  // users: { admin: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } },
  // async login(page, user, { baseURL }) {
  //   await page.goto(new URL('/login', baseURL).href);
  //   await page.getByLabel('Email').fill(user.email);
  //   await page.getByLabel('Password').fill(user.password);
  //   await page.getByRole('button', { name: 'Sign in' }).click();
  //   await page.waitForURL('**/dashboard');
  // },

  // What `wait ready` means in your app (default: network idle).
  // async ready(page) { await page.locator('.spinner').waitFor({ state: 'detached' }).catch(() => {}); },

  // Short names for things your UI repeats: `card:"Revenue"`, `menu:"Settings"`.
  macros: {
    // card: (scope, name) => scope.locator('.card').filter({ hasText: name }),
  },

  // Put the app in a known state before a script with `@state <name>` (DB snapshot, seed, API reset…).
  // state: { async restore(name) { /* e.g. execSync(`psql -c "…"`) */ } },

  // Optional title card at the start of every video.
  // cards: { logo: './logo.png', background: '#0f172a', color: '#ffffff' },
  // captions: { size: 34, background: 'rgba(17,24,39,.86)', bold: '#fcd34d' },
  // theme: { accent: '#f5a524' },   // highlight boxes & cursor ripple
};
