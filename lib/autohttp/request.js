const { EventEmitter } =require( 'events')
const {  Http2Request : HTTP2Request }=require( '../../lib/http2/request')
const {  globalAgent } =require( './agent');

class MultiProtocolRequest extends EventEmitter{

  constructor (options) {
    super()
    this.queuedOps = []
    this.onHttp2 = this.onHttp2.bind(this)
    this.onHttp = this.onHttp.bind(this)
    this.options = options
    this.options.host = options.hostname || options.host || 'localhost'

    const agent = options.agent || globalAgent
    // Request agent to perform alpn and return either an http agent or https agent
    // Pass the request to the agent, the agent then calls the callback with http or h2 argument based on the result of alpn negotiation
    agent.createConnection(this, options, (err, proto, req) => {
      if (err) {
        this.emit('error', err)
        return
      }
      if (proto === 'h2') {
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

    const options = {...this.options, agent: {
        createConnection: () => connection
    }}
    const req = new HTTP2Request(options)
    this.registerCallbacks(req)
    this.processQueuedOpens(req)
    this._req = req
  }

  onHttp (req) {
    this.registerCallbacks(req)
    this.processQueuedOpens(req)
    this._req = req
  }

  registerCallbacks (ob) {
    ob.on('drain', (...args) => this.emit('drain', ...args))
    ob.on('error', (...args) => this.emit('error', ...args))

    ob.on('end', (...args) => this.emit('end', ...args))
    ob.on('close', (...args) => {
      this.emit('close', ...args)
    })
    ob.on('response', (...args) => {
      this.emit('response', ...args)
    })

    ob.once('error', (...args) => this.emit('error', ...args))
  }

  processQueuedOpens (ob) {
    this.queuedOps.forEach(([op, ...args]) => {
      if (op === 'end') {
        ob.end(...args)
      }

      if (op === 'write') {
        ob.write(...args)
      }

      if (op === 'setDefaultEncoding') {
        ob.setDefaultEncoding(args)
      }

      if (op === 'pipe') {
        ob.pipe(...args)
      }

      if (op === 'setTimeout') {
        ob.setTimeout(...args)
      }
      if (op === 'abort') {
        ob.abort()
      }
    })
    this.queuedOps = []
  }

  write (data) {
    if (this._req) {
      this._req.write(data)
      return true
    }
    this.queuedOps.push(['write', data])
    return true
  }

  end (data) {
    if (this._req) {
      this._req.end(data)
      return this
    }
    this.queuedOps.push(['end', data])
    return this
  }

  setDefaultEncoding (encoding) {
    if (this._req) {
      this._req.setDefaultEncoding(encoding)
      return this
    }

    this.queuedOps.push(['setDefaultEncoding', encoding])
    return this
  }

  pipe(destination, options) {
    if (this._req) {
      this._req.pipe(destination, options)
      return destination
    }
    this.queuedOps.push(['pipe', destination, options])
    return destination
  }

  setTimeout (timeout, callback) {
    if (this._req) {
      this._req.setTimeout(timeout, callback())
      return this
    }
    this.queuedOps.push(['setTimeout', timeout, callback])
    return this
  }

  abort () {
    if (this._req) {
      this._req.abort()
      return this
    }
    this.queuedOps.push(['abort'])
    return this
  }
}

function request (options) {
  // request was received here, that means protocol is auto, that means priority order is http2, http
  // There can be 2 cases

  // 1. We have performed ALPN negotiation before for this host/port with the same agent options
  // 2. We need to perform ALPN negotiation, add the socket used to perform negotiation to the appropriate agent
  // 2.1 Add the agent to the pool if it didn't already exist

  return new MultiProtocolRequest(options)
}

module.exports = {
  request,
  MultiProtocolRequest
}

