import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('.env already exists; unchanged');
} else {
  const secret = () => randomBytes(32).toString('hex');
  writeFileSync(
    '.env',
    `POSTGRES_PASSWORD=${secret()}\nINTERNAL_TOKEN=${secret()}\nIP_HASH_SECRET=${secret()}\nADMIN_TOKEN=${secret()}\nSITE_ORIGIN=http://localhost:8088\nCHAOS_ENABLED=true\nBASELINE_RPS=25\n`,
    { mode: 0o600 },
  );
  console.log('Generated ignored .env; secrets were not printed');
}
