import { Agent } from 'https'
import { Http2Agent, HTTP2ClientRequestOptions } from '../http2/http2Agent'
import * as https from 'https'
import * as http2 from 'http2'
import * as http from 'http'
import { AutoRequestOptions, MultiProtocolRequest } from './request'
import * as tls from 'tls'
import { EventEmitter } from 'events'
import * as net from 'net'

interface CreateConnectionCallback {
  (err: null, proto: 'h2', connection: http2.ClientHttp2Session)

  (err: null, proto: 'http1', connection: http.ClientRequest)

  (err: Error, proto: undefined, connection: undefined)
}

function calculateServerName (options: AutoRequestOptions) {
  let servername = options.host || ''
  const hostHeader = options.headers?.host

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

function httpOptionsToUri (options: AutoRequestOptions): URL {
  const url = new URL('https://' + (options.host || 'localhost'))
  return url
}

// @ts-expect-error
export class AutoHttp2Agent extends EventEmitter implements Agent {
  private readonly http2Agent: Http2Agent
  private readonly httpsAgent: https.Agent
  private readonly ALPNCache: Map<string, string>
  private readonly options: https.AgentOptions
  defaultPort = 443

  constructor (options: https.AgentOptions) {
    super()
    this.http2Agent = new Http2Agent(options)
    this.httpsAgent = new https.Agent(options)
    this.ALPNCache = new Map()
    this.options = options
  }

  createConnection (
    req: MultiProtocolRequest,
    reqOptions: AutoRequestOptions,
    cb: CreateConnectionCallback,
    socketCb: (socket: tls.TLSSocket) => void
  ) {
    const options = { ...reqOptions, ...this.options }
    const name = this.getName(options);

    const uri = httpOptionsToUri(options)
    const port = Number(options.port || this.defaultPort)
    
    // check if there is ALPN cached
    const protocol = this.ALPNCache.get(name)
    if (protocol === 'h2') {
      const newOptions: HTTP2ClientRequestOptions = {
        ...options,
        port,
        path: options.socketPath,
        host: options.hostname || options.host || 'localhost'
      }
      const connection = this.http2Agent.createConnection(req, uri, newOptions)
      cb(null, 'h2', connection)
      socketCb(connection.socket as tls.TLSSocket)
      return
    }
    if (protocol === 'http/1.1' || protocol === 'http/1.0') {
      const requestOptions: https.RequestOptions = {
        ...options,
        agent: this.httpsAgent,
        host: options.hostname || options.host || 'localhost'
      }

      const request = https.request(requestOptions)
      request.on('socket', (socket) => socketCb(socket as tls.TLSSocket))
      cb(null, 'http1', request)
      return
    }

    const newOptions: tls.ConnectionOptions = {
      ...options,
      port,
      path: options.socketPath,
      ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'],
      servername: options.servername || calculateServerName(options),
      host: options.hostname || options.host || 'localhost'
    }

    const socket = tls.connect(newOptions)
    socketCb(socket)
    socket.on('error', (e: Error) => cb(e, undefined, undefined))
    socket.once('secureConnect', () => {
      const protocol = socket.alpnProtocol
      if (!protocol) {
        cb(socket.authorizationError, undefined, undefined)
        socket.end()
        return
      }

      this.ALPNCache.set(name, protocol)

      if (protocol === 'h2') {
        const newOptions: HTTP2ClientRequestOptions = {
          ...options,
          port,
          path: options.socketPath,
          host: options.hostname || options.host || 'localhost'
        }

        const connection = this.http2Agent.createConnection(
          req,
          uri,
          newOptions,
          socket
        )
        cb(null, 'h2', connection)
      } else if (protocol === 'http/1.1') {
        // Protocol is http1, using the built in
        // We need to release all free sockets so that new connection is created using the overriden createconnection forcing the agent to reuse the socket used for alpn

        // This reassignment works, since all code so far is sync, and happens in the same tick, hence there will be no race conditions
        // @ts-expect-error
        const oldCreateConnection = this.httpsAgent.createConnection
        // @ts-expect-error
        this.httpsAgent.createConnection = () => {
          return socket
        }

        const requestOptions: https.RequestOptions = {
          ...options,
          agent: this.httpsAgent,
          host: options.hostname || options.host || 'localhost'
        }

        const request = https.request(requestOptions)
        // @ts-expect-error
        this.httpsAgent.createConnection = oldCreateConnection
        cb(null, 'http1', request)
      } else {
        cb(new Error('Unknown protocol' + protocol), undefined, undefined)
      }
    })
  }

  getName (options: AutoRequestOptions) {
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

export const globalAgent = new AutoHttp2Agent({})