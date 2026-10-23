# Changelog

## [Unreleased]

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
