# Changelog

## [Unreleased]

### Added
- CI runs on Firebird 6 (snapshot) with `db-schemas`, so the `schema()` tests run there: the
  schema's own tables and routines, and relationships across schemas with FirebirdREST 0.4.0.

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
