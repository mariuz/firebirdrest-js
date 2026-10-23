// firebirdrest-js: the supabase-js query API for FirebirdREST.
//
// FirebirdREST speaks PostgREST's URL grammar, so the query builder of
// supabase-js (@supabase/postgrest-js) works against it as it is. This
// package wraps that builder with a FirebirdREST-flavoured client: a
// createClient() with the supabase-js signature, Firebird's extra filter
// operators, raw file downloads, and nothing that Firebird doesn't have
// (no auth, storage or realtime modules).

import {
  PostgrestClient,
  PostgrestFilterBuilder,
  PostgrestBuilder,
  PostgrestQueryBuilder,
  PostgrestTransformBuilder,
  PostgrestError,
} from '@supabase/postgrest-js'
import type {
  PostgrestResponse,
  PostgrestSingleResponse,
  PostgrestMaybeSingleResponse,
} from '@supabase/postgrest-js'

export {
  PostgrestClient,
  PostgrestFilterBuilder,
  PostgrestBuilder,
  PostgrestQueryBuilder,
  PostgrestTransformBuilder,
  PostgrestError,
}
export type { PostgrestResponse, PostgrestSingleResponse, PostgrestMaybeSingleResponse }

export type Fetch = typeof fetch

export interface FirebirdRestClientOptions {
  /** Extra headers sent with every request. */
  headers?: Record<string, string>
  /**
   * SQL schema to read and write (Firebird 6 with `db-schemas`). It is sent as
   * `Accept-Profile` / `Content-Profile`. Omit for the server's default.
   */
  schema?: string
  /**
   * Time zone for `WITH TIME ZONE` values, sent as `Prefer: timezone=...`
   * (Firebird 4+). For example "Europe/Bucharest".
   */
  timezone?: string
  /** A custom fetch, e.g. for Node 16 or for proxies. */
  fetch?: Fetch
}

/**
 * The FirebirdREST client: `from()`, `rpc()` and `schema()` as in supabase-js,
 * plus `auth()` to switch the JWT, and `file()` for raw downloads.
 */
export class FirebirdRestClient<Database = any> extends PostgrestClient<Database> {
  constructor(url: string, options: FirebirdRestClientOptions & { token?: string } = {}) {
    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`
    if (options.timezone) headers['Prefer'] = `timezone=${options.timezone}`
    super(url, { headers, schema: options.schema as any, fetch: options.fetch })
  }

  /**
   * Downloads one value as it is, with the media type you ask for: a
   * `BLOB SUB_TYPE BINARY` as its bytes, a text column as text. The query must
   * select one column and match one row, as for `single()`.
   *
   * ```ts
   * const { data } = await client.file(
   *   client.from('covers').select('image').eq('book_id', 1), 'image/png')
   * ```
   *
   * `data` is a Blob for binary types and a string for `text/*` (and `+json`,
   * `+xml`) types; `application/octet-stream` gives a Blob.
   */
  async file(
    query: PromiseLike<unknown>, // any query built with from() or rpc()
    mediaType: string,
  ): Promise<{ data: Blob | string | null; error: PostgrestError | null; status: number }> {
    const q = query as unknown as BuilderInternals
    const headers = new Headers(q.headers)
    headers.set('Accept', mediaType)
    const fetchFn = q.fetch ?? fetch
    const res = await fetchFn(q.url.toString(), {
      method: q.method,
      headers,
      body: q.body === undefined ? undefined : JSON.stringify(q.body),
      signal: q.signal,
    })
    if (!res.ok) {
      let err: PostgrestError
      try {
        const body = await res.json()
        err = new PostgrestError({
          message: body.message ?? res.statusText,
          details: body.details ?? '',
          hint: body.hint ?? '',
          code: body.code ?? String(res.status),
        })
      } catch {
        err = new PostgrestError({ message: res.statusText, details: '', hint: '', code: String(res.status) })
      }
      return { data: null, error: err, status: res.status }
    }
    if (res.status === 204) return { data: null, error: null, status: 204 }
    const text = /^text\/|\+json$|\+xml$|^application\/(json|xml)$/.test(mediaType.split(';')[0].trim())
    return { data: text ? await res.text() : await res.blob(), error: null, status: res.status }
  }
}

// What PostgrestBuilder keeps for a query. The fields are protected in
// postgrest-js; file() reads them to send the request with another Accept.
interface BuilderInternals {
  url: URL
  headers: Headers
  method: string
  body?: unknown
  signal?: AbortSignal
  fetch?: Fetch
}

/**
 * Creates a client, with the supabase-js signature: the URL of FirebirdREST,
 * an optional JWT (sent as `Authorization: Bearer`), and options.
 *
 * ```ts
 * const client = createClient('http://localhost:3000', token)
 * const { data, error } = await client.from('books').select('title, authors(name)').eq('id', 1).single()
 * ```
 */
export function createClient<Database = any>(
  url: string,
  token?: string | null,
  options: FirebirdRestClientOptions = {},
): FirebirdRestClient<Database> {
  return new FirebirdRestClient<Database>(url, { ...options, token: token ?? undefined })
}

// Firebird's own operators. They work through .filter(column, op, value)
// as well; these helpers name them. The methods on the filter builder are
// available at runtime (JavaScript); TypeScript users get the same through
// the typed functions, since postgrest-js doesn't export the types needed to
// extend the builder's declaration.

/** A query with .filter(), i.e. anything after .select()/.insert().../.rpc(). */
export interface Filterable {
  filter(column: string, operator: string, value: unknown): this
}

/** Firebird `CONTAINING`: case-insensitive substring match. */
export function containing<Q extends Filterable>(query: Q, column: string, value: string): Q {
  return query.filter(column, 'containing', value)
}

/** Firebird `STARTING WITH`: case-sensitive prefix match. */
export function starting<Q extends Filterable>(query: Q, column: string, value: string): Q {
  return query.filter(column, 'starting', value)
}

/** Firebird `SIMILAR TO`: SQL regular expression match. */
export function similar<Q extends Filterable>(query: Q, column: string, pattern: string): Q {
  return query.filter(column, 'similar', pattern)
}

const proto = PostgrestFilterBuilder.prototype as any
proto.containing = function (column: string, value: string) {
  return containing(this, column, value)
}
proto.starting = function (column: string, value: string) {
  return starting(this, column, value)
}
proto.similar = function (column: string, pattern: string) {
  return similar(this, column, pattern)
}
