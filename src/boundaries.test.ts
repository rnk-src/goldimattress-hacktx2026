import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** Runs dependency-cruiser with the repo config on a throwaway source tree; returns the rules violated. */
function violatedRules(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'goldi-deps-'));
  tmpDirs.push(dir);
  cpSync(join(root, 'tsconfig.json'), join(dir, 'tsconfig.json'));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  let json: string;
  try {
    json = execFileSync(
      process.execPath,
      [
        join(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs'),
        'src',
        '--config',
        join(root, '.dependency-cruiser.cjs'),
        '--output-type',
        'json',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
  } catch (e) {
    // depcruise exits non-zero when it finds violations; the report is still on stdout.
    json = (e as { stdout: string }).stdout;
  }
  const report = JSON.parse(json) as { summary: { violations: { rule: { name: string } }[] } };
  return report.summary.violations.map((v) => v.rule.name);
}

const empty = 'export {};\n';
const pkg = (name: string, extra: Record<string, string> = {}) => ({
  [`src/packages/${name}/index.ts`]: empty,
  ...extra,
});

describe('package import boundaries', () => {
  it('allows an allowed import through index.ts', () => {
    expect(
      violatedRules({
        ...pkg('signal'),
        ...pkg('domain'),
        'src/packages/signal/a.ts': "import '../domain';\n",
      }),
    ).toEqual([]);
  });

  it('rejects signal importing sensors', () => {
    expect(
      violatedRules({
        ...pkg('signal', { 'src/packages/signal/a.ts': "import '../sensors';\n" }),
        ...pkg('sensors'),
      }),
    ).toContain('signal-imports');
  });

  it('rejects a type-only import from a forbidden package', () => {
    expect(
      violatedRules({
        ...pkg('domain', { 'src/packages/domain/a.ts': "import type {} from '../signal';\n" }),
        ...pkg('signal'),
      }),
    ).toContain('domain-imports');
  });

  it('rejects reaching past a package index into a file', () => {
    expect(
      violatedRules({
        ...pkg('app', { 'src/packages/app/a.ts': "import '../signal/features';\n" }),
        ...pkg('signal', { 'src/packages/signal/features.ts': empty }),
      }),
    ).toContain('index-only');
  });

  it('rejects reaching into another package internal folder', () => {
    expect(
      violatedRules({
        ...pkg('app', { 'src/packages/app/a.ts': "import '../store/internal/codec';\n" }),
        ...pkg('store', { 'src/packages/store/internal/codec.ts': empty }),
      }),
    ).toContain('index-only');
  });

  it('allows a package to use its own internal folder', () => {
    expect(
      violatedRules({
        ...pkg('store', { 'src/packages/store/a.ts': "import './internal/codec';\n" }),
        'src/packages/store/internal/codec.ts': empty,
      }),
    ).toEqual([]);
  });

  it('rejects the composition root bypassing a package index', () => {
    expect(
      violatedRules({
        'src/main.ts': "import './packages/signal/features';\n",
        ...pkg('signal', { 'src/packages/signal/features.ts': empty }),
      }),
    ).toContain('index-only');
  });

  it('rejects any top-level file bypassing a package index', () => {
    expect(
      violatedRules({
        'src/wiring.ts': "import './packages/signal/features';\n",
        ...pkg('signal', { 'src/packages/signal/features.ts': empty }),
      }),
    ).toContain('index-only');
  });

  it('allows a top-level file importing a package index', () => {
    expect(
      violatedRules({ 'src/wiring.ts': "import './packages/signal';\n", ...pkg('signal') }),
    ).toEqual([]);
  });

  it('rejects a non-test file importing testkit', () => {
    expect(
      violatedRules({
        ...pkg('app', { 'src/packages/app/a.ts': "import '../testkit';\n" }),
        ...pkg('testkit'),
      }),
    ).toContain('testkit-tests-only');
  });

  it('allows a test file importing testkit', () => {
    expect(
      violatedRules({
        ...pkg('app', { 'src/packages/app/a.test.ts': "import '../testkit';\n" }),
        ...pkg('testkit'),
      }),
    ).toEqual([]);
  });
});

describe('testkit in pure package tests', () => {
  it.each(['signal', 'session'])('allows a %s test file importing testkit', (name) => {
    expect(
      violatedRules({
        ...pkg(name, { [`src/packages/${name}/a.test.ts`]: "import '../testkit';\n" }),
        ...pkg('testkit'),
      }),
    ).toEqual([]);
  });

  it('still rejects a signal test file importing sensors', () => {
    expect(
      violatedRules({
        ...pkg('signal', { 'src/packages/signal/a.test.ts': "import '../sensors';\n" }),
        ...pkg('sensors'),
      }),
    ).not.toEqual([]);
  });
});

describe('DOM ban in pure packages', () => {
  const eslint = new ESLint({ cwd: root });
  const lint = async (filePath: string, source = 'export const w = window.innerWidth;\n') => {
    const [result] = await eslint.lintText(source, { filePath: join(root, filePath) });
    return result?.messages.map((m) => m.ruleId) ?? [];
  };

  it.each(['domain', 'signal', 'session', 'listings'])('rejects window in %s', async (name) => {
    expect(await lint(`src/packages/${name}/a.ts`)).toContain('no-restricted-globals');
  });

  it.each(['navigator', 'performance', 'localStorage', 'document'])(
    'rejects %s in signal, even where Node also defines it',
    async (name) => {
      expect(await lint('src/packages/signal/a.ts', `export const x = ${name};\n`)).toContain(
        'no-restricted-globals',
      );
    },
  );

  it('rejects fetch in session', async () => {
    expect(await lint('src/packages/session/a.ts', 'export const f = fetch;\n')).toContain(
      'no-restricted-globals',
    );
  });

  it('allows window in app', async () => {
    expect(await lint('src/packages/app/a.ts')).not.toContain('no-restricted-globals');
  });

  it('allows window in a pure package test file', async () => {
    expect(await lint('src/packages/signal/a.test.ts')).not.toContain('no-restricted-globals');
  });
});
