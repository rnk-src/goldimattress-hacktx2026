# Agent instructions (Codex and other coding agents)

Read `CLAUDE.md` first. It holds the project design, protocol and git workflow.

## Test-driven development
Follow this loop for every feature, bug fix and behavior change.

1. Write one failing test for one behavior. Give it a name that states the behavior.
2. Run that test file. Confirm it fails because the feature is missing, not because of a typo or error.
3. Write the minimal code that passes the test. Add nothing else.
4. Run the test file. Confirm it passes.
5. Refactor. Keep the tests green. Add no new behavior.
6. Repeat with the next failing test.

Rules:
- Write no production code without a failing test first.
- If you wrote code before its test, delete the code. Write the test. Rewrite the code from the test.
- If a new test passes at once, it tests existing behavior. Fix the test.
- Test through a package's `index.ts`. Do not test internals, except the numeric helpers inside `signal`.
- Do not mock modules. Pass small in-memory fakes through the injected dependencies (`MotionEnv`, `StorageLike`, `CoachEnv`, `AppDeps`).
- Feed `signal` and `session` synthetic traces with known answers.
- Exempt from test-first: the types-only `domain` package, and config, CI and deploy files.

## Before you say a task is done
- Run `npm run check`. It runs typecheck, lint, Vitest and dependency-cruiser. Use Node 22 or newer.
- Report any failing test by name, even if you did not cause it.
- Do not claim success if `npm run check` fails.

## Boundaries
- `npm run check` enforces the import rules. Do not weaken a rule to make code pass.
- Import another package only through its `index.ts`.
- Do not touch hardware, flash firmware or open serial ports.

## UI work and design tools
Design skills and tools (a taste or design-review skill, a `DESIGN.md` design system, an image-to-Three.js tool) are allowed. They must obey these limits.
- Put all UI code in the `app` package. Keep `signal`, `session` and `domain` free of UI code.
- Use vanilla TypeScript and Vite. Do not add a UI framework (React, Vue, Svelte) or a CSS framework, even if a tool suggests one.
- Add a runtime dependency (for example `three`) only after the lead agrees. Check its size first. The app must load fast on a phone and work offline.
- If you add Three.js, load it lazily from `app`. Keep it out of the sensing path.
- Keep one design system. Put it in a single `DESIGN.md` at the repo root. Do not copy a real brand's name, logo or assets.
- Do not edit `CLAUDE.md` to record tool settings or personal preferences.
- UI code follows the same test-first loop. Test screens through `startApp` with the injected fakes. Keep visual polish out of the tests.
- The UI must still show coaching text for every voice or beep cue. Voice is not the only channel.
- Do not commit screenshots or reference images unless the lead asks. Do not push to the remote.
