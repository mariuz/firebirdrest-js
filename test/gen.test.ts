import { describe, expect, it } from 'vitest'
import { generateTypes, type OpenAPIDocument } from '../src/gen'

const ext = (e: object) => ({ 'x-firebirdrest': e })

const doc: OpenAPIDocument = {
  info: { version: 'v0.7.0', ...ext({ schema: 'inventory', schemas: ['public', 'inventory'], firebird: '6.0.0' }) },
  components: {
    schemas: {
      'Mixed Case': {
        type: 'object',
        properties: { 'Odd Column': { type: 'string', nullable: true }, id: { type: 'integer' } },
        required: ['id'],
        ...ext({ kind: 'table', primaryKey: ['id'], foreignKeys: [], computedFields: [] }),
      },
      stock: {
        type: 'object',
        properties: { id: { type: 'integer' }, book_id: { type: 'integer' }, warehouse_id: { type: 'integer' } },
        required: ['book_id', 'warehouse_id'],
        ...ext({
          kind: 'table',
          primaryKey: ['id'],
          computedFields: [],
          foreignKeys: [
            { name: 'fk_stock_wh', columns: ['warehouse_id'], referencedRelation: 'warehouses', referencedColumns: ['id'], isOneToOne: false },
            { name: 'fk_stock_book', columns: ['book_id'], referencedRelation: 'books', referencedColumns: ['id'], isOneToOne: false, referencedSchema: 'public' },
          ],
        }),
      },
      low_stock_view: { type: 'object', properties: { qty: { type: 'integer', nullable: true } }, ...ext({ kind: 'view', foreignKeys: [] }) },
    },
  },
  paths: {
    '/rpc/reports.total_qty': {
      ...ext({ kind: 'function', args: [{ name: 'book_id', hasDefault: false }] }),
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { book_id: { type: 'integer', nullable: true } } } } } },
        responses: { '200': { content: { 'application/json': { schema: { type: 'integer', nullable: true } } } } },
      },
    },
    '/rpc/refresh': {
      ...ext({ kind: 'executable', args: [] }),
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } },
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } },
      },
    },
    '/warehouses': {},
  },
}

describe('generateTypes', () => {
  const { source, notes } = generateTypes([{ name: 'inventory', doc }], 'header line')

  it('quotes names that are not identifiers', () => {
    expect(source).toContain('"Mixed Case": {')
    expect(source).toContain('"Odd Column": string | null')
    expect(source).toContain('"reports.total_qty": {')
  })

  it('types views apart from tables', () => {
    expect(source).toMatch(/Views: \{\n\s+low_stock_view: \{/)
  })

  it('keeps keys within the schema and reports the others', () => {
    expect(source).toContain('foreignKeyName: "fk_stock_wh"')
    expect(source).not.toContain('fk_stock_book')
    expect(notes.join('\n')).toContain('fk_stock_book references public.books')
  })

  it('types routines: required arguments, no arguments, no outputs', () => {
    expect(source).toMatch(/"reports.total_qty": \{\n\s+Args: \{\n\s+book_id: number \| null\n/)
    expect(source).toMatch(/refresh: \{\n\s+Args: Record<PropertyKey, never>\n\s+Returns: undefined/)
  })

  it('starts with the header and exports the helpers', () => {
    expect(source.startsWith('// header line\n')).toBe(true)
    expect(source).toContain('type DefaultSchema = Database["inventory"]')
    expect(source).toContain('export type TablesInsert<')
  })

  it('reads servers before 0.7 from the descriptions', () => {
    const legacy: OpenAPIDocument = {
      info: { version: 'v0.6.0' },
      components: {
        schemas: {
          books: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: 'INTEGER (primary key)' },
              author_id: { type: 'integer', nullable: true, description: 'INTEGER (references authors.id)' },
            },
          },
        },
      },
      paths: {},
    }
    const r = generateTypes([{ name: 'public', doc: legacy }])
    expect(r.source).toContain('referencedRelation: "authors"')
    expect(r.source).toContain('columns: ["author_id"]')
    expect(r.notes[0]).toContain('older than FirebirdREST 0.7')
  })
})
