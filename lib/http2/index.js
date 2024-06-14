const { Http2Agent, globalAgent } = require('./http2Agent')
const { request } = require('./request');

module.exports = {
  Agent: Http2Agent,
  request,
  globalAgent
}
