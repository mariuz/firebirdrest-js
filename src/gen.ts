// Generates the TypeScript `Database` type that @supabase/postgrest-js (and
// so firebirdrest-js) uses to type from(), select(), insert() and rpc(),
// from FirebirdREST's OpenAPI documents: the JSON schemas give the columns,
// and the x-firebirdrest extensions (FirebirdREST 0.7+) the keys, views,
// computed fields and routine kinds. Older servers are read from the
// descriptions instead, with less: single-column foreign keys only, no views.

export interface OpenAPIDocument {
  info?: { version?: string; description?: string; 'x-firebirdrest'?: { schema?: string; schemas?: string[]; firebird?: string } }
  paths?: Record<string, PathItem>
  components?: { schemas?: Record<string, JSONSchema> }
}

interface PathItem {
  'x-firebirdrest'?: { kind?: string; args?: { name: string; hasDefault: boolean }[] }
  get?: Operation
  post?: Operation
}

interface Operation {
  parameters?: { name: string; in: string; description?: string }[]
  requestBody?: { content?: Record<string, { schema?: JSONSchema }> }
  responses?: Record<string, { content?: Record<string, { schema?: JSONSchema }> }>
}

export interface JSONSchema {
  type?: string
  format?: string
  nullable?: boolean
  readOnly?: boolean
  description?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  'x-firebirdrest'?: RelationExt
}

interface RelationExt {
  kind?: 'table' | 'view'
  primaryKey?: string[]
  computedFields?: string[]
  foreignKeys?: {
    name: string
    columns: string[]
    referencedRelation: string
    referencedColumns: string[]
    isOneToOne?: boolean
    referencedSchema?: string
  }[]
}

/** One schema's document: `name` is the key in `Database` ("public" before Firebird 6). */
export interface SchemaDocument {
  name: string
  doc: OpenAPIDocument
}

const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const key = (name: string) => (ident.test(name) ? name : JSON.stringify(name))
const sorted = <T>(o: Record<string, T> | undefined) => Object.keys(o ?? {}).sort().map((k) => [k, o![k]] as const)

/** The TypeScript type of a value described by s. */
function tsType(s: JSONSchema | undefined): string {
  if (!s) return 'unknown'
  let t: string
  switch (s.type) {
    case 'integer':
    case 'number':
      t = 'number'
      break
    case 'string':
      t = 'string'
      break
    case 'boolean':
      t = 'boolean'
      break
    case 'array':
      t = `${wrap(tsType(s.items))}[]`
      break
    case 'object':
      t = s.properties ? objectType(s.properties, () => true) : 'Record<string, unknown>'
      break
    default:
      t = 'unknown'
  }
  return s.nullable && t !== 'unknown' ? `${t} | null` : t
}

const wrap = (t: string) => (t.includes('|') ? `(${t})` : t)

function objectType(props: Record<string, JSONSchema>, required: (name: string) => boolean, indent = ''): string {
  const entries = sorted(props)
  if (entries.length === 0) return 'Record<PropertyKey, never>'
  const lines = entries.map(([n, p]) => `${indent}  ${key(n)}${required(n) ? '' : '?'}: ${tsType(p)}`)
  return `{\n${lines.join('\n')}\n${indent}}`
}

/** A column is a real column (not a computed relationship, which has no type). */
const isColumn = (p: JSONSchema) => p.type !== undefined

/** Foreign keys from descriptions ("INTEGER (references authors.id)"), for servers before 0.7. */
function keysFromDescriptions(rel: string, s: JSONSchema): NonNullable<RelationExt['foreignKeys']> {
  const out: NonNullable<RelationExt['foreignKeys']> = []
  for (const [col, p] of sorted(s.properties)) {
    const m = /\(references ([^.()\s]+)\.([^()\s]+)\)/.exec(p.description ?? '')
    if (m) out.push({ name: `${rel}_${col}_fkey`, columns: [col], referencedRelation: m[1], referencedColumns: [m[2]] })
  }
  return out
}

