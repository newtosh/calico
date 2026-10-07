## What and why

## How I tested it

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally
- [ ] Contract tests unchanged (or the contract change is intended and called out above)
- [ ] No secrets in logs, fixtures, or screenshots
- [ ] New runtime dependency? Reason given above

### UI changes only

- [ ] Uses DESIGN.md tokens, no inline styles, no new colors
- [ ] Every control reachable by keyboard, focus ring visible
- [ ] Buttons and inputs have labels a screen reader can read
- [ ] Loading and error states say what is happening and what to do
- [ ] Numbers use tabular figures; long text truncates instead of wrapping rows
- [ ] Works with `prefers-reduced-motion`
- [ ] Impeccable `/audit` and ui-skills `baseline-ui` / `fixing-accessibility` run, findings handled
