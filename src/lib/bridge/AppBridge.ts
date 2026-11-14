import { ModalDialog } from '../ModalDialog.ts'
import { type BridgeArgs, click, el, next_download, set_checked } from './BridgeDom.ts'

/**
 * Lets an AI assistant drive this tab through the worker's MCP server (src/api/BridgeSession.ts).
 * Off unless the page was opened with ?mcp (new code, shown in a dialog) or ?mcp=<code>.
 * The code is the only secret: anyone holding the MCP URL can drive the tab.
 */

export type BridgePage = 'create' | 'retarget' | 'composer'
export type BridgeHandlers = Record<string, (args: BridgeArgs) => unknown>

const CODE_KEY = 'mesh2motion-mcp-code'
const PAGE_PATHS: Record<BridgePage, string> = { create: 'create.html', retarget: 'retarget/index.html', composer: 'composer/index.html' }
const EXPORT_BUTTONS: Record<BridgePage, string> = { create: '#export-button', retarget: '#export-retargeting-button', composer: '#export-composer-button' }
// radio groups of the download settings popup
const EXPORT_OPTIONS: Record<string, string> = { format: 'export-format', contents: 'export-contents', bone_naming: 'bone-naming-structure', fbx_preset: 'fbx-export-preset' }

export class AppBridge {
  public static start (page: BridgePage, page_handlers: BridgeHandlers): void {
    const code = AppBridge.resolve_code()
    if (code === null) { return }

    const handlers: BridgeHandlers = {
      ...AppBridge.common_handlers(page, code),
      ...page_handlers
    }
    AppBridge.connect(page, code, handlers)
  }

  private static resolve_code (): string | null {
    const param = new URLSearchParams(location.search).get('mcp')
    try {
      if (param === null) { return sessionStorage.getItem(CODE_KEY) } // survives page switches in this tab
      const is_new = param === ''
      const code = is_new ? crypto.randomUUID() : param
      sessionStorage.setItem(CODE_KEY, code)
      if (is_new) { AppBridge.show_connect_dialog(code) }
      return code
    } catch {
      return param !== null && param !== '' ? param : null
    }
  }

  private static show_connect_dialog (code: string): void {
    const command = `claude mcp add --transport http mesh2motion ${location.origin}/mcp/${code}`
    new ModalDialog('Connect an AI assistant', `
      <p>Run this once so your assistant can drive this tab. Keep the tab open. Anyone who has the address can control it.</p>
      <pre style="white-space: pre-wrap; user-select: all">${command}</pre>
    `).show()
  }

  private static connect (page: BridgePage, code: string, handlers: BridgeHandlers): void {
    const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/bridge/${code}`)
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ hello: page })) })
    socket.addEventListener('close', () => { setTimeout(() => { AppBridge.connect(page, code, handlers) }, 3000) })
    socket.addEventListener('message', (event) => {
      const { id, tool, args } = JSON.parse(String(event.data)) as { id: string, tool: string, args: BridgeArgs }
      const handler = handlers[tool]
      const reply = handler === undefined
        ? Promise.reject(new Error(`${tool} is not available on the ${page} page. Use open_page first.`))
        : Promise.resolve().then(() => handler(args ?? {}))
      reply
        .then((result) => { socket.send(JSON.stringify({ id, result: result ?? { ok: true } })) })
        .catch((error: unknown) => { socket.send(JSON.stringify({ id, error: error instanceof Error ? error.message : String(error) })) })
    })
  }

  private static common_handlers (page: BridgePage, code: string): BridgeHandlers {
    return {
      open_page: (args) => {
        const target = PAGE_PATHS[args.page as BridgePage]
        if (target === undefined) { throw new Error('page must be create, retarget or composer') }
        // reply first; the tab reconnects by itself and the next tool call waits for it
        const root = location.pathname.replace(/(retarget|composer)\/[^/]*$/, '').replace(/[^/]*$/, '')
        setTimeout(() => { location.assign(`${root}${target}?mcp=${code}`) }, 100)
        return { opening: args.page }
      },

      set_export_options: (args) => {
        Object.entries(EXPORT_OPTIONS).forEach(([key, group]) => {
          if (typeof args[key] === 'string') { set_checked(`input[name="${group}"][value="${args[key]}"]`, true) }
        })
        return { ok: true }
      },

      export: async () => {
        const button = el<HTMLButtonElement>(EXPORT_BUTTONS[page])
        if (button.disabled) { throw new Error('Nothing to export yet (select animations, or wait for the remix to be ready)') }
        const download = next_download()
        click(EXPORT_BUTTONS[page])
        return { downloaded: await download }
      }
    }
  }
}
