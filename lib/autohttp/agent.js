const { Agent: Http2Agent } = require('../http2')
const https = require('https')
const tls = require('tls')
const { EventEmitter } = require('events')
const net = require('net')
const url = require('url')

function calculateServerName (options) {
  let servername = options.host || ''
  const hostHeader = options.headers && options.headers.host

  if (hostHeader) {
    if (typeof hostHeader !== 'string') {
      throw new TypeError(
        'host header content must be a string, received' + hostHeader
      )
    }

    // abc => abc
    // abc:123 => abc
    // [::1] => ::1
    // [::1]:123 => ::1
    if (hostHeader.startsWith('[')) {
      const index = hostHeader.indexOf(']')
      if (index === -1) {
        // Leading '[', but no ']'. Need to do something...
        servername = hostHeader
      } else {
        servername = hostHeader.substring(1, index)
      }
    } else {
      servername = hostHeader.split(':', 1)[0]
    }
  }
  // Don't implicitly set invalid (IP) servernames.
  if (net.isIP(servername)) servername = ''
  return servername
}

function httpOptionsToUri (options) {
  return url.format({
    protocol: 'https',
    host: options.host || 'localhost'
  })
}

class AutoHttp2Agent extends EventEmitter {
  constructor (options) {
    super()
    this.http2Agent = new Http2Agent(options)
    this.httpsAgent = new https.Agent(options)
    this.ALPNCache = new Map()
    this.options = options
    this.defaultPort = 443
  }

  createConnection (
    req,
    reqOptions,
    cb,
    socketCb
  ) {
    const options = Object.assign({}, reqOptions, this.options)
    const name = this.getName(options)

    const uri = httpOptionsToUri(options)
    const port = Number(options.port || this.defaultPort)

    // check if there is ALPN cached
    const protocol = this.ALPNCache.get(name)
    if (protocol === 'h2') {
      const newOptions = Object.assign({}, options, {
        port,
        path: options.socketPath,
        host: options.hostname || options.host || 'localhost'
      })

      let connection
      try {
        connection = this.http2Agent.createConnection(req, uri, newOptions)
      } catch (e) {
        cb(e)
        connection && connection.socket && socketCb(connection.socket)
        return
      }
      cb(null, 'h2', connection)
      socketCb(connection.socket)
      return
    }
    if (protocol === 'http/1.1' || protocol === 'http/1.0') {
      const requestOptions = Object.assign({}, options, {
        agent: this.httpsAgent,
        host: options.hostname || options.host || 'localhost'
      })
      let request
      try {
        request = https.request(requestOptions)
      } catch (e) {
        cb(e)
        return
      }
      request.on('socket', (socket) => socketCb(socket))
      cb(null, 'http1', request)
      return
    }

    const newOptions = Object.assign({}, options, {
      port,
      path: options.socketPath,
      ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'],
      servername: options.servername || calculateServerName(options),
      host: options.hostname || options.host || 'localhost'
    })

    const socket = tls.connect(newOptions)
    socketCb(socket)
    socket.on('error', (e) => cb(e))
    socket.once('secureConnect', () => {
      const protocol = socket.alpnProtocol
      if (!protocol) {
        cb(socket.authorizationError, undefined, undefined)
        socket.end()
        return
      }

      this.ALPNCache.set(name, protocol)

      if (protocol === 'h2') {
        const newOptions = Object.assign({}, options, {
          port,
          path: options.socketPath,
          host: options.hostname || options.host || 'localhost'
        })
        try {
          const connection = this.http2Agent.createConnection(
            req,
            uri,
            newOptions,
            socket
          )
          cb(null, 'h2', connection)
        } catch (e) {
          cb(e)
        }
      } else if (protocol === 'http/1.1') {
        // Protocol is http1, using the built in
        // We need to release all free sockets so that new connection is created using the overriden createconnection forcing the agent to reuse the socket used for alpn

        // This reassignment works, since all code so far is sync, and happens in the same tick, hence there will be no race conditions
        const oldCreateConnection = this.httpsAgent.createConnection

        this.httpsAgent.createConnection = () => {
          return socket
        }

        const requestOptions = Object.assign({}, options, {
          agent: this.httpsAgent,
          host: options.hostname || options.host || 'localhost'
        })
        let request
        try {
          request = https.request(requestOptions)
        } catch (e) {
          cb(e)
          return
        } finally {
          this.httpsAgent.createConnection = oldCreateConnection
        }
        cb(null, 'http1', request)
      } else {
        cb(new Error('Unknown protocol' + protocol))
      }
    })
  }

  getName (options) {
    let name = options.host || 'localhost'

    name += ':'
    if (options.port) { name += options.port }

    name += ':'
    if (options.localAddress) { name += options.localAddress }

    if (options.path) { name += `:${options.path}` }

    name += ':'
    if (options.ca) { name += options.ca }

    name += ':'
    if (options.cert) { name += options.cert }

    name += ':'
    if (options.clientCertEngine) { name += options.clientCertEngine }

    name += ':'
    if (options.ciphers) { name += options.ciphers }

    name += ':'
    if (options.key) { name += options.key }

    name += ':'
    if (options.pfx) { name += options.pfx }

    name += ':'
    if (options.rejectUnauthorized !== undefined) { name += options.rejectUnauthorized }

    name += ':'
    if (options.servername && options.servername !== options.host) { name += options.servername }

    name += ':'
    if (options.minVersion) { name += options.minVersion }

    name += ':'
    if (options.maxVersion) { name += options.maxVersion }

    name += ':'
    if (options.secureProtocol) { name += options.secureProtocol }

    name += ':'
    if (options.crl) { name += options.crl }

    name += ':'
    if (options.honorCipherOrder !== undefined) { name += options.honorCipherOrder }

    name += ':'
    if (options.ecdhCurve) { name += options.ecdhCurve }

    name += ':'
    if (options.dhparam) { name += options.dhparam }

    name += ':'
    if (options.secureOptions !== undefined) { name += options.secureOptions }

    name += ':'
    if (options.sessionIdContext) { name += options.sessionIdContext }

    name += ':'
    if (options.sigalgs) { name += JSON.stringify(options.sigalgs) }

    name += ':'
    if (options.privateKeyIdentifier) { name += options.privateKeyIdentifier }

    name += ':'
    if (options.privateKeyEngine) { name += options.privateKeyEngine }

    return name
  }
}

module.exports = {
  AutoHttp2Agent,
  globalAgent: new AutoHttp2Agent({})
}
