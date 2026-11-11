import { dateKeyAt, zonedTimeToUtc } from '@/domain/time';

import { PEOPLE, seedInnerCircle, type EvidenceSpec, type PersonKey, type ScenarioResult } from '../scenario/innerCircle';
import type { LocalEvidence } from '../types';
import { DemoBackend } from './DemoBackend';
import { DemoRepository } from './DemoRepository';
import { DemoClock } from './store';

/** URI scheme for drawn (not photographed) sample screenshots. See SyntheticScreenshot. */
export const SYNTHETIC_SCHEME = 'synthetic://screen-time';

export function syntheticEvidence(spec: EvidenceSpec): LocalEvidence {
  const view = spec.view ?? 'day';
  return {
    uri: `${SYNTHETIC_SCHEME}?date=${spec.date}&minutes=${spec.minutes}&view=${view}`,
    mime: 'image/png',
    // Distinct sizes keep the duplicate-file flag meaningful in the demo.
    byteSize: 180_000 + spec.minutes * 37 + (view === 'day' ? 0 : 5_000),
  };
}

export function parseSyntheticEvidence(uri: string): Required<EvidenceSpec> | null {
  if (!uri.startsWith(SYNTHETIC_SCHEME)) return null;
  const query = uri.split('?')[1] ?? '';
  const params = new Map(query.split('&').map((pair) => pair.split('=') as [string, string]));
  const view = params.get('view');
  return {
    date: params.get('date') ?? '',
    minutes: Number(params.get('minutes') ?? 0),
    view: view === 'week' || view === 'nodate' ? view : 'day',
  };
}

export interface Demo {
  backend: DemoBackend;
  scenario: ScenarioResult;
  /** A repository acting as one of the sample people. */
  repositoryFor(person: PersonKey, latencyMs?: number): DemoRepository;
  personName(person: PersonKey): string;
}

/**
 * Builds Demo Mode's data by replaying the sample scenario into a fresh
 * in-memory backend. The demo clock ends at 9:00 on `now`'s calendar day in
 * the given time zone and then keeps ticking, so the same things are due
 * whatever time of day the demo is opened.
 */
export async function createDemo(options: { timeZone: string; now?: Date }): Promise<Demo> {
  const realNow = options.now ?? new Date();
  const today = dateKeyAt(realNow, options.timeZone);
  const clock = new DemoClock(zonedTimeToUtc(today, 9, 0, options.timeZone));
  const backend = new DemoBackend(clock);
  const scenario = await seedInnerCircle({
    timeZone: options.timeZone,
    today,
    async createPerson(_key, name, avatar) {
      const id = backend.createUser(name, avatar, options.timeZone);
      return { id, repo: new DemoRepository(backend, id) };
    },
    async setNow(instant) {
      clock.set(instant);
    },
    evidence: syntheticEvidence,
  });
  return {
    backend,
    scenario,
    repositoryFor: (person, latencyMs = 0) => new DemoRepository(backend, scenario.people[person].id, latencyMs),
    personName: (person) => PEOPLE[person].name,
  };
}
