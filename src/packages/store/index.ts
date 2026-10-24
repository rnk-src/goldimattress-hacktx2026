import type { Person, Surface, TestRecord } from '../domain';

export interface Store {
  listPeople(): Promise<Person[]>;
  savePerson(person: Person): Promise<void>;
  findSurfaces(prefix: string): Promise<Surface[]>;
  saveSurface(surface: Surface): Promise<void>;
  saveTest(test: TestRecord): Promise<void>;
  listTests(filter?: { personId?: string; surfaceId?: string }): Promise<TestRecord[]>;
}
