# E2E Tests

Playwright covers the core product journey:

1. onboarding
2. first generated week
3. first cart
4. user-controlled supermarket checkout handoff

Local dev auto-authenticates as `dev@souso.local`, so the onboarding spec does
not need OTP email. Before the first run, initialize the local D1 database and
install the browser:

```bash
pnpm init
pnpm exec playwright install chromium
```

Run the suite:

```bash
pnpm test:e2e
```

The checkout assertion stops at the outbound AH/Jumbo cart tab. Souso must never
purchase anything automatically; the user still reviews and checks out at the
supermarket.
