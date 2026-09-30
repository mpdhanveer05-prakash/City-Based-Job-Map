# Company Map: application code

This is the Next.js 16 app. The plan, specs, and working rules are one level up: start with [../CLAUDE.md](../CLAUDE.md) and [../plan.md](../plan.md).

```bash
cp .env.example .env.local        # placeholders only; never commit real values
npm ci
npx playwright install chromium   # once, for npm run test:e2e
npm run dev                       # http://localhost:3000, palette review at /dev/tokens
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

Colours, type, and layout follow [../docs/design-system.md](../docs/design-system.md). Every colour is a token in `app/globals.css`.
