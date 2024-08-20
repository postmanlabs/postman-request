const { Agent: Http2Agent } = require('../http2')
const https = require('https')
const tls = require('tls')
const { EventEmitter } = require('events')
const net = require('net')
const { getName: getSocketName } = require('../autohttp/requestName')

// All valid options defined at https://www.iana.org/assignments/tls-extensiontype-values/tls-extensiontype-values.xhtml#alpn-protocol-ids
const supportedProtocols = ['h2', 'http/1.1', 'http/1.0', 'http/0.9']

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
    const options = {
      ...reqOptions,
      ...this.options,
      port: Number(reqOptions.port || this.options.port || this.defaultPort),
      host: reqOptions.hostname || reqOptions.host || 'localhost'
    }

    // check if ALPN is cached
    const name = getSocketName(options)
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
      const http2Options = {
        ...options,
        path: options.socketPath
      }

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

    const http1RequestOptions = {
      ...options,
      agent: this.httpsAgent
    }

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

  createNewSocketConnection (req, options, cb, socketCb) {
    const uri = options.uri
    const name = getSocketName(options)

    const socket = tls.connect({
      ...options,
      path: options.socketPath,
      ALPNProtocols: supportedProtocols,
      servername: options.servername || calculateServerName(options)
    })
    socketCb(socket)

    const socketConnectionErrorHandler = (e) => {
      cb(e)
    }
    socket.on('error', socketConnectionErrorHandler)

    socket.once('secureConnect', () => {
      socket.removeListener('error', socketConnectionErrorHandler)

      const protocol = socket.alpnProtocol || 'http/1.1'

      if (!supportedProtocols.includes(protocol)) {
        cb(new Error('Unknown protocol' + protocol))
        return
      }

      // Update the cache
      this.ALPNCache.set(name, [protocol, socket])

      socket.once('close', () => {
        // Clean the cache when the socket closes
        this.ALPNCache.delete(name)
      })

      if (protocol === 'h2') {
        const http2Options = {
          ...options,
          path: options.socketPath
        }
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
        return
      }

      // Protocol is http1, using the built in agent
      // We need to release all free sockets so that new connection is created using the overridden createconnection
      // forcing the agent to reuse the socket used for alpn

      // This reassignment works, since all code so far is sync, and happens in the same tick, hence there will be no
      // race conditions
      const oldCreateConnection = this.httpsAgent.createConnection

      this.httpsAgent.createConnection = () => {
        return socket
      }

      const http1RequestOptions = {
        ...options,
        agent: this.httpsAgent
      }
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
    })
  }
}

module.exports = {
  AutoHttp2Agent,
  globalAgent: new AutoHttp2Agent({})
}
