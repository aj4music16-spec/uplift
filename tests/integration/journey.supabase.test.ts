import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineJourney } from '../shared/journey';
import { closeDb, createUser, resetClock, resetData, setClock, TINY_PNG } from '../../supabase/tests/support/harness';

/** The shared journey against the real local Supabase stack (auth, PostgREST, storage, RLS). */
defineJourney('Supabase', async () => {
  await resetData();
  const dir = await mkdtemp(path.join(tmpdir(), 'uplift-evidence-'));
  const file = path.join(dir, 'screenshot.png');
  await writeFile(file, TINY_PNG);
  return {
    async createUser(name) {
      const user = await createUser(name);
      return { id: user.id, name, repo: user.repo };
    },
    setNow: (instant) => setClock(instant),
    evidence: () => ({ uri: file, mime: 'image/png', byteSize: TINY_PNG.length }),
    async teardown() {
      await resetClock();
      await closeDb();
    },
  };
});
