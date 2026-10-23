# firebirdrest-js

The [supabase-js](https://supabase.com/docs/reference/javascript) query API for
[FirebirdREST](https://github.com/mariuz/firebirdrest): `from()`, `select()`, filters, embedding,
`rpc()`, inserts, upserts, counts, and the rest, against a Firebird database.

FirebirdREST speaks PostgREST's URL grammar, so this package is a thin layer over
[`@supabase/postgrest-js`](https://github.com/supabase/postgrest-js), the query builder inside
supabase-js, plus what Firebird adds: its own filter operators, raw file downloads and time zone
handling. There is no auth, storage or realtime module: FirebirdREST authenticates with JWTs
you issue, and Firebird has none of the rest.

```sh
npm install firebirdrest-js
```

```ts
import { createClient } from 'firebirdrest-js'

const client = createClient('http://localhost:3000', token) // token: a JWT, or omit for anonymous

const { data, error } = await client
  .from('books')
  .select('title, price, author:authors(name), tags(name)')
  .eq('in_stock', true)
  .order('price', { ascending: false })
  .limit(10)
```

Works in Node 18+, Deno, Bun and browsers (anything with `fetch`).

## What works

Everything postgrest-js offers that FirebirdREST implements, checked by the
[compatibility suite](test/client.test.ts) in CI against the FirebirdREST example database:

| | |
|---|---|
| Reads | `select` with aliases, casts, embedding (to-one, to-many, many-to-many, `!inner`), aggregates (`count()`, `sum()`...), computed fields |
| Filters | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `not`, `or`, `match`, `filter`, filters on embedded resources |
| Shaping | `order` (including by an embedded column), `limit`, `range`, `single`, `maybeSingle`, `csv`, `explain`, `abortSignal` |
| Counts | `{ count: 'exact' \| 'planned' \| 'estimated', head: true }` |
| Writes | `insert` (one or many), `upsert` with `onConflict`, `update`, `delete`, `.select()` for the representation |
| RPC | `rpc(name, args, { get: true })` for functions, selectable procedures with `.select().order()...`, package routines (`'catalog.book_count'`) |
| Schemas | `client.schema('inventory')` on Firebird 6 with `db-schemas` |
| Errors | `{ code, message, details, hint }` as in supabase-js; `code` is an `FBRST...` code or Firebird's SQLSTATE |

Not available, because Firebird has no such types: `contains`, `containedBy`, `overlaps`,
`textSearch`, range and JSON operators. See
[Differences from PostgREST](https://mariuz.github.io/firebirdrest/postgrest/).

## Firebird's operators

`CONTAINING` (case-insensitive substring), `STARTING WITH` and `SIMILAR TO` are available as
functions, and as methods for JavaScript callers:

```ts
import { createClient, containing, starting, similar } from 'firebirdrest-js'

const q = client.from('books').select('title')
await containing(q, 'title', 'gods')        // title CONTAINING 'gods'
await starting(q, 'title', 'The')           // title STARTING WITH 'The'
await similar(q, 'title', '(A|The) %')      // title SIMILAR TO '(A|The) %'

await client.from('books').select('title').containing('title', 'gods') // JavaScript
await client.from('books').select('title').filter('title', 'containing', 'gods') // either
```

## Files and single values

`file()` sends a query with the `Accept` type you choose and returns the one value as it is: a
`Blob` for binary types, a string for `text/*`. The query must select one column and match one
row.

```ts
const { data } = await client.file(
  client.from('covers').select('image').eq('book_id', 1), 'image/png')
// data: Blob with the PNG bytes

const { data: title } = await client.file(
  client.from('books').select('title').eq('id', 1), 'text/plain')
```

In JSON responses, binary columns are base64 strings, as FirebirdREST sends them.

## Options

```ts
const client = createClient(url, token, {
  headers: { 'X-Request-Id': '...' },  // extra headers for every request
  schema: 'inventory',                  // Firebird 6 SQL schema (Accept-Profile / Content-Profile)
  timezone: 'Europe/Bucharest',         // Prefer: timezone= for WITH TIME ZONE values (Firebird 4+)
  fetch: myFetch,                       // custom fetch
})
client.auth(newToken) // switch the JWT later
```

## Tests

The suite runs against a FirebirdREST server with the
[bookstore example](https://github.com/mariuz/firebirdrest/blob/main/examples/bookstore.sql):

```sh
FIREBIRDREST_URL=http://localhost:3000 \
FIREBIRDREST_JWT_SECRET=reallyreallyreallyreallyverysafe1234 npm test
```

Without `FIREBIRDREST_JWT_SECRET` the write tests are skipped. CI starts Firebird and
FirebirdREST in Docker (see `.github/workflows/ci.yml`).

## License

MIT.
