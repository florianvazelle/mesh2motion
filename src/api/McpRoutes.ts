import { API_PREFIX, handleApiRequest, type ApiResult } from './ApiRoutes'
import { BRIDGE_TOOLS, BRIDGE_TOOL_NAMES } from './BridgeTools'

/**
 * Minimal MCP server (stateless Streamable HTTP, JSON responses only) served by the worker at POST /mcp.
 * Each tool is a thin wrapper around the read-only /api routes, so MCP and the JSON API always agree.
 *
 * claude mcp add --transport http mesh2motion https://app.mesh2motion.org/mcp
 *
 * At /mcp/<code> the server also gets the BRIDGE_TOOLS, which act on the browser tab showing that code.
 * The `bridge` argument sends a tool call to that tab (see BridgeSession.ts).
 */

export const MCP_PATH = '/mcp'

const PROTOCOL_VERSION = '2025-06-18'

const rig_id_schema = {
  type: 'object',
  properties: { rig_id: { type: 'string', description: 'Rig id from list_rigs, e.g. "human" or "fox"' } },
  required: ['rig_id']
}

const TOOLS = [
  {
    name: 'list_rigs',
    description: 'List all Mesh2Motion rigs (skeleton types) with model, rig and reference image URLs.',
    inputSchema: { type: 'object', properties: {} },
    api_path: () => 'rigs'
  },
  {
    name: 'get_rig',
    description: 'Get one Mesh2Motion rig by id.',
    inputSchema: rig_id_schema,
    api_path: (args: Record<string, unknown>) => `rigs/${encodeURIComponent(String(args.rig_id))}`
  },
  {
    name: 'list_variations',
    description: 'List the 3D model variations for a rig, with GLB URLs, preview images, license and attribution.',
    inputSchema: rig_id_schema,
    api_path: (args: Record<string, unknown>) => `rigs/${encodeURIComponent(String(args.rig_id))}/variations`
  }
]

export type BridgeCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export async function handleMcpRequest (message: unknown, origin: string, bridge?: BridgeCall): Promise<ApiResult> {
  if (!is_request(message)) {
    return rpc_error(null, -32600, 'Invalid Request')
  }

  // notifications (no id) get no JSON-RPC response
  if (message.id === undefined) {
    return { body: null, status: 202 }
  }

  switch (message.method) {
    case 'initialize':
      return rpc_result(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mesh2motion', version: '1.0.0' }
      })
    case 'ping':
      return rpc_result(message.id, {})
    case 'tools/list':
      return rpc_result(message.id, {
        tools: [...TOOLS, ...(bridge === undefined ? [] : BRIDGE_TOOLS)].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
      })
    case 'tools/call':
      return await call_tool(message, origin, bridge)
    default:
      return rpc_error(message.id, -32601, `Method not found: ${message.method}`)
  }
}

async function call_tool (message: JsonRpcRequest, origin: string, bridge?: BridgeCall): Promise<ApiResult> {
  const name = message.params?.name
  const args = (message.params?.arguments ?? {}) as Record<string, unknown>

  if (bridge !== undefined && typeof name === 'string' && BRIDGE_TOOL_NAMES.has(name)) {
    try {
      return tool_result(message.id ?? null, await bridge(name, args), false)
    } catch (error) {
      // the tab's message (e.g. "wrong step") tells the model what to do next
      return tool_result(message.id ?? null, { error: error instanceof Error ? error.message : String(error) }, true)
    }
  }

  const tool = TOOLS.find(t => t.name === name)
  if (tool === undefined) {
    return rpc_error(message.id ?? null, -32602, `Unknown tool: ${String(name)}`)
  }
  if (tool.inputSchema === rig_id_schema && typeof args.rig_id !== 'string') {
    return rpc_error(message.id ?? null, -32602, 'rig_id is required')
  }

  const { body, status } = handleApiRequest(new URL(API_PREFIX + tool.api_path(args), origin))
  // API errors (e.g. unknown rig) are tool errors the model can see, not protocol errors
  return tool_result(message.id ?? null, body, status !== 200)
}

function tool_result (id: JsonRpcRequest['id'], body: unknown, is_error: boolean): ApiResult {
  return rpc_result(id, { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], isError: is_error })
}

function is_request (message: unknown): message is JsonRpcRequest {
  const m = message as JsonRpcRequest | null
  return typeof m === 'object' && m !== null && m.jsonrpc === '2.0' && typeof m.method === 'string'
}

function rpc_result (id: JsonRpcRequest['id'], result: unknown): ApiResult {
  return { body: { jsonrpc: '2.0', id, result }, status: 200 }
}

function rpc_error (id: JsonRpcRequest['id'], code: number, message: string): ApiResult {
  return { body: { jsonrpc: '2.0', id, error: { code, message } }, status: 200 }
}
