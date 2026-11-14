/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { handleMcpRequest } from './McpRoutes'

const origin = 'https://example.org'
const rpc = async (method: string, params?: Record<string, unknown>, bridge?: any): Promise<any> =>
  (await handleMcpRequest({ jsonrpc: '2.0', id: 1, method, params }, origin, bridge)).body

describe('McpRoutes', () => {
  it('initializes and lists tools', async () => {
    expect((await rpc('initialize')).result.serverInfo.name).toBe('mesh2motion')
    expect((await rpc('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['list_rigs', 'get_rig', 'list_variations'])
    const bridge_tools = (await rpc('tools/list', undefined, async () => ({}))).result.tools.map((t: any) => t.name)
    expect(bridge_tools).toContain('load_own_model')
    expect(bridge_tools).toContain('composer_set_slot')
  })

  it('calls tools through the JSON API', async () => {
    const rigs = JSON.parse((await rpc('tools/call', { name: 'list_rigs' })).result.content[0].text)
    expect(rigs.some((r: any) => r.id === 'human')).toBe(true)
    const fox = (await rpc('tools/call', { name: 'get_rig', arguments: { rig_id: 'fox' } })).result
    expect(fox.isError).toBe(false)
    expect(JSON.parse(fox.content[0].text).model_url.startsWith(origin)).toBe(true)
  })

  it('reports errors', async () => {
    expect((await rpc('tools/call', { name: 'get_rig', arguments: { rig_id: 'nope' } })).result.isError).toBe(true)
    expect((await rpc('tools/call', { name: 'get_rig' })).error.code).toBe(-32602)
    expect((await rpc('nope')).error.code).toBe(-32601)
    expect((await handleMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, origin)).status).toBe(202)
  })

  it('relays browser tools to the bridge', async () => {
    const calls: unknown[] = []
    const bridge = async (tool: string, args: unknown): Promise<unknown> => {
      calls.push([tool, args])
      if (tool === 'export') throw new Error('no animations selected')
      return { ok: true }
    }
    const ok = (await rpc('tools/call', { name: 'next_step', arguments: { weight_painting: true } }, bridge)).result
    expect(ok.isError).toBe(false)
    expect(calls).toEqual([['next_step', { weight_painting: true }]])
    const failed = (await rpc('tools/call', { name: 'export' }, bridge)).result
    expect(failed.isError).toBe(true)
    expect(failed.content[0].text).toContain('no animations selected')
    // without a tab code the browser tools do not exist
    expect((await rpc('tools/call', { name: 'next_step' })).error.code).toBe(-32602)
  })
})
