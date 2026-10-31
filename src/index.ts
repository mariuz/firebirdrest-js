// firebirdrest-js: the supabase-js query API for FirebirdREST.
//
// FirebirdREST speaks PostgREST's URL grammar, so the query builder of
// supabase-js (@supabase/postgrest-js) works against it as it is. This
// package wraps that builder with a FirebirdREST-flavoured client: a
// createClient() with the supabase-js signature, Firebird's extra filter
// operators, raw file downloads, and channels for Firebird events (what
// Supabase Realtime does with a separate service, FirebirdREST streams
// itself). No auth or storage modules: Firebird has nothing to back them.

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
  /**
   * A channel for Firebird events (`db-events` on the server): the names to
   * listen for, streamed by `GET /events/<names>`. Register handlers with
   * `on()` and start with `subscribe()`.
   */
  channel(...events: string[]): EventChannel {
    if (events.length === 0) throw new Error('channel() needs at least one event name')
    const base = (this as any).url as string | URL
    const url = String(base).replace(/\/$/, '') + '/events/' + events.map(encodeURIComponent).join(',')
    const headers = new Headers((this as any).headers)
    headers.delete('Accept')
    headers.set('Accept', 'text/event-stream')
    return new EventChannel(url, headers, ((this as any).fetch as Fetch | undefined) ?? fetch)
  }

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

/** A Firebird event notification: the name, and how many posts it merges. */
export interface FirebirdEvent {
  name: string
  count: number
  /** The message's position in the stream. */
  id?: string
}

export type ChannelStatus = 'open' | 'closed' | 'error'
export type EventHandler = (event: FirebirdEvent) => void
export type StatusHandler = (status: ChannelStatus, error?: Error) => void
/** Called with the server's reason when notifications may have been missed. */
export type ResetHandler = (reason: string) => void

/**
 * A subscription to Firebird events, streamed by `GET /events/<names>` as
 * Server-Sent Events. Build it with `client.channel(...)`, register handlers
 * with `on()`, start with `subscribe()`, stop with `unsubscribe()`.
 *
 * ```ts
 * const channel = client.channel('order_placed', 'stock_changed')
 *   .on('order_placed', (e) => refreshOrders())
 *   .on('*', (e) => console.log(e.name, e.count))
 *   .subscribe((status) => console.log(status))
 * ```
 *
 * While the server is unreachable the channel reconnects with a growing
 * delay (1 s to 30 s), sending the id of the last notification it saw so
 * the server replays what was missed (FirebirdREST 0.8+). When the server
 * can't know what was missed (it restarted, or the client was away too
 * long) the `onReset` handlers are called: reload what you show. It stops
 * by itself when the server refuses the subscription (401, 403, 404):
 * reconnecting would not help.
 */
export class EventChannel {
  private handlers = new Map<string, EventHandler[]>()
  private resetHandlers: ResetHandler[] = []
  private lastId: string | undefined
  private controller: AbortController | null = null
  private running = false
  private status: ChannelStatus = 'closed'
  private onStatus: StatusHandler | null = null

  constructor(
    private readonly url: string,
    private readonly headers: Headers,
    private readonly fetchFn: Fetch,
  ) {}

  /** Registers a handler for one event name, or `'*'` for every event of the channel. */
  on(event: string, handler: EventHandler): this {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return this
  }

  /**
   * Registers a handler for resets: the server says notifications may have
   * been missed (it restarted, the client was away too long, the stream fell
   * behind), so whatever the events keep up to date should be read again.
   */
  onReset(handler: ResetHandler): this {
    this.resetHandlers.push(handler)
    return this
  }

  /** The id of the last notification received, sent as Last-Event-ID on reconnect. */
  get lastEventId(): string | undefined {
    return this.lastId
  }

  /** Opens the stream. The callback hears `open`, `error` (with the cause) and `closed`. */
  subscribe(onStatus?: StatusHandler): this {
    if (this.running) return this
    this.running = true
    this.onStatus = onStatus ?? null
    void this.run()
    return this
  }

  /** Closes the stream; the status callback hears `closed`. */
  unsubscribe(): void {
    if (!this.running) return
    this.running = false
    this.controller?.abort()
  }

  /** `open` while the stream is connected, `error` while reconnecting, `closed` otherwise. */
  get state(): ChannelStatus {
    return this.status
  }

  private setStatus(status: ChannelStatus, error?: Error) {
    this.status = status
    this.onStatus?.(status, error)
  }

  private dispatch(event: FirebirdEvent) {
    for (const h of this.handlers.get(event.name) ?? []) h(event)
    for (const h of this.handlers.get('*') ?? []) h(event)
  }

  private async run() {
    let attempt = 0
    while (this.running) {
      this.controller = new AbortController()
      try {
        const headers = new Headers(this.headers)
        if (this.lastId) headers.set('Last-Event-ID', this.lastId)
        const res = await this.fetchFn(this.url, {
          headers,
          signal: this.controller.signal,
        })
        if (!res.ok || !res.body) {
          const err = await errorOf(res)
          if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 405) {
            // the subscription itself is refused: no point in retrying
            this.running = false
            this.setStatus('error', err)
            break
          }
          throw err
        }
        attempt = 0
        this.setStatus('open')
        await this.read(res.body)
        if (this.running) throw new Error('the event stream ended')
      } catch (e) {
        if (this.running) this.setStatus('error', e instanceof Error ? e : new Error(String(e)))
      }
      if (!this.running) break
      attempt++
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 30000)))
    }
    this.controller = null
    this.setStatus('closed')
  }

  /** Reads the stream and dispatches one message per blank-line-terminated block. */
  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let event = ''
    let data = ''
    let id: string | undefined
    const flush = () => {
      if (event === 'error') {
        let message = data
        try {
          message = JSON.parse(data).message ?? data
        } catch {}
        this.setStatus('error', new Error(message))
      } else if (event === 'reset') {
        let reason = data
        try {
          reason = JSON.parse(data).reason ?? data
        } catch {}
        for (const h of this.resetHandlers) h(reason)
      } else if (event && data) {
        let parsed: FirebirdEvent | null = null
        try {
          parsed = JSON.parse(data)
        } catch {}
        if (parsed) {
          if (id) this.lastId = id
          this.dispatch({ ...parsed, id })
        }
      }
      event = ''
      data = ''
      id = undefined
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line === '') {
          flush()
        } else if (line.startsWith(':')) {
          // a comment: keepalive, or a note from the server
        } else {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') event = value
          else if (field === 'data') data = data ? data + '\n' + value : value
          else if (field === 'id') id = value
        }
      }
    }
  }
}

async function errorOf(res: Response): Promise<Error> {
  try {
    const body = await res.json()
    return new PostgrestError({
      message: body.message ?? res.statusText,
      details: body.details ?? '',
      hint: body.hint ?? '',
      code: body.code ?? String(res.status),
    })
  } catch {
    return new PostgrestError({ message: res.statusText, details: '', hint: '', code: String(res.status) })
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
