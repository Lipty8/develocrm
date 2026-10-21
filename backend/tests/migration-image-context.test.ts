import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

test('migration image checks the actual package-script entrypoint during build, before a pilot execution',async()=>{
  const root=new URL('../../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('package.json',root),'utf8')) as {scripts:Record<string,string>};
  assert.equal(manifest.scripts['db:migrate'],'tsx backend/scripts/migrate.ts');
  await access(new URL('backend/scripts/migrate.ts',root));
  const dockerfile=await readFile(new URL('backend/Dockerfile.migrations',root),'utf8');
  assert.match(dockerfile,/COPY backend \.\/backend/);
  assert.match(dockerfile,/RUN test -f backend\/scripts\/migrate\.ts && test -d backend\/migrations/);
  assert.ok(dockerfile.indexOf('RUN test -f')<dockerfile.indexOf('USER node'));
  assert.match(dockerfile,/CMD \["pnpm","run","db:migrate"\]/);
});
