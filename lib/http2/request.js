const url = require( 'url')
const http2 =require( 'http2')
const { EventEmitter } =require( 'events')
const {  globalAgent } =require( './http2Agent')


function httpOptionsToUri (options) {
  return url.format({
    protocol: 'https',
    host: options.host || 'localhost'
  })
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
    const newoptions = {
      ...options,
      port: Number(options.port || 443),
      path: undefined,
      host: options.hostname || options.host || 'localhost'
    }

    if (options.socketPath) {
      options.path = options.socketPath
    }

    const agent = options.agent || globalAgent

    this._client = agent.createConnection(this, uri, newoptions)

    this.requestHeaders = {
      [http2.constants.HTTP2_HEADER_PATH]: options.path || '/',
      [http2.constants.HTTP2_HEADER_METHOD]: newoptions.method,
      [http2.constants.HTTP2_HEADER_AUTHORITY]: newoptions.host,
      ...headers
    }
    this.socket = this._client.socket;

    this.requestHeaders = Object.fromEntries(
        Object.entries(this.requestHeaders)
            .map(([key, value])=>([key.toLowerCase(), value]))
            .filter(([key]) => !(options.blacklistHeaders ?? []).includes(key))
            .filter(([key])=> !this.connectionHeaders.includes(key))
    )

    this.stream = this._client.request(this.requestHeaders)
    this.registerListeners()

  }

  get _header () {
    return Object.entries(this.stream.sentHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join('/r/n')
  }

  get httpVersion () {
    return '2.0'
  }

  registerListeners () {
    this.stream.on('drain', (...args) => this.emit('drain', ...args))
    this.stream.on('error', (...args) => this.emit('error', ...args))

    this.stream.on('close', (...args) => {
      this.emit('close', ...args)
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

  setDefaultEncoding (encoding){
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
    return;
  }
}

function request (options){
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

    if(eventName === 'end'){
      this.req.stream.on('end', listener)
    }
    return this
  }

  get statusCode () {
    return this.response[http2.constants.HTTP2_HEADER_STATUS]
  }

  get rawHeaders () {
    let headersArray = Object.entries(this.response).flat()
    const setCookieHeaderIndex = headersArray.findIndex(key => key === http2.constants.HTTP2_HEADER_SET_COOKIE)
    if (setCookieHeaderIndex !== -1) {
      const setCookieHeadersArray = (this.response[http2.constants.HTTP2_HEADER_SET_COOKIE]).map((val) => ([
        http2.constants.HTTP2_HEADER_SET_COOKIE,
        val
      ])).flat()
      headersArray = headersArray.slice(0, setCookieHeaderIndex).concat(setCookieHeadersArray, headersArray.slice(setCookieHeaderIndex + 2))
    }

    return headersArray
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

  destroy(){
    this.req.stream.destroy();
  }
}


module.exports = {
  request,
  Http2Request
}