function relationType(name: string, s: JSONSchema, legacy: boolean, notes: string[]): { kind: 'table' | 'view'; body: string } {
  const ext = s['x-firebirdrest'] ?? {}
  const props = Object.fromEntries(Object.entries(s.properties ?? {}).filter(([, p]) => isColumn(p)))
  const writable = Object.fromEntries(Object.entries(props).filter(([, p]) => !p.readOnly))
  const required = new Set(s.required ?? [])
  const computed = ext.computedFields ?? Object.entries(props).filter(([, p]) => p.readOnly).map(([n]) => n)
  const keys = (legacy ? keysFromDescriptions(name, s) : ext.foreignKeys ?? []).filter((fk) => {
    if (fk.referencedSchema) {
      notes.push(`${name}.${fk.name} references ${fk.referencedSchema}.${fk.referencedRelation}: embeddable, but not typed (postgrest-js types relationships within one schema)`)
      return false
    }
    return true
  })
  const rels = keys.map(
    (fk) =>
      `          {\n` +
      `            foreignKeyName: ${JSON.stringify(fk.name)}\n` +
      `            columns: ${JSON.stringify(fk.columns)}\n` +
      `            isOneToOne: ${fk.isOneToOne ? 'true' : 'false'}\n` +
      `            referencedRelation: ${JSON.stringify(fk.referencedRelation)}\n` +
      `            referencedColumns: ${JSON.stringify(fk.referencedColumns)}\n` +
      `          },`,
  )
  const ind = '        '
  let body = `{\n${ind}Row: ${objectType(props, () => true, ind)}\n`
  body += `${ind}Insert: ${objectType(writable, (n) => required.has(n), ind)}\n`
  body += `${ind}Update: ${objectType(writable, () => false, ind)}\n`
  body += `${ind}Relationships: ${rels.length ? `[\n${rels.join('\n')}\n${ind}]` : '[]'}\n`
  if (computed.length) body += `${ind}ComputedFields: ${computed.map((c) => JSON.stringify(c)).join(' | ')}\n`
  body += `      }`
  return { kind: ext.kind ?? 'table', body }
}

function functionType(path: PathItem): string {
  const ext = path['x-firebirdrest'] ?? {}
  const props = path.post?.requestBody?.content?.['application/json']?.schema?.properties ?? {}
  // arguments without a default are required; servers before 0.7 don't say, so all are optional
  const defaults = new Map((ext.args ?? []).map((a) => [a.name, a.hasDefault]))
  const args = objectType(props, (n) => defaults.has(n) && !defaults.get(n), '        ')
  const resp = path.post?.responses?.['200']?.content?.['application/json']?.schema
  let returns: string
  if (ext.kind === 'executable' && Object.keys(resp?.properties ?? {}).length === 0) returns = 'undefined'
  else if (resp?.type === 'array' && resp.items?.properties) returns = `${objectType(resp.items.properties, () => true, '        ')}[]`
  else returns = tsType(resp)
  return `{\n        Args: ${args}\n        Returns: ${returns}\n      }`
}

export interface GenerateResult {
  /** the TypeScript source */
  source: string
  /** things that could not be typed, worth telling the user */
  notes: string[]
}

/** Builds the source of a module exporting `Database` and helper types. */
export function generateTypes(schemas: SchemaDocument[], header = ''): GenerateResult {
  const notes: string[] = []
  let out = header ? header.replace(/^/gm, '// ') + '\n\n' : ''
  out += `export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]\n\n`
  out += `export type Database = {\n`
  for (const { name, doc } of schemas) {
    const legacy = !doc.info?.['x-firebirdrest']
    if (legacy) notes.push(`schema ${name}: the server is older than FirebirdREST 0.7, so views, composite foreign keys and required arguments are not typed`)
    const tables: string[] = []
    const views: string[] = []
    for (const [rel, s] of sorted(doc.components?.schemas)) {
      const { kind, body } = relationType(rel, s, legacy, notes)
      ;(kind === 'view' ? views : tables).push(`      ${key(rel)}: ${body}`)
    }
    const fns: string[] = []
    for (const [p, item] of sorted(doc.paths)) {
      if (!p.startsWith('/rpc/')) continue
      fns.push(`      ${key(p.slice(5))}: ${functionType(item)}`)
    }
    const block = (items: string[]) => (items.length ? `{\n${items.join('\n')}\n    }` : '{\n      [_ in never]: never\n    }')
    out += `  ${key(name)}: {\n`
    out += `    Tables: ${block(tables)}\n`
    out += `    Views: ${block(views)}\n`
    out += `    Functions: ${block(fns)}\n`
    out += `    Enums: {\n      [_ in never]: never\n    }\n`
    out += `    CompositeTypes: {\n      [_ in never]: never\n    }\n`
    out += `  }\n`
  }
  out += `}\n\n`
  const first = schemas[0]?.name ?? 'public'
  out += `type DefaultSchema = Database[${JSON.stringify(first)}]

/** The row type of a table or view: \`Tables<'books'>\`. */
export type Tables<T extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])> =
  (DefaultSchema['Tables'] & DefaultSchema['Views'])[T] extends { Row: infer R } ? R : never

/** The type to insert into a table: \`TablesInsert<'books'>\`. */
export type TablesInsert<T extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][T] extends { Insert: infer I } ? I : never

/** The type to update a table with: \`TablesUpdate<'books'>\`. */
export type TablesUpdate<T extends keyof DefaultSchema['Tables']> = DefaultSchema['Tables'][T] extends { Update: infer U } ? U : never
`
  return { source: out, notes }
}
