/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Durable Object that pairs one browser tab with the MCP client using the same code.
 *
 * GET  /socket  the tab connects here (WebSocket). It sends {hello: page} and then answers {id, result | error}
 * POST /call    the MCP route sends {tool, args}; it is relayed to the tab as {id, tool, args}
 *
 * Switching pages reloads the tab, so a call waits a little for the tab to reconnect.
 */

const CONNECT_WAIT_MS = 20_000
const CALL_TIMEOUT_MS = 120_000 // exports can take a while

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class BridgeSession {
  private socket: any = null
  private page: string | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly connect_waiters: Array<() => void> = []

  async fetch (request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/socket') {
      return this.accept_socket(request)
    }

    const { tool, args } = await request.json() as { tool: string, args: Record<string, unknown> }
    try {
      return Response.json({ result: await this.call(tool, args) })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  private accept_socket (request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 })
    }

    const { 0: client, 1: server } = new (globalThis as any).WebSocketPair()
    server.accept()
    this.socket?.close(1000, 'replaced by a newer tab')
    this.socket = server

    server.addEventListener('message', (event: MessageEvent) => { this.on_message(server, String(event.data)) })
    server.addEventListener('close', () => {
      if (this.socket === server) {
        this.socket = null
        this.page = null
      }
    })

    return new Response(null, { status: 101, webSocket: client } as any)
  }

  private on_message (socket: any, text: string): void {
    let message: { hello?: string, id?: string, result?: unknown, error?: string }
    try { message = JSON.parse(text) } catch { return }

    if (message.hello !== undefined) {
      this.page = message.hello
      this.connect_waiters.splice(0).forEach(wake => { wake() })
      return
    }

    const pending = message.id === undefined ? undefined : this.pending.get(message.id)
    if (pending === undefined || message.id === undefined) { return }
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error !== undefined) {
      pending.reject(new Error(message.error))
    } else {
      pending.resolve(message.result ?? null)
    }
  }

  private async wait_for_tab (): Promise<void> {
    if (this.page !== null) { return }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('No Mesh2Motion tab is connected. Open the app with this code (?mcp=<code>) and keep the tab open.'))
      }, CONNECT_WAIT_MS)
      this.connect_waiters.push(() => { clearTimeout(timer); resolve() })
    })
  }

  private async call (tool: string, args: Record<string, unknown>): Promise<unknown> {
    await this.wait_for_tab()

    const id = crypto.randomUUID()
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The tab did not answer ${tool} in time`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, tool, args }))
    })
  }
}
