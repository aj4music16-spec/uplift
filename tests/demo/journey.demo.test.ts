import { DemoBackend } from '@/data/demo/DemoBackend';
import { DemoRepository } from '@/data/demo/DemoRepository';
import { DemoClock } from '@/data/demo/store';

import { defineJourney } from '../shared/journey';

/** The shared journey against the in-memory demo backend: no network, fixed clock. */
defineJourney('Demo Mode', async () => {
  const backend = new DemoBackend(new DemoClock(new Date('2026-03-02T15:00:00Z')));
  let face = 0;
  return {
    async createUser(name) {
      face += 1;
      const id = backend.createUser(name, { color: 'sun', face: face % 10 }, 'America/New_York');
      return { id, name, repo: new DemoRepository(backend, id) };
    },
    async setNow(instant) {
      backend.clock.set(instant);
    },
    evidence: () => ({ uri: 'fixture://synthetic-screenshot.png', mime: 'image/png', byteSize: 2048 }),
    async teardown() {},
  };
});
