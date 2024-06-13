import { AutoHttp2Agent, globalAgent } from './agent'
import { request } from './request'

export default {
  Agent: AutoHttp2Agent,
  request,
  globalAgent
}
