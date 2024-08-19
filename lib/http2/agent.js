const { EventEmitter } = require('events')
const http2 = require('http2')
const { getName: getConnectionName } = require('../autohttp/requestName')

class Http2Agent extends EventEmitter {
  constructor (options) {
    super()
    this.options = options
    this.connections = {}
  }

  createConnection (req, uri, options, socket) {
    const _options = {
      ...options,
      ...this.options
    }

    const name = getConnectionName(_options)
    let connection = this.connections[name]

    // Force create a new connection if the connection is destroyed or closed or a new socket object is supplied
    if (!connection || connection.destroyed || connection.closed || socket) {
      const connectionOptions = {
        ..._options,
        port: _options.port || 443,
        settings: {
          enablePush: false
        }
      }

      // check if a socket is supplied
      if (socket) {
        connectionOptions.createConnection = () => socket
      }

      connection = http2.connect(uri, connectionOptions)
      // Connection is created in an unreferenced state and is referenced when a stream is created
      // This is to prevent the connection from keeping the event loop alive
      connection.unref()

      // Counting semaphore, but since node is single-threaded, this is just a counter
      // Multiple streams can be active on a connection
      // Each stream refs the connection at the start, and unrefs it on end
      // The connection should terminate if no streams are active on it
      // Could be refactored into something prettier
      const oldRef = connection.ref
      const oldUnref = connection.unref

      const timeoutHandler = () => {
        delete connectionsMap[name]
        connection.close()
      }

      connection.refCount = 0
      connection.ref = function () {
        this.refCount++
        oldRef.call(this)
        connection.off('timeout', timeoutHandler)
        connection.setTimeout(0)
      }
      const connectionsMap = this.connections
      connection.unref = function () {
        this.refCount--
        if (this.refCount === 0) {
          oldUnref.call(this)
          if (_options.timeout) {
            connection.setTimeout(_options.timeout, timeoutHandler)
          }
        }
      }

      // Add a default error listener to HTTP2 session object to transparently swallow errors incase no streams are active
      // Remove the connection from the connections map if the connection has errored out
      connection.on('error', () => {
        delete this.connections[name]
      })

      connection.once('close', () => {
        delete this.connections[name]
      })

      this.connections[name] = connection
    }

    return connection
  }
}

module.exports = {
  Http2Agent,
  globalAgent: new Http2Agent({})
}
