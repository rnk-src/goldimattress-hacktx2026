import { readFileSync } from 'node:fs';
import type { Recording } from '../../domain';
import { parseRecording } from '../../sensors';

/** Reads `fixtures/<name>.json` next to the testkit package and validates it with `parseRecording`. */
export function loadFixture(name: string): Recording {
  const url = new URL(`../fixtures/${name}.json`, import.meta.url);
  let text: string;
  try {
    text = readFileSync(url, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    throw new Error(`Fixture '${name}' not found at src/packages/testkit/fixtures/${name}.json`, { cause: e });
  }
  return parseRecording(JSON.parse(text));
}
