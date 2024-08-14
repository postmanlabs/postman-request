const { EventEmitter } = require('events')
const { Http2Request: HTTP2Request } = require('../../lib/http2/request')
const { globalAgent } = require('./agent')
const { validateRequestHeaders } = require('./headerValidations')

const kJobs = Symbol('kJobs')

class MultiProtocolRequest extends EventEmitter {
  constructor (options) {
    super()
    this[kJobs] = []
    this.options = options
    this.options.host = options.hostname || options.host || 'localhost'

    const agent = options.agent || globalAgent
    // Request agent to perform alpn and return either an http agent or https agent
    // Pass the request to the agent, the agent then calls the callback with http or http2 argument based on the result
    // of alpn negotiation
    agent.createConnection(this, options, (err, proto, req) => {
      if (err) {
        this.emit('error', err)
        return
      }
      if (proto === 'http2') {
        this.onHttp2(req)
      }
      if (proto === 'http1') {
        this.onHttp(req)
      }
    }, (socket) => {
      // Need to register callback after this tick, after the on socket handlers have been registered.
      // Node also does something similar when emitting the socket event.
      process.nextTick(() => this.emit('socket', socket))
      this.socket = socket
    })
  }

  onHttp2 (connection) {
    const options = {
      ...this.options,
      agent: {
        createConnection: () => connection
      }
    }

    let req
    try {
      req = new HTTP2Request(options)
    } catch (e) {
      this.emit('error', e)
      return
    }
    this.registerCallbacks(req)
    this._req = req
    this.processQueuedOpens()
  }

  onHttp (req) {
    this.registerCallbacks(req)
    this._req = req
    this.processQueuedOpens()
  }

  registerCallbacks (ob) {
    ob.on('drain', (...args) => this.emit('drain', ...args))
    ob.on('end', (...args) => this.emit('end', ...args))
    ob.on('close', (...args) => this.emit('close', ...args))
    ob.on('response', (...args) => this.emit('response', ...args))
    ob.on('error', (...args) => this.emit('error', ...args))
  }

  processQueuedOpens () {
    this[kJobs].forEach((action) => {
      action()
    })
    this[kJobs] = []
  }

  write (data) {
    const action = () => this._req.write(data)
    if (this._req) {
      action()
      return true
    }
    this[kJobs].push(action)
    return true
  }

  end (data) {
    const action = () => {
      this._req.end(data)
    }
    if (this._req) {
      action()
      return this
    }
    this[kJobs].push(action)
    return this
  }

  setDefaultEncoding (encoding) {
    const action = () => this._req.setDefaultEncoding(encoding)
    if (this._req) {
      action()
      return this
    }

    this[kJobs].push(action)
    return this
  }

  get _header () {
    if (this._req && this._req._header) {
      return this._req._header
    }
    return new Promise((resolve) => {
      const action = () => resolve(this._req._header)
      this[kJobs].push(action)
    })
  }

  pipe (destination, options) {
    const action = () => this._req.pipe(destination, options)
    if (this._req) {
      action()
      return destination
    }
    this[kJobs].push(action)
    return destination
  }

  setTimeout (timeout, callback) {
    const action = () => this._req.setTimeout(timeout, callback)
    if (this._req) {
      action()
      return this
    }
    this[kJobs].push(action)
    return this
  }

  abort () {
    const action = () => this._req.abort()
    if (this._req) {
      action()
      return this
    }
    this[kJobs].push(action)
    return this
  }

  setHeader (name, value) {
    const action = () => this._req.setHeader(name, value)
    if (this._req) {
      action()
      return this
    }
    this[kJobs].push(action)
    return this
  }

  removeHeader (name) {
    const action = () => this._req.removeHeader(name)
    if (this._req) {
      action()
      return this
    }
    this[kJobs].push(action)
    return this
  }
}

function request (options) {
  // request was received here, that means protocol is auto, that means priority order is http2, http
  // There can be 2 cases

  // 1. We have performed ALPN negotiation before for this host/port with the same agent options
  // 2. We need to perform ALPN negotiation, add the socket used to perform negotiation to the appropriate agent
  // 2.1 Add the agent to the pool if it didn't already exist

  // HTTP/2 internal implementation sucks. In case of an invalid HTTP/2 header, it destroys the entire session and
  // emits an error asynchronously, instead of throwing it synchronously. Hence, it makes more sense to perform all
  // validations before sending the request.
  validateRequestHeaders(options.headers)

  return new MultiProtocolRequest(options)
}

module.exports = {
  request,
  MultiProtocolRequest
}
