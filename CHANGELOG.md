# Changelog

## [Unreleased]

### Added
- `firebirdrest-js gen types`: writes the TypeScript `Database` type of a FirebirdREST API from
  its OpenAPI document, for typed `from()`, `select()`, `insert()`, `update()` and `rpc()`:
  tables, views, foreign keys (one-to-one, composite, many-to-many), computed fields, routines
  with required and default arguments, and every Firebird 6 schema. Needs FirebirdREST 0.7 for
  views, composite keys and argument defaults; older servers get a reduced version. Also
  available as a function, `generateTypes` from `firebirdrest-js/gen`.

## [0.2.0] - 2026-10-26

### Added
- `client.channel(...events)` with `on()`, `subscribe()` and `unsubscribe()`: Firebird events
  streamed by FirebirdREST 0.5.0's `GET /events/<names>`, with automatic reconnection. Exports
  `EventChannel` and the `FirebirdEvent`, `ChannelStatus`, `EventHandler` and `StatusHandler`
  types.
- CI runs on Firebird 6 (snapshot) with `db-schemas`, so the `schema()` tests run there: the
  schema's own tables and routines, and relationships across schemas with FirebirdREST 0.4.0.

### Changed
- Releases publish with npm trusted publishing only; the `NPM_TOKEN` fallback is gone.

## [0.1.3] - 2026-10-24

### Added
- The compatibility suite covers FirebirdREST 0.4.0's batched inserts: 250 rows with mixed
  column sets in one `insert()`, with every row's representation returned.

## [0.1.2] - 2026-10-23

### Fixed
- `package.json` is exported, so tools can read the installed version.

## [0.1.0] - 2026-10-23

### Added
- `createClient(url, token?, options?)` with the supabase-js signature, built on
  `@supabase/postgrest-js`: `from()`, `rpc()`, `schema()`, `auth()`.
- Firebird operators `containing`, `starting` and `similar`, as functions and as filter
  builder methods.
- `file(query, mediaType)` for raw downloads of one value: `Blob` for binary types, string for
  text.
- Options `schema`, `timezone`, `headers` and `fetch`.
- A compatibility suite against the FirebirdREST example database, run in CI on Firebird 3
  and 5.
