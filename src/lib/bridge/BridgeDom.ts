/** Small helpers for driving the page like a user would. Errors are written for the AI assistant reading them. */

export type BridgeArgs = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function el<T extends HTMLElement = HTMLElement> (selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) {
    throw new Error(`${selector} is not on this page or step. Call get_state to see where the tab is.`)
  }
  return element
}

export function click (selector: string): void {
  const button = el<HTMLButtonElement>(selector)
  if (button.disabled) {
    throw new Error(`${selector} is disabled right now (something has to be chosen or loaded first).`)
  }
  button.click()
}

// checkboxes and radios: click only when the state differs, so the app's own change handlers run
export function set_checked (selector: string, checked: boolean): void {
  const input = el<HTMLInputElement>(selector)
  if (input.checked !== checked) { input.click() }
}

export function choose (selector: string, value: string): void {
  const select = el<HTMLSelectElement>(selector)
  if (!Array.from(select.options).some(option => option.value === value)) {
    throw new Error(`"${value}" is not an option of ${selector}`)
  }
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

export function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function wait_until (condition: () => boolean, what: string, timeout_ms = 30_000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout_ms) {
      throw new Error(`Timed out waiting for ${what}`)
    }
    await sleep(100)
  }
}

/** A file given as a URL or as base64 (local files; the tab cannot read the user's disk) */
export async function file_from_args (args: BridgeArgs): Promise<File> {
  if (typeof args.url === 'string') {
    const response = await fetch(args.url)
    if (!response.ok) { throw new Error(`Could not download ${args.url} (HTTP ${response.status})`) }
    const name = String(args.file_name ?? new URL(args.url, location.href).pathname.split('/').pop() ?? 'file')
    return new File([await response.blob()], name)
  }
  if (typeof args.base64 === 'string' && typeof args.file_name === 'string') {
    const bytes = Uint8Array.from(atob(args.base64), c => c.charCodeAt(0))
    return new File([bytes], args.file_name)
  }
  throw new Error('Give either url, or base64 together with file_name')
}

export function put_file (input_selector: string, file: File): void {
  const input = el<HTMLInputElement>(input_selector)
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Resolves with the file name of the next download the app starts */
export function next_download (timeout_ms = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      document.removeEventListener('click', on_click, true)
      reject(new Error('The export did not produce a download'))
    }, timeout_ms)
    const on_click = (event: Event): void => {
      const link = event.target as HTMLAnchorElement
      if (link.tagName === 'A' && link.download !== '') {
        clearTimeout(timer)
        document.removeEventListener('click', on_click, true)
        resolve(link.download)
      }
    }
    document.addEventListener('click', on_click, true)
  })
}

const ANIMATION_ROWS = '#animations-items [data-animation-id].anim-item, #animations-items [data-animation-id].anim-custom-item'

function animation_rows (): Array<{ name: string, row: HTMLElement, checkbox: HTMLInputElement }> {
  return Array.from(document.querySelectorAll<HTMLElement>(ANIMATION_ROWS)).flatMap((row) => {
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
    return checkbox === null ? [] : [{ name: checkbox.name, row, checkbox }]
  })
}

const same_name = (a: string, b: string): boolean => a.replace(/ /g, '_').toLowerCase() === b.replace(/ /g, '_').toLowerCase()

/** Animation list shared by the create and retarget pages (same markup) */
export const animation_list_handlers = {
  async list_animations (args: BridgeArgs) {
    await wait_until(() => animation_rows().length > 0, 'the animation list (is the tab on the animations step?)', 20_000)
    const filter = String(args.filter ?? '').toLowerCase()
    const rows = animation_rows()
    return {
      total: rows.length,
      animations: rows.filter(r => r.name.toLowerCase().includes(filter)).map(r => r.name),
      selected: rows.filter(r => r.checkbox.checked).map(r => r.name)
    }
  },

  select_animations (args: BridgeArgs) {
    const rows = animation_rows()
    const wanted: string[] = args.names ?? []
    const unknown = wanted.filter(name => !rows.some(r => same_name(r.name, name)))
    if (unknown.length > 0) { throw new Error(`Unknown animations: ${unknown.join(', ')}. Use names from list_animations.`) }
    if (args.all !== true && wanted.length === 0) { throw new Error('Give names, or all: true') }

    rows.forEach((r) => {
      const should_check = args.all === true || wanted.some(name => same_name(r.name, name)) || (args.add === true && r.checkbox.checked)
      if (r.checkbox.checked !== should_check) { r.checkbox.click() }
    })
    return { selected: rows.filter(r => r.checkbox.checked).length }
  },

  play_animation (args: BridgeArgs) {
    const match = animation_rows().find(r => same_name(r.name, String(args.name)))
    const button = match?.row.querySelector<HTMLButtonElement>('button[data-action="play-animation"]')
    if (button == null) { throw new Error(`Unknown animation: ${String(args.name)}`) }
    button.click()
    return { playing: match?.name }
  },

  set_mirror_animations (args: BridgeArgs) {
    set_checked('#mirror-animations-checkbox', args.enabled === true)
    return { mirror: args.enabled === true }
  },

  async import_animations (args: BridgeArgs) {
    put_file('#import-animations-input', await file_from_args(args))
    return { imported: 'started; call list_animations to see the result' }
  }
}
