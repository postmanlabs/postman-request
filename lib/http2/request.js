const url = require('url')
const http2 = require('http2')
const { EventEmitter } = require('events')
const { globalAgent } = require('./agent')
const { validateRequestHeaders } = require('../autohttp/headerValidations')

const kHeadersFlushed = Symbol('kHeadersFlushed')
// Connection headers that should not be set by the user. Ref; https://datatracker.ietf.org/doc/html/rfc9113#name-connection-specific-header-
const connectionHeaders = ['connection', 'host', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade']

// HTTP/2 error codes. Moving to a separate variable to prevent browser builds from breaking
const http2Constants = http2.constants || {}
const rstErrorCodesMap = {
  [http2Constants.NGHTTP2_NO_ERROR]: 'NGHTTP2_NO_ERROR',
  [http2Constants.NGHTTP2_PROTOCOL_ERROR]: 'NGHTTP2_PROTOCOL_ERROR',
  [http2Constants.NGHTTP2_INTERNAL_ERROR]: 'NGHTTP2_INTERNAL_ERROR',
  [http2Constants.NGHTTP2_FLOW_CONTROL_ERROR]: 'NGHTTP2_FLOW_CONTROL_ERROR',
  [http2Constants.NGHTTP2_SETTINGS_TIMEOUT]: 'NGHTTP2_SETTINGS_TIMEOUT',
  [http2Constants.NGHTTP2_STREAM_CLOSED]: 'NGHTTP2_STREAM_CLOSED',
  [http2Constants.NGHTTP2_FRAME_SIZE_ERROR]: 'NGHTTP2_FRAME_SIZE_ERROR',
  [http2Constants.NGHTTP2_REFUSED_STREAM]: 'NGHTTP2_REFUSED_STREAM',
  [http2Constants.NGHTTP2_CANCEL]: 'NGHTTP2_CANCEL',
  [http2Constants.NGHTTP2_COMPRESSION_ERROR]: 'NGHTTP2_COMPRESSION_ERROR',
  [http2Constants.NGHTTP2_CONNECT_ERROR]: 'NGHTTP2_CONNECT_ERROR',
  [http2Constants.NGHTTP2_ENHANCE_YOUR_CALM]: 'NGHTTP2_ENHANCE_YOUR_CALM',
  [http2Constants.NGHTTP2_INADEQUATE_SECURITY]: 'NGHTTP2_INADEQUATE_SECURITY',
  [http2Constants.NGHTTP2_HTTP_1_1_REQUIRED]: 'NGHTTP2_HTTP_1_1_REQUIRED'
}

function httpOptionsToUri (options) {
  return url.format({
    protocol: 'https',
    host: options.host || 'localhost'
  })
}

class Http2Request extends EventEmitter {
  constructor (options) {
    super()
    this.onError = this.onError.bind(this)
    this.onDrain = this.onDrain.bind(this)
    this.onClose = this.onClose.bind(this)
    this.onResponse = this.onResponse.bind(this)
    this.onEnd = this.onEnd.bind(this)
    this.onTimeout = this.onTimeout.bind(this)

    this.registerListeners = this.registerListeners.bind(this)
    this._flushHeaders = this._flushHeaders.bind(this)
    this[kHeadersFlushed] = false

    const uri = httpOptionsToUri(options)
    const _options = {
      ...options,
      port: Number(options.port || 443),
      path: undefined,
      host: options.hostname || options.host || 'localhost'
    }

    if (options.socketPath) {
      _options.path = options.socketPath
    }

    const agent = options.agent || globalAgent

    this._client = agent.createConnection(this, uri, _options)

    const headers = options.headers || {}

    this.requestHeaders = {
      ...headers,
      [http2.constants.HTTP2_HEADER_PATH]: options.path || '/',
      [http2.constants.HTTP2_HEADER_METHOD]: _options.method,
      [http2.constants.HTTP2_HEADER_AUTHORITY]: _options.host + (_options.port !== 443 ? ':' + options.port : '')
    }

    if (options.uri.isUnix || headers['host'] === 'unix' || _options.host === 'unix') {
      // The authority field needs to be set to 'localhost' when using unix sockets.
      // The default URL parser supplies the isUnix flag when the host is 'unix'. Added other checks incase using a different parser like WHATWG URL (new URL()).
      // See: https://github.com/nodejs/node/issues/32326
      this.requestHeaders = {
        ...this.requestHeaders,
        [http2.constants.HTTP2_HEADER_AUTHORITY]: 'localhost'
      }
    }

    this.socket = this._client.socket
    this._client.once('error', this.onError)
  }

  get _header () {
    return '\r\n' + Object.entries(this.stream.sentHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n') + '\r\n\r\n'
  }

  get httpVersion () {
    return '2.0'
  }

  registerListeners () {
    this.stream.on('drain', this.onDrain)
    this.stream.on('error', this.onError)
    this.stream.on('close', this.onClose)
    this.stream.on('response', this.onResponse)
    this.stream.on('end', this.onEnd)
    this.stream.on('timeout', this.onTimeout)
  }

  onDrain (...args) {
    this.emit('drain', ...args)
  }

  onError (e) {
    this.emit('error', e)
  }

  onResponse (response) {
    this.emit('response', new ResponseProxy(response, this.stream))
  }

  onEnd () {
    this.emit('end')
  }

  onTimeout () {
    this.stream.close()
  }

  onClose (...args) {
    if (this.stream.rstCode) {
      // Emit error message in case of abnormal stream closure
      // It is fine if the error is emitted multiple times, since the callback has checks to prevent multiple invocations
      this.onError(new Error(`HTTP/2 Stream closed with error code ${rstErrorCodesMap[this.stream.rstCode]}`))
    }

    this.emit('close', ...args)

    this._client.off('error', this.onError)
    this.stream.off('drain', this.onDrain)
    this.stream.off('error', this.onError)
    this.stream.off('response', this.onResponse)
    this.stream.off('end', this.onEnd)
    this.stream.off('close', this.onClose)
    this.stream.off('timeout', this.onTimeout)

    this.removeAllListeners()
  }

  setDefaultEncoding (encoding) {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }

    this.stream.setDefaultEncoding(encoding)
    return this
  }

  setEncoding (encoding) {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }

    this.stream.setEncoding(encoding)
    return this
  }

  write (chunk) {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }

    return this.stream.write(chunk)
  }

  _flushHeaders (endStream = false) {
    if (this[kHeadersFlushed]) {
      throw new Error('Headers already flushed')
    }

    this.requestHeaders = Object.fromEntries(
      Object.entries(this.requestHeaders)
        .filter(([key]) => !connectionHeaders.includes(key.toLowerCase()))
    )

    // The client was created in an unreferenced state and is referenced when a stream is created
    this._client.ref()
    this.stream = this._client.request(this.requestHeaders, {endStream})

    const unreferenceFn = () => {
      this._client.unref()
      this.stream.off('close', unreferenceFn)
    }

    this.stream.on('close', unreferenceFn)

    this.registerListeners()

    this[kHeadersFlushed] = true
  }

  pipe (dest) {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }
    this.stream.pipe(dest)

    return dest
  }

  on (eventName, listener) {
    if (eventName === 'socket') {
      listener(this.socket)
      return this
    }

    return super.on(eventName, listener)
  }

  abort () {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }
    this.stream.destroy()

    return this
  }

  end () {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders(true)
    }
    this.stream.end()

    return this
  }

  setTimeout (timeout, cb) {
    if (!this[kHeadersFlushed]) {
      this._flushHeaders()
    }
    this.stream.setTimeout(timeout, cb)

    return this
  }

  removeHeader (headerKey) {
    if (this[kHeadersFlushed]) {
      throw new Error('Headers already flushed. Cannot remove header')
    }

    if (headerKey.startsWith(':')) {
      return
    }

    delete this.requestHeaders[headerKey]

    return this
  }

  setHeader (headerKey, headerValue) {
    if (this[kHeadersFlushed]) {
      throw new Error('Headers already flushed. Cannot set header')
    }

    if (headerKey.startsWith(':')) {
      return
    }

    this.requestHeaders[headerKey] = headerValue

    return this
  }
}

