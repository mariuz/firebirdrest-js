// The event channel against a scripted server: no FirebirdREST needed.
import { describe, expect, it } from 'vitest'
import { createClient } from '../src/index'

function stream(text: string, keepOpen = false): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(text))
      if (!keepOpen) c.close()
    },
  })
}

describe('event channel', () => {
  it('replays with Last-Event-ID after a reconnect, and reports resets', async () => {
    const sent: (string | null)[] = []
    const responses = [
      // first connection: two notifications, then the server goes away
      'retry: 3000\n: listening a\n\nid: e1-1\nevent: a\ndata: {"name":"a","count":1}\n\nid: e1-2\nevent: a\ndata: {"name":"a","count":2}\n\n',
      // second: the server restarted, so it can't replay
      'retry: 3000\n\nevent: reset\ndata: {"reason":"the server restarted"}\n\nid: e2-1\nevent: a\ndata: {"name":"a","count":1}\n\n',
    ]
    const fetchFn = (async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers).get('Last-Event-ID'))
      const body = responses.shift()
      return new Response(stream(body ?? '', body === undefined), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch
    const client = createClient('http://fb.test', 'tok', { fetch: fetchFn })
    const events: string[] = []
    const resets: string[] = []
    const ch = client
      .channel('a')
      .on('a', (e) => events.push(`${e.id}:${e.count}`))
      .onReset((r) => resets.push(r))
      .subscribe()
    for (let i = 0; i < 100 && events.length < 3; i++) await new Promise((r) => setTimeout(r, 30))
    ch.unsubscribe()
    expect(events).toEqual(['e1-1:1', 'e1-2:2', 'e2-1:1'])
    expect(resets).toEqual(['the server restarted'])
    expect(sent.slice(0, 2)).toEqual([null, 'e1-2'])
    expect(ch.lastEventId).toBe('e2-1')
  }, 10000)
})
