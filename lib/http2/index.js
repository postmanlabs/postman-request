const { Http2Agent, globalAgent } = require('./agent')
const { request } = require('./request')

module.exports = {
  Agent: Http2Agent,
  request,
  globalAgent
}
