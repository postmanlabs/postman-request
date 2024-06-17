const url = require('url')
const http2 = require('http2')
const { EventEmitter } = require('events')
const { globalAgent } = require('./http2Agent')
const { assertValidPseudoHeader, checkIsHttpToken } = require('../autohttp/utils/headers')

function httpOptionsToUri (options) {
  return url.format({
    protocol: 'https',
    host: options.host || 'localhost'
  })
}

function headerKeyTitleCase (key) {
  return key.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('-')
}

class Http2Request extends EventEmitter {
  constructor (options) {
    super()
    this.requestHeaders = {}
    this.connectionHeaders = ['connection', 'host']
    this.onError = this.onError.bind(this)
    this.registerListeners = this.registerListeners.bind(this)
    const headers = options.headers

    const uri = httpOptionsToUri(options)
    const _options = Object.assign({}, options, {
      port: Number(options.port || 443),
      path: undefined,
      host: options.hostname || options.host || 'localhost'
    })

    if (options.socketPath) {
      options.path = options.socketPath
    }

    const agent = options.agent || globalAgent

    this._client = agent.createConnection(this, uri, _options)

    this.requestHeaders = Object.assign({
      [http2.constants.HTTP2_HEADER_PATH]: options.path || '/',
      [http2.constants.HTTP2_HEADER_METHOD]: _options.method,
      [http2.constants.HTTP2_HEADER_AUTHORITY]: _options.host
    }, headers)
    this.socket = this._client.socket

    this.requestHeaders = Object.fromEntries(
      Object.entries(this.requestHeaders)
        .map(([key, value]) => ([key.toLowerCase(), value]))
        .filter(([key]) => !(options.blacklistHeaders || []).includes(key))
        .filter(([key]) => !this.connectionHeaders.includes(key))
    )

    this.stream = this._client.request(this.requestHeaders, { endStream: false })

    this.registerListeners()
  }

  get _header () {
    return Object.entries(this.stream.sentHeaders)
      .map(([key, value]) => `${headerKeyTitleCase(key)}: ${value}`)
      .join('\r\n') + '\r\n\r\n'
  }

  get httpVersion () {
    return '2.0'
  }

  registerListeners () {
    this.stream.on('drain', () => this.emit('drain', arguments))
    this.stream.on('error', (e) => this.emit('error', e))

    this.stream.on('close', (...args) => {
      this.emit('close', args)
    })

    this._client.once('error', this.onError)
    this.stream.on('response', (response) => {
      this.emit('response', new ResponseProxy(response, this))
    })

    this.stream.on('end', () => {
      this._client.off('error', this.onError)
    })
  }

  onError (e) {
    this.emit('error', e)
  }

  setDefaultEncoding (encoding) {
    this.stream.setDefaultEncoding(encoding)
    return this
  }

  setEncoding (encoding) {
    this.stream.setEncoding(encoding)
  }

  write (chunk) {
    this.stream.write(chunk)
  }

  pipe (dest) {
    this.stream.pipe(dest)
  }

  on (eventName, listener) {
    if (eventName === 'socket') {
      listener(this.socket)
      return this
    }

    return super.on(eventName, listener)
  }

  abort () {
    this.stream.destroy()
  }

  end () {
    this.stream.end()
  }

  setTimeout (timeout, cb) {
    this.stream.setTimeout(timeout, cb)
  }

  removeHeader () {
    // This is a no-op since http2 headers are immutable, thus we consume blacklisted headers at the start in the constructor itself

  }
}

function request (options) {
  const headers = options.headers

  // HTTP/2 internal implementation sucks. In case of an invalid HTTP/2 header, it destroys the entire session and
  // emits an error asynchronously, instead of throwing it synchronously. Hence, it makes more sense to perform all
  // validations before sending the request.
  if (headers !== null && headers !== undefined) {
    const keys = Object.keys(headers)
    for (let i = 0; i < keys.length; i++) {
      const header = keys[i]
      if (header[0] === ':') {
        assertValidPseudoHeader(header)
      } else if (header && !checkIsHttpToken(header)) { throw new Error('Invalid HTTP Token: Header name' + header) }
    }
  }
  return new Http2Request(options)
}

class ResponseProxy extends EventEmitter {
  constructor (response, request) {
    super()
    this.httpVersion = '2.0'
    this.req = request
    this.response = response
    this.on = this.on.bind(this)
    this.registerRequestListeners()
  }

  registerRequestListeners () {
    this.req.stream.on('error', (e) => this.emit('error', e))
    this.req.stream.on('close', () => {
      this.emit('close')
    })
  }

  on (eventName, listener) {
    super.on(eventName, listener)
    if (eventName === 'data') {
      // Attach the data listener to the request stream only when there is a listener.
      // This is because the data event is emitted by the request stream and the response stream is a proxy
      // that forwards the data event to the response object.
      // If there is no listener attached and we use the event forwarding pattern above, the data event will still be emitted
      // but with no listeners attached to it, thus causing data loss.
      this.req.stream.on('data', (chunk) => {
        this.emit('data', chunk)
      })
    }

    if (eventName === 'end') {
      this.req.stream.on('end', listener)
    }
    return this
  }

  get statusCode () {
    return this.response[http2.constants.HTTP2_HEADER_STATUS]
  }

  get rawHeaders () {
    return Object.entries(this.response).flat()
  }

  get headers () {
    return this.response
  }

  pause () {
    this.req.stream.pause()
  }

  resume () {
    this.req.stream.resume()
  }

  pipe (dest) {
    this.req.stream.pipe(dest)
  }

  setEncoding (encoding) {
    this.req.stream.setEncoding(encoding)
  }

  destroy () {
    this.req.stream.destroy()
  }
}

module.exports = {
  request,
  Http2Request
}