function request (options) {
  // HTTP/2 internal implementation sucks. In case of an invalid HTTP/2 header, it destroys the entire session and
  // emits an error asynchronously, instead of throwing it synchronously. Hence, it makes more sense to perform all
  // validations before sending the request.
  validateRequestHeaders(options.headers)

  return new Http2Request(options)
}

class ResponseProxy extends EventEmitter {
  constructor (response, stream) {
    super()
    this.httpVersion = '2.0'
    this.reqStream = stream
    this.response = response
    this.on = this.on.bind(this)
    this.registerRequestListeners()
    this.socket = this.reqStream.session.socket
  }

  registerRequestListeners () {
    this.reqStream.on('error', (e) => this.emit('error', e))
    this.reqStream.on('close', () => {
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
      this.reqStream.on('data', (chunk) => {
        this.emit('data', chunk)
      })
    }

    if (eventName === 'end') {
      // Incase of bodies with no data, the end event is emitted immediately after the response event. In such cases, the consumer might not have attached the end listener yet. (eg: postman-echo.com/gets)
      // Thus, when the end event is emitted, we check if the request stream has already ended. If it has, we emit the end event immediately.
      // Otherwise, we wait for the request stream to end and then emit the end event.
      if (this.reqStream.readableEnded) {
        process.nextTick(listener)
      } else {
        this.reqStream.on('end', listener)
      }
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
    return Object.fromEntries(Object.entries(this.response))
  }

  pause () {
    this.reqStream.pause()
    return this
  }

  resume () {
    this.reqStream.resume()
    return this
  }

  pipe (dest) {
    this.reqStream.pipe(dest)
    return dest
  }

  setEncoding (encoding) {
    this.reqStream.setEncoding(encoding)
    return this
  }

  destroy () {
    this.reqStream.destroy()
    return this
  }
}

module.exports = {
  request,
  Http2Request
}
