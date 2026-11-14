import { type Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'
import { ProcessStep } from '../enums/ProcessStep.ts'
import { RigConfig } from '../RigConfig.ts'
import { type BridgeHandlers } from './AppBridge.ts'
import { type BridgeArgs, animation_list_handlers, choose, click, el, file_from_args, put_file, set_checked, sleep, wait_until } from './BridgeDom.ts'

/** Tools for the create page: the step flow (load model -> skeleton -> edit -> weights -> animations) */
export function create_page_handlers (engine: Mesh2MotionEngine): BridgeHandlers {
  const step = (): ProcessStep => engine.process_step

  const require_step = (...allowed: ProcessStep[]): void => {
    if (!allowed.includes(step())) {
      throw new Error(`This needs the ${allowed.join(' or ')} step, but the tab is on ${step()}. Use next_step / previous_step.`)
    }
  }

  const rig_or_throw = (rig_id: unknown): NonNullable<ReturnType<typeof RigConfig.by_key>> => {
    const rig = RigConfig.by_key(String(rig_id))
    if (rig === undefined) { throw new Error(`Unknown rig: ${String(rig_id)}. Use list_rigs.`) }
    return rig
  }

  const loaded = async (): Promise<unknown> => {
    await wait_until(() => step() === ProcessStep.LoadSkeleton, 'the model to load (check it is a valid GLB/FBX/ZIP)', 60_000)
    return { step: step() }
  }

  // buttons that leave a step, and where they should end up
  const forward: Partial<Record<ProcessStep, string>> = {
    [ProcessStep.LoadSkeleton]: '#load-skeleton-button',
    [ProcessStep.EditSkeleton]: '#action_bind_pose',
    [ProcessStep.WeightPainting]: '#action_continue_to_animations'
  }
  const backward: Partial<Record<ProcessStep, string>> = {
    [ProcessStep.LoadSkeleton]: '#action_back_to_load_model',
    [ProcessStep.EditSkeleton]: '#action_back_to_load_skeleton',
    [ProcessStep.WeightPainting]: '#action_back_to_edit_skeleton_from_weight_paint',
    [ProcessStep.AnimationsListing]: '#action_back_to_edit_skeleton'
  }

  const move = async (buttons: Partial<Record<ProcessStep, string>>, what: string): Promise<unknown> => {
    const from = step()
    const button = buttons[from]
    if (button === undefined) { throw new Error(`Cannot ${what} from the ${from} step`) }
    click(button)
    await wait_until(() => step() !== from, `the ${what} step change`, 60_000)
    return { step: step() }
  }

  return {
    get_state: () => ({
      page: 'create',
      step: step(),
      step_label: document.querySelector('#current-step-label')?.textContent?.trim(),
      rig: step() === ProcessStep.LoadModel ? null : engine.load_skeleton_step.skeleton_type()
    }),

    load_builtin_model: async (args) => {
      require_step(ProcessStep.LoadModel)
      choose('#model-selection', rig_or_throw(args.rig_id).model_file)
      click('#load-model-button')
      return await loaded()
    },

    load_own_model: async (args) => {
      require_step(ProcessStep.LoadModel)
      put_file('#model-upload', await file_from_args(args))
      return await loaded()
    },

    position_model: (args) => {
      require_step(ProcessStep.LoadSkeleton)
      if (args.reset_position === true) { click('#reset-model-position-button') }
      ;(['x', 'y', 'z'] as const).forEach((axis) => {
        const turns = ((Math.round(Number(args[`rotate_${axis}`] ?? 0)) % 4) + 4) % 4
        for (let i = 0; i < turns; i++) { click(`#rotate-model-${axis}-button`) }
      })
      if (args.align_to_floor === true) { click('#auto-align-model-button') }
      return { ok: true }
    },

    select_skeleton: async (args: BridgeArgs) => {
      require_step(ProcessStep.LoadSkeleton)
      choose('#skeleton-selection', rig_or_throw(args.rig_id).skeleton_type)
      if (typeof args.hand_option === 'string') { choose('#hand-skeleton-selection', args.hand_option) }
      if (typeof args.scale === 'number') {
        const slider = el<HTMLInputElement>('#scale-skeleton-input')
        slider.value = String(args.scale)
        slider.dispatchEvent(new Event('input', { bubbles: true }))
      }
      // shortcut: the app shows no "preview loaded" signal, so give the template a moment to load before continuing
      await sleep(800)
      await wait_until(() => !el<HTMLButtonElement>('#load-skeleton-button').disabled, 'the skeleton preview')
      return { rig: args.rig_id }
    },

    next_step: async (args) => {
      if (step() === ProcessStep.LoadModel) { throw new Error('Load a model first (load_builtin_model or load_own_model)') }
      if (step() === ProcessStep.AnimationsListing) { throw new Error('This is the last step: select_animations, then export') }
      if (step() === ProcessStep.EditSkeleton) {
        set_checked('#enable-weight-paint-step', args.weight_painting === true)
      }
      return await move(forward, 'continue')
    },

    previous_step: async () => await move(backward, 'go back'),

    set_edit_skeleton_options: (args) => {
      require_step(ProcessStep.EditSkeleton)
      if (typeof args.mirror === 'boolean') { set_checked('#mirror-skeleton', args.mirror) }
      if (args.preview === 'painted' || args.preview === 'textured') { set_checked(`#preview-${args.preview}`, true) }
      return { ok: true }
    },

    reset_weights: () => {
      require_step(ProcessStep.WeightPainting)
      click('#weight-paint-step-reset')
      return { ok: true }
    },

    ...animation_list_handlers
  }
}
