// Every test that writes to a database calls this first (owner, 7 Oct 2026): it refuses any database that is not the
// disposable test stack (scripts/test-stack.mts), so a test can never reset, delete from, or fill the main local database,
// which holds the pilot drafts.
import pg from "pg";

/** The main local stack's database port. A test never connects there. */
export const MAIN_DB_PORT = 54322;

export interface DatabaseIdentity {
  port: number | null;
  marker: string | null;
  realCompanies: number;
}

/** Why a database must not be used by a test, or null when it is the disposable test stack. Exported for the unit test. */
export function refusal(url: string, id: DatabaseIdentity): string | null {
  if (id.port === MAIN_DB_PORT) return `refusing ${redact(url)}: port ${MAIN_DB_PORT} is the main local database (start the test stack: node scripts/test-stack.mts start)`;
  if (id.marker !== "company-map-test") return `refusing ${redact(url)}: it has no test_stack.marker, so it is not the disposable test stack`;
  if (id.realCompanies > 0) return `refusing ${redact(url)}: it holds ${id.realCompanies} real (non-synthetic, non-.test) companies`;
  return null;
}

function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

export async function databaseIdentity(url: string): Promise<DatabaseIdentity> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const port = Number((await client.query("select current_setting('port') as port")).rows[0].port);
    const hasMarker = (await client.query("select to_regclass('test_stack.marker') is not null as present")).rows[0].present as boolean;
    const marker = hasMarker ? ((await client.query("select project_id from test_stack.marker limit 1")).rows[0]?.project_id ?? null) : null;
    const realCompanies = Number(
      (await client.query("select count(*) as n from public.company where not is_synthetic and domain not like '%.test' and domain not like '%.example'")).rows[0].n,
    );
    // Inside the container Postgres listens on 5432; the published port is what the URL names.
    const urlPort = Number(new URL(url).port || 5432);
    return { port: port === 5432 ? urlPort : port, marker, realCompanies };
  } finally {
    await client.end();
  }
}

export async function assertDisposableDatabase(url: string): Promise<void> {
  const why = refusal(url, await databaseIdentity(url));
  if (why) throw new Error(why);
}
