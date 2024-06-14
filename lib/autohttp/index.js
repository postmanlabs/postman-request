const { AutoHttp2Agent, globalAgent } = require('./agent')
const { request } = require('./request')

module.exports = {
  Agent: AutoHttp2Agent,
  request,
  globalAgent
}
