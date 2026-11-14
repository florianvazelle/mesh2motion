import { Mesh2MotionEngine } from './Mesh2MotionEngine'
import { AppBridge } from './lib/bridge/AppBridge'
import { create_page_handlers } from './lib/bridge/CreateBridge'

export class CustomModelUploadBootstrap {
  private readonly mesh2motion_engine: Mesh2MotionEngine

  constructor () {
    this.mesh2motion_engine = new Mesh2MotionEngine()
    AppBridge.start('create', create_page_handlers(this.mesh2motion_engine))
  }
}

// instantiate the class to setup event listeners
const app = new CustomModelUploadBootstrap()
