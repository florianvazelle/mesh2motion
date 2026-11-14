/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { BridgeSession } from './BridgeSession'

// the WebSocket upgrade itself only runs inside workerd; this covers the call/answer relay
function connected_session (): { session: any, sent: any[] } {
  const session: any = new BridgeSession()
  const sent: any[] = []
  session.socket = { send: (text: string) => sent.push(JSON.parse(text)) }
  session.on_message(session.socket, JSON.stringify({ hello: 'create' }))
  return { session, sent }
}

const call = async (session: any, tool: string): Promise<any> =>
  await (await session.fetch(new Request('https://bridge/call', { method: 'POST', body: JSON.stringify({ tool, args: { a: 1 } }) }))).json()

describe('BridgeSession', () => {
  it('relays a call to the tab and returns its answer', async () => {
    const { session, sent } = connected_session()
    const reply = call(session, 'get_state')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sent[0]).toMatchObject({ tool: 'get_state', args: { a: 1 } })
    session.on_message(session.socket, JSON.stringify({ id: sent[0].id, result: { step: 'load-model' } }))
    expect(await reply).toEqual({ result: { step: 'load-model' } })
  })

  it('returns the tab error', async () => {
    const { session, sent } = connected_session()
    const reply = call(session, 'export')
    await new Promise(resolve => setTimeout(resolve, 0))
    session.on_message(session.socket, JSON.stringify({ id: sent[0].id, error: 'nothing selected' }))
    expect(await reply).toEqual({ error: 'nothing selected' })
  })

  it('waits for the tab to reconnect after a page switch', async () => {
    const { session, sent } = connected_session()
    session.page = null // old page closed
    const reply = call(session, 'get_state')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sent).toHaveLength(0)
    session.on_message(session.socket, JSON.stringify({ hello: 'composer' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    session.on_message(session.socket, JSON.stringify({ id: sent[0].id, result: 1 }))
    expect(await reply).toEqual({ result: 1 })
  })
})
