// Compatibility suite: the supabase-js query API against FirebirdREST.
//
// It needs a FirebirdREST server with the bookstore example database
// (examples/bookstore.sql in the FirebirdREST repository):
//
//   FIREBIRDREST_URL=http://localhost:3000 FIREBIRDREST_JWT_SECRET=... npm test
//
// The JWT secret signs a web_user token for the write tests; without it they
// are skipped.

import { createHmac } from 'node:crypto'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createClient, containing, starting, similar } from '../src/index'

const url = process.env.FIREBIRDREST_URL ?? 'http://localhost:3000'
const secret = process.env.FIREBIRDREST_JWT_SECRET

function hs256(claims: Record<string, unknown>, key: string): string {
  const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(claims))
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

const anon = createClient(url)
const user = secret ? createClient(url, hs256({ role: 'web_user', sub: 'ana@example.com' }, secret)) : null
const writes = user ? it : it.skip

beforeAll(async () => {
  const res = await fetch(url + '/').catch(() => null)
  if (!res || !res.ok) throw new Error(`no FirebirdREST at ${url}; set FIREBIRDREST_URL`)
})

describe('reads', () => {
  it('select with order and limit', async () => {
    const { data, error, status } = await anon.from('books').select('id, title').order('id').limit(2)
    expect(error).toBeNull()
    expect(status).toBe(200)
    expect(data).toEqual([
      { id: 1, title: 'Guards! Guards!' },
      { id: 2, title: 'Small Gods' },
    ])
  })

  it('embedding to-one, to-many and many-to-many', async () => {
    const { data, error } = await anon
      .from('books')
      .select('title, author:authors(name), tags(name)')
      .eq('id', 1)
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({
      title: 'Guards! Guards!',
      author: { name: 'Terry Pratchett' },
      tags: expect.arrayContaining([{ name: 'fantasy' }, { name: 'humour' }]),
    })
    const { data: authors } = await anon.from('authors').select('name, books(title)').eq('id', 3).single()
    expect(authors).toEqual({ name: 'Stanislaw Lem', books: [{ title: 'Solaris' }] })
  })

  it('filters', async () => {
    const ids = async (q: PromiseLike<{ data: any; error: any }>) => {
      const { data, error } = await q
      expect(error).toBeNull()
      return (data as { id: number }[]).map((r) => r.id)
    }
    const books = () => anon.from('books').select('id').order('id')
    expect(await ids(books().eq('id', 3))).toEqual([3])
    expect(await ids(books().neq('id', 3))).toEqual([1, 2, 4, 5])
    expect(await ids(books().gt('price', 10))).toEqual([3, 5])
    expect(await ids(books().gte('price', 10.4))).toEqual([3, 5])
    expect(await ids(books().lt('published', 1970))).toEqual([4, 5])
    expect(await ids(books().lte('published', 1968))).toEqual([4, 5])
    expect(await ids(books().like('title', '%Gods%'))).toEqual([2])
    expect(await ids(books().ilike('title', '%gods%'))).toEqual([2])
    expect(await ids(books().is('in_stock', false))).toEqual([5])
    expect(await ids(books().in('id', [2, 4]))).toEqual([2, 4])
    expect(await ids(books().not('id', 'in', '(1,2,3)'))).toEqual([4, 5])
    expect(await ids(books().or('id.eq.1,id.eq.5'))).toEqual([1, 5])
    expect(await ids(books().match({ author_id: 2, in_stock: true }))).toEqual([3, 4])
    expect(await ids(books().filter('title', 'starting', 'The'))).toEqual([3])
    // Firebird's own operators
    expect(await ids(containing(books(), 'title', 'GODS'))).toEqual([2])
    expect(await ids(starting(books(), 'title', 'A '))).toEqual([4])
    expect(await ids(similar(books(), 'title', 'S%'))).toEqual([2, 5])
    // the same as methods, for JavaScript callers
    expect(await ids((books() as any).containing('title', 'GODS'))).toEqual([2])
    // filters on an embedded resource, and inner joins
    expect(await ids(anon.from('books').select('id, tags!inner(name)').eq('tags.name', 'science-fiction').order('id'))).toEqual([3, 5])
  })

  it('ordering, including by an embedded column', async () => {
    const { data } = await anon.from('books').select('title').order('price', { ascending: false }).limit(1)
    expect(data).toEqual([{ title: 'The Dispossessed' }])
    const { data: byAuthor, error } = await anon
      .from('books')
      .select('title, authors(name)')
      .order('authors(name)', { ascending: false })
      .order('title')
      .limit(2)
    expect(error).toBeNull()
    expect(byAuthor?.map((b: any) => b.title)).toEqual(['A Wizard of Earthsea', 'The Dispossessed'])
  })

  it('range and counts', async () => {
    const { data, count, error, status } = await anon
      .from('books')
      .select('id', { count: 'exact' })
      .order('id')
      .range(1, 2)
    expect(error).toBeNull()
    expect(status).toBe(206)
    expect(data).toEqual([{ id: 2 }, { id: 3 }])
    expect(count).toBe(5)
    const { count: planned } = await anon.from('books').select('*', { count: 'planned', head: true })
    expect(planned).toBeGreaterThanOrEqual(5)
    const { count: estimated, data: none } = await anon.from('books').select('*', { count: 'estimated', head: true })
    expect(estimated).toBe(5)
    expect(none).toBeNull()
  })

  it('single and maybeSingle', async () => {
    const { data } = await anon.from('authors').select('name').eq('id', 1).single()
    expect(data).toEqual({ name: 'Terry Pratchett' })
    const { data: none, error } = await anon.from('authors').select('name').eq('id', 999).maybeSingle()
    expect(error).toBeNull()
    expect(none).toBeNull()
    const { error: many } = await anon.from('authors').select('name').single()
    expect(many?.code).toBe('FBRST116')
    expect(many?.message).toContain('rows')
  })

  it('aggregates and computed fields', async () => {
    const { data, error } = await anon.from('books').select('author_id, price.sum(), count()').order('author_id')
    expect(error).toBeNull()
    expect(data).toEqual([
      { author_id: 1, sum: 18.49, count: 2 },
      { author_id: 2, sum: 19.25, count: 2 },
      { author_id: 3, sum: 10.4, count: 1 },
    ])
    const { data: vat } = await anon.from('books').select('price, price_with_vat').eq('id', 1).single()
    expect(vat?.price_with_vat).toBeCloseTo(11.89, 2)
  })

  it('csv', async () => {
    const { data, error } = await anon.from('authors').select('id, name').order('id').limit(2).csv()
    expect(error).toBeNull()
    expect(data).toBe('id,name\n1,Terry Pratchett\n2,Ursula K. Le Guin\n')
  })

  it('explain', async () => {
    const { data, error } = await anon.from('books').select('title').eq('id', 1).explain()
    expect(error).toBeNull()
    expect(String(data)).toContain('BOOKS')
  })

  it('errors keep PostgREST\'s shape', async () => {
    const { data, error, status } = await anon.from('nope').select('*')
    expect(data).toBeNull()
    expect(status).toBe(404)
    expect(error?.code).toBe('FBRST205')
    expect(error?.message).toContain('nope')
    const { error: perm } = await anon.from('customers').select('*')
    expect(perm?.code).toBe('28000')
  })

  it('abort signal', async () => {
    const ac = new AbortController()
    ac.abort()
    const { error } = await anon.from('books').select('id').abortSignal(ac.signal)
    expect(error).not.toBeNull()
  })
})

