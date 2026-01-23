'use strict'

const { SocksProxyAgent } = require('socks-proxy-agent')
const ALLOWED_PROTOCOLS = ['socks4:', 'socks4a:', 'socks5:', 'socks5h:', 'socks:']

function SocksProxy (request) {
  this.request = request
}

SocksProxy.prototype.isEnabled = function () {
  const self = this
  const request = self.request

  if (typeof request.proxy === 'string') {
    request.proxy = request.urlParser.parse(request.proxy)
  }

  if (!request.proxy) {
    return false
  }

  return request.proxy.href && ALLOWED_PROTOCOLS.includes(request.proxy.protocol)
}

SocksProxy.prototype.setup = function () {
  const self = this
  const request = self.request

  if (!self.isEnabled()) {
    return false
  }

  let proxyUrl = request.proxy.href

  // Handle authentication from proxy.auth if not already in URL
  if (request.proxy.auth && proxyUrl.indexOf('@') === -1) {
    proxyUrl = request.proxy.protocol + '//' + request.proxy.auth + '@' + request.proxy.host
  }

  request.agent = new SocksProxyAgent(proxyUrl)

  return true
}

exports.SocksProxy = SocksProxy
