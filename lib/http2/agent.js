const { EventEmitter } = require('events')
const http2 = require('http2')

class Http2Agent extends EventEmitter {
  constructor (options) {
    super()
    this.options = options
    this.connections = {}
  }

  createConnection (req, uri, options, socket) {
    const _options = Object.assign({}, options, this.options)
    const name = this.getName(_options)
    let connection = this.connections[name]

    if (!connection || connection.destroyed || connection.closed) {
      const connectionOptions = Object.assign({}, options,
        { createConnection: undefined, port: _options.port || 443, settings: {
          enablePush: false
        } })

      // check if a socket is supplied
      if (socket) {
        connectionOptions.createConnection = () => socket
      }

      connection = http2.connect(uri, connectionOptions)

      // Counting semaphore, but since node is single-threaded, this is just a counter
      // Multiple streams can be active on a connection
      // Each stream refs the connection at the start, and unrefs it on end
      // The connection should terminate if no streams are active on it
      // Could be refactored into something prettier
      const oldRef = connection.ref
      const oldUnref = connection.unref

      connection.refCount = 0
      connection.ref = function () {
        this.refCount++
        oldRef.call(this)
        connection.removeAllListeners('timeout')
        connection.setTimeout(0)
      }
      const connectionsMap = this.connections
      connection.unref = function () {
        this.refCount--
        if (this.refCount === 0) {
          oldUnref.call(this)
          if (_options.sessionIdleTimeout) {
            connection.setTimeout(_options.sessionIdleTimeout, () => {
              connection.close()
              delete connectionsMap[name]
            })
          }
        }
      }

      // Add a default error listener to HTTP2 session object to transparently swallow errors incase no streams are active
      // Remove the connection from the connections map if the connection has errored out
      connection.on('error', () => {
        delete connectionsMap[name]
      })

      this.connections[name] = connection
    }
    connection.ref()
    req.once('close', () => {
      connection.unref()
    })

    return connection
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

    // Create new connection since previous connection cannot be reused since it will not emit secureConnect event which will not set the session data
    name += ':' + Boolean(options.verbose)

    return name
  }
}

const globalAgent = new Http2Agent({})

module.exports = {
  Http2Agent,
  globalAgent
}