describe('rpc', () => {
  it('GET a function with arguments', async () => {
    const { data, error } = await anon.rpc('add_vat', { amount: 100, rate: 10 }, { get: true })
    expect(error).toBeNull()
    expect(data).toBe(110)
  })

  it('selectable procedure with select, filter and order', async () => {
    const { data, error } = await anon.rpc('books_by_country', { country: 'UK' }).select('title').order('title')
    expect(error).toBeNull()
    expect(data).toEqual([{ title: 'Guards! Guards!' }, { title: 'Small Gods' }])
  })

  it('function reading the JWT claims', async () => {
    const { data } = await anon.rpc('whoami')
    expect(String(data)).toMatch(/^anonymous/)
    if (user) {
      const { data: me } = await user.rpc('whoami')
      expect(String(me)).toMatch(/^ana@example\.com/)
    }
  })

  it('package routine', async () => {
    const { data, error } = await anon.rpc('catalog.book_count', { author_id: 1 }, { get: true })
    expect(error).toBeNull()
    expect(data).toBe(2)
  })
})

describe('writes', () => {
  const created: number[] = []
  afterAll(async () => {
    if (user && created.length) await user.from('authors').delete().in('id', created)
  })

  writes('insert returning the representation', async () => {
    const { data, error, status } = await user!
      .from('authors')
      .insert({ name: 'Test Author', country: 'Nowhere' })
      .select('id, name')
      .single()
    expect(error).toBeNull()
    expect(status).toBe(201)
    expect(data?.name).toBe('Test Author')
    created.push(data!.id)
  })

  writes('bulk insert and update', async () => {
    const { data, error } = await user!
      .from('authors')
      .insert([
        { name: 'Bulk One', country: 'X' },
        { name: 'Bulk Two', country: 'X' },
      ])
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    created.push(...data!.map((r: any) => r.id))
    const { data: updated, error: uerr } = await user!
      .from('authors')
      .update({ country: 'Y' })
      .eq('country', 'X')
      .select('name')
      .order('name')
    expect(uerr).toBeNull()
    expect(updated).toEqual([{ name: 'Bulk One' }, { name: 'Bulk Two' }])
  })

  writes('upsert', async () => {
    const { data, error } = await user!
      .from('tags')
      .upsert({ id: 1, name: 'fantasy' }, { onConflict: 'id' })
      .select('name')
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({ name: 'fantasy' })
  })

  writes('delete with filters, and the safe-updates guard', async () => {
    const { data, error } = await user!.from('authors').insert({ name: 'To Delete', country: 'Z' }).select('id').single()
    expect(error).toBeNull()
    const { error: derr, status } = await user!.from('authors').delete().eq('id', data!.id)
    expect(derr).toBeNull()
    expect(status).toBe(204)
    const { error: guard } = await user!.from('authors').delete()
    expect(guard?.code).toBe('FBRST109')
  })

  writes('permission errors for the anonymous role', async () => {
    const { error, status } = await anon.from('authors').insert({ name: 'Nope', country: 'Nope' })
    expect(status).toBe(401)
    expect(error).not.toBeNull()
  })

  writes('rpc with side effects, rolled back with tx=rollback is not exposed: use a procedure', async () => {
    const { data, error } = await user!.rpc('place_order', { customer_id: 1, book_id: 2, qty: 1 })
    expect(error).toBeNull()
    expect((data as any).order_id).toBeGreaterThan(0)
    await user!.from('orders').delete().eq('id', (data as any).order_id)
  })
})

