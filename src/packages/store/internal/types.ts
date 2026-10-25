import type { Person, Surface, TestRecord } from '../../domain';

export interface Store {
  listPeople(): Promise<Person[]>;
  savePerson(p: Person): Promise<void>;
  /** Case-insensitive prefix match on the name, newest first. '' returns all. */
  findSurfaces(prefix: string): Promise<Surface[]>;
  saveSurface(s: Surface): Promise<void>;
  saveTest(t: TestRecord): Promise<void>;
  /** Newest first. */
  listTests(filter?: { personId?: string; surfaceId?: string }): Promise<TestRecord[]>;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
