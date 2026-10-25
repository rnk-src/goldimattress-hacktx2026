import type { Person, RepResult, Routine } from '../../domain';
import type { Store } from '../../store';

export function shortDeviceModel(value: string): string {
  const device = value.trim();
  if (/iPhone/i.test(device)) return 'iPhone';
  if (/iPad/i.test(device)) return 'iPad';
  const androidModel = device.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i)?.[1]?.trim();
  if (androidModel) return androidModel;
  if (/Android/i.test(device)) return 'Android phone';
  if (/Mozilla\//i.test(device)) return 'Web browser';
  return device.slice(0, 40) || 'Unknown device';
}

const fillRep = (rep: RepResult, device: string, startedAt: string): RepResult => ({
  ...rep,
  trace: {
    ...rep.trace,
    device: rep.trace.device || device,
    startedAt: rep.trace.startedAt || startedAt,
  },
});

const fillReferences = (person: Person, device: string, startedAt: string): Person => {
  const references: Person['references'] = {};
  for (const routine of Object.keys(person.references) as Routine[]) {
    const reference = person.references[routine]!;
    references[routine] = {
      ...reference,
      reps: reference.reps.map((rep) => fillRep(rep, device, startedAt)),
    };
  }
  return { ...person, references };
};

export function withRepMetadata(store: Store, device: string, now: () => Date): Store {
  const model = shortDeviceModel(device);
  return {
    listPeople: () => store.listPeople(),
    savePerson: (person) => store.savePerson(fillReferences(person, model, now().toISOString())),
    findSurfaces: (prefix) => store.findSurfaces(prefix),
    saveSurface: (surface) => store.saveSurface(surface),
    saveTest: (record) => {
      const startedAt = now().toISOString();
      return store.saveTest({
        ...record,
        device: model,
        reps: record.reps.map((rep) => fillRep(rep, model, startedAt)),
      });
    },
    listTests: (filter) => store.listTests(filter),
  };
}