describe('files', () => {
  it('downloads a BLOB as its bytes', async () => {
    const { data, error, status } = await anon.file(anon.from('covers').select('image').eq('book_id', 1), 'image/png')
    expect(error).toBeNull()
    expect(status).toBe(200)
    expect(data).toBeInstanceOf(Blob)
    const bytes = new Uint8Array(await (data as Blob).arrayBuffer())
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('downloads text, and reports shape errors', async () => {
    const { data } = await anon.file(anon.from('books').select('title').eq('id', 1), 'text/plain')
    expect(data).toBe('Guards! Guards!')
    const { error } = await anon.file(anon.from('books').select('title'), 'text/plain')
    expect(error?.code).toBe('FBRST116')
  })
})

describe('client options', () => {
  it('time zone preference', async () => {
    const zoned = createClient(url, null, { timezone: 'Asia/Tokyo' })
    const { data, error } = await zoned.from('books').select('added_at').eq('id', 1).single()
    expect(error).toBeNull()
    expect(data?.added_at).toBeTruthy()
  })

  it('schema selection is refused before Firebird 6', async () => {
    const { error } = await anon.schema('inventory').from('warehouses').select('*')
    // FBRST106: the schema isn't exposed, or the server has no schemas
    expect(error?.code).toBe('FBRST106')
  })
})
