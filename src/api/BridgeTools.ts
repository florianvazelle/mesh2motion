/**
 * Tools that act on the user's open Mesh2Motion browser tab. The worker only relays them (see BridgeSession.ts);
 * the handlers live in the page (src/lib/bridge). Keep this file free of three.js and browser-only imports.
 */

const str = (description: string): Record<string, unknown> => ({ type: 'string', description })
const num = (description: string): Record<string, unknown> => ({ type: 'number', description })
const bool = (description = ''): Record<string, unknown> => ({ type: 'boolean', description })
const obj = (properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', properties, required })

// a model/animation file the tab downloads itself, or receives inline. The tab cannot read local paths
const file_props = {
  url: str('http(s) URL of the file. Use this for hosted files.'),
  base64: str('File content as base64, for local files. Needs file_name.'),
  file_name: str('File name with extension, e.g. "hero.glb"')
}

export interface BridgeTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const BRIDGE_TOOLS: BridgeTool[] = [
  // any page
  { name: 'get_state', description: 'Current page, step and what can be done next in the connected Mesh2Motion tab. Call this first.', inputSchema: obj() },
  { name: 'open_page', description: 'Switch the tab to a page: "create" (rig your own model, then animate/export), "retarget" (use a model that is already rigged), "composer" (Remix: mix upper and lower body of two animations).', inputSchema: obj({ page: { type: 'string', enum: ['create', 'retarget', 'composer'] } }, ['page']) },
  { name: 'set_export_options', description: 'Download settings used by export.', inputSchema: obj({
    format: { type: 'string', enum: ['glb', 'fbx'] },
    contents: { type: 'string', enum: ['full', 'skeleton'] },
    bone_naming: { type: 'string', enum: ['default', 'mixamo'], description: 'Human rig only' },
    fbx_preset: { type: 'string', enum: ['unreal', 'unity'] }
  }) },
  { name: 'export', description: 'Download the result (selected animations on create/retarget, the remix on composer) through the browser. Returns the downloaded file name.', inputSchema: obj() },

  // create page: your own model
  { name: 'load_builtin_model', description: 'create page, step 1: load the default model of a rig (ids from list_rigs).', inputSchema: obj({ rig_id: str('Rig id') }, ['rig_id']) },
  { name: 'load_own_model', description: 'create page, step 1: load your own GLB, FBX or ZIP (GLTF+BIN) model.', inputSchema: obj(file_props) },
  { name: 'position_model', description: 'create page, step 2: rotate the model by 90 degree turns, reset its position or align it to the floor.', inputSchema: obj({
    rotate_x: num('Number of 90 degree turns'), rotate_y: num('Number of 90 degree turns'), rotate_z: num('Number of 90 degree turns'),
    reset_position: bool('Reset position first'), align_to_floor: bool('Align to the floor')
  }) },
  { name: 'select_skeleton', description: 'create page, step 2: pick the skeleton template for the model.', inputSchema: obj({
    rig_id: str('Rig id'),
    hand_option: { type: 'string', enum: ['all-fingers', 'thumb-and-index', 'simplified-hand', 'single-bone'], description: 'Human rig only' },
    scale: num('Skeleton scale, 0.1 to 2.0 (1 = 100%)')
  }, ['rig_id']) },
  { name: 'next_step', description: 'create page: continue to the next step (load skeleton, edit skeleton, bind, animations). Weights are calculated automatically when binding.', inputSchema: obj({ weight_painting: bool('When binding from the edit skeleton step, stop at the weight painting step first') }) },
  { name: 'previous_step', description: 'create page: go back one step.', inputSchema: obj() },
  { name: 'set_edit_skeleton_options', description: 'create page, edit skeleton step: symmetric editing and weight preview.', inputSchema: obj({
    mirror: bool('Mirror bone edits left/right'),
    preview: { type: 'string', enum: ['painted', 'textured'] }
  }) },
  { name: 'reset_weights', description: 'create page, weight painting step: discard manual weights and recalculate automatically.', inputSchema: obj() },

  // create + retarget pages: animation listing
  { name: 'list_animations', description: 'create/retarget page: animations available for the rig (optionally filtered by text), with whether each is selected for export.', inputSchema: obj({ filter: str('Case-insensitive text in the name') }) },
  { name: 'select_animations', description: 'create/retarget page: choose animations for export by name. Replaces the current selection unless add is true.', inputSchema: obj({
    names: { type: 'array', items: { type: 'string' }, description: 'Exact animation names from list_animations' },
    all: bool('Select every animation instead'),
    add: bool('Keep the animations that are already selected')
  }) },
  { name: 'play_animation', description: 'create/retarget page: preview an animation on the model.', inputSchema: obj({ name: str('Animation name') }, ['name']) },
  { name: 'set_mirror_animations', description: 'create/retarget page: mirror animations left/right.', inputSchema: obj({ enabled: bool('Mirror on or off') }, ['enabled']) },
  { name: 'import_animations', description: 'create/composer page: import your own GLB/FBX animations for the current rig.', inputSchema: obj(file_props) },

  // retarget page: your own rigged model
  { name: 'retarget_set_source_rig', description: 'retarget page: the Mesh2Motion rig whose animations will be used.', inputSchema: obj({ rig_id: str('Rig id') }, ['rig_id']) },
  { name: 'retarget_load_model', description: 'retarget page: load your already rigged GLB, FBX or ZIP model.', inputSchema: obj(file_props) },
  { name: 'retarget_map_bones', description: 'retarget page: map bones between the rig and your model. Automatic mapping unless clear is true.', inputSchema: obj({ clear: bool('Clear all mappings instead') }) },
  { name: 'retarget_continue', description: 'retarget page: continue to the animation list (needs bone mappings) or, with back true, return to bone mapping.', inputSchema: obj({ back: bool() }) },

  // composer page: remix
  { name: 'composer_list_animations', description: 'composer page: animations available to put in the upper and lower body slots (human rig).', inputSchema: obj({ filter: str('Case-insensitive text in the name') }) },
  { name: 'composer_set_slot', description: 'composer page: put an animation in the upper or lower body slot. The remix plays and can be exported.', inputSchema: obj({
    slot: { type: 'string', enum: ['upper', 'lower'] }, animation: str('Exact animation name')
  }, ['slot', 'animation']) }
]

export const BRIDGE_TOOL_NAMES = new Set(BRIDGE_TOOLS.map(tool => tool.name))
