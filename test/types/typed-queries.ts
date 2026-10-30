// Compile-time checks of the types `gen types` writes for the FirebirdREST
// example database (test/types/database.types.ts, regenerated in CI from a
// live server). Nothing here runs: `npm run typecheck` fails if an inferred
// type is wrong or an expected error goes away.

import { createClient } from '../../src/index'
import type { Database, Tables, TablesInsert } from './database.types'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T
type Data<Q> = Q extends PromiseLike<{ data: infer D }> ? D : never

const db = createClient<Database>('http://localhost:3000')

// columns, and an embedded many-to-one: author_id is nullable, so the author may be null
const q1 = db.from('books').select('id, title, authors(name)')
type _1 = Expect<Equal<Data<typeof q1>, { id: number; title: string; authors: { name: string } | null }[] | null>>

// one-to-many, from the other side of the same key
const q2 = db.from('authors').select('name, books(title, price)')
type _2 = Expect<Equal<Data<typeof q2>, { name: string; books: { title: string; price: number | null }[] }[] | null>>

// one-to-one: covers.book_id is covers' primary key
const q3 = db.from('books').select('title, covers(mime)')
type _3 = Expect<Equal<Data<typeof q3>, { title: string; covers: { mime: string } | null }[] | null>>

// * leaves computed fields out; naming one selects it
const q4 = db.from('books').select('*').eq('id', 1).single()
type R4 = NonNullable<Data<typeof q4>>
type _4a = Expect<Equal<'label' extends keyof R4 ? true : false, false>>
type _4b = Expect<Equal<R4['title'], string>>
const q5 = db.from('books').select('title, label')
type _5 = Expect<Equal<Data<typeof q5>, { title: string; label: string | null }[] | null>>

// a view, read like a table
const q6 = db.from('books_with_authors').select('title')
type _6 = Expect<Equal<Data<typeof q6>, { title: string | null }[] | null>>

// helpers
type _7 = Expect<Equal<Tables<'authors'>['name'], string>>
type _8 = Expect<Equal<TablesInsert<'books'>['title'], string>>

// inserts: required columns required, computed ones refused
db.from('books').insert({ title: 'Mort', author_id: 1 })
// @ts-expect-error title is NOT NULL without a default
db.from('books').insert({ author_id: 1 })
// @ts-expect-error label is computed, not a column to write
db.from('books').insert({ title: 'Mort', label: 'x' })
db.from('books').update({ price: 9.5 }).eq('id', 1)

// functions and procedures
const f1 = db.rpc('add_vat', { amount: 100 })
type _9 = Expect<Equal<Data<typeof f1>, number | null>>
const f2 = db.rpc('books_by_country', { country: 'UK' })
type _10 = Expect<Equal<Data<typeof f2>, { author: string | null; price: number | null; title: string | null }[] | null>>
db.rpc('place_order', { customer_id: 1, book_id: 2 }) // qty has a default
// @ts-expect-error book_id has no default
db.rpc('place_order', { customer_id: 1 })
const f3 = db.rpc('catalog.book_count', { author_id: 1 })
type _11 = Expect<Equal<Data<typeof f3>, number | null>>

// mistakes are caught
// @ts-expect-error no such table
db.from('bookz')
// @ts-expect-error no such function
db.rpc('add_vatt', { amount: 1 })
// a misspelt column turns the row into postgrest-js's error type:
// "column 'titel' does not exist on 'books'."
const bad = db.from('books').select('titel')
type _12 = Expect<Equal<NonNullable<Data<typeof bad>> extends { error: true }[] ? true : false, true>>

// many-to-many through the book_tags junction (both keys in its primary key)
const q13 = db.from('books').select('title, tags(name)')
type _13 = Expect<Equal<Data<typeof q13>, { title: string; tags: { name: string }[] }[] | null>>
