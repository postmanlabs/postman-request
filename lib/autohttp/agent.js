const { Agent: Http2Agent } = require('../http2')
const https = require('https')
const tls = require('tls')
const { EventEmitter } = require('events')
const net = require('net')
const url = require('url')

// Referenced from https://github.com/nodejs/node/blob/0bf200b49a9a6eacdea6d5e5939cc2466506d532/lib/_http_agent.js#L350
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
    let options = Object.assign({}, reqOptions, this.options)
    options = Object.assign(options, {
      port: Number(options.port || this.defaultPort),
      host: options.hostname || options.host || 'localhost'
    })

    // check if ALPN is cached
    const name = this.getName(options)
    const [protocol, cachedSocket] = this.ALPNCache.get(name) || []

    if (!protocol || !cachedSocket || cachedSocket.closed || cachedSocket.destroyed) {
      // No cache exists or the initial socket used to establish the connection has been closed. Perform ALPN again.
      this.ALPNCache.delete(name)
      this.createNewSocketConnection(req, options, cb, socketCb)
      return
    }

    // No need to pass the cachedSocket since the respective protocol's agents will reuse the socket that was initially
    // passed during ALPN Negotiation
    if (protocol === 'h2') {
      const http2Options = Object.assign({}, options, {
        path: options.socketPath
      })

      let connection
      try {
        const uri = options.uri
        connection = this.http2Agent.createConnection(req, uri, http2Options)
      } catch (e) {
        cb(e)
        connection && connection.socket && socketCb(connection.socket)
        return
      }

      cb(null, 'http2', connection)
      socketCb(connection.socket)

      return
    }

    if (protocol === 'http/1.1' || protocol === 'http/1.0') {
      const http1RequestOptions = Object.assign({}, options, {
        agent: this.httpsAgent
      })

      let request
      try {
        request = https.request(http1RequestOptions)
      } catch (e) {
        cb(e)
        return
      }

      request.on('socket', (socket) => socketCb(socket))
      cb(null, 'http1', request)
    }
  }

  createNewSocketConnection (req, options, cb, socketCb) {
    const uri = options.uri
    const name = this.getName(options)

    const tlsSocketOptions = Object.assign({}, options, {
      path: options.socketPath,
      ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'],
      servername: options.servername || calculateServerName(options)
    })

    const socket = tls.connect(tlsSocketOptions)
    socketCb(socket)

    const socketConnectionErrorHandler = (e) => {
      cb(e)
    }
    socket.on('error', socketConnectionErrorHandler)

    socket.once('secureConnect', () => {
      socket.removeListener('error', socketConnectionErrorHandler)

      const protocol = socket.alpnProtocol

      if (!protocol) {
        cb(socket.authorizationError)
        socket.end()
        return
      }

      if (protocol !== 'h2' && protocol !== 'http/1.1') {
        cb(new Error('Unknown protocol' + protocol))
        return
      }

      // Update the cache
      this.ALPNCache.set(name, [protocol, socket])

      socket.on('close', () => {
        // Clean the cache when the socket closes
        this.ALPNCache.delete(name)
      })

      if (protocol === 'h2') {
        const http2Options = Object.assign({}, options, {
          path: options.socketPath
        })
        try {
          const connection = this.http2Agent.createConnection(
            req,
            uri,
            http2Options,
            socket
          )
          cb(null, 'http2', connection)
        } catch (e) {
          cb(e)
        }
      }
      if (protocol === 'http/1.1' || protocol === 'http/1.0') {
        // Protocol is http1, using the built in agent
        // We need to release all free sockets so that new connection is created using the overridden createconnection
        // forcing the agent to reuse the socket used for alpn

        // This reassignment works, since all code so far is sync, and happens in the same tick, hence there will be no
        // race conditions
        const oldCreateConnection = this.httpsAgent.createConnection

        this.httpsAgent.createConnection = () => {
          return socket
        }

        const http1RequestOptions = Object.assign({}, options, {
          agent: this.httpsAgent
        })
        let request
        try {
          request = https.request(http1RequestOptions)
        } catch (e) {
          cb(e)
          return
        } finally {
          this.httpsAgent.createConnection = oldCreateConnection
        }
        cb(null, 'http1', request)
      }
    })
  }

    /*
     * This function has been borrowed from Node.js HTTPS Agent implementation
     * Ref: v20.15.0 https://github.com/nodejs/node/blob/6bf148e12b00a3ec596f4c123ec35445a48ab209/lib/https.js
     */
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
    if (options.extraCA) { name += options.extraCA }

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
