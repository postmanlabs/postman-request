'use strict'

var fs = require('fs')
const net = require('net')
const dns = require('dns')
var http = require('http')
var path = require('path')
var https = require('https')
var http2 = require('http2')
var stream = require('stream')
var assert = require('assert')

exports.createServer = function () {
  var s = http.createServer(function (req, resp) {
    s.emit(req.url.replace(/(\?.*)/, ''), req, resp)
  })
  s.on('listening', function () {
    s.port = this.address().port
    s.url = 'http://localhost:' + s.port
  })
  s.port = 0
  s.protocol = 'http'
  return s
}

exports.createEchoServer = function () {
  var s = http.createServer(function (req, resp) {
    var b = ''
    req.on('data', function (chunk) {
      b += chunk
    })
    req.on('end', function () {
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.write(
        JSON.stringify({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: b
        })
      )
      resp.end()
    })
  })
  s.on('listening', function () {
    s.port = this.address().port
    s.url = 'http://localhost:' + s.port
  })
  s.port = 0
  s.protocol = 'http'
  return s
}

exports.createSSLServer = function (opts) {
  var i
  var options = {
    key: path.join(__dirname, 'ssl', 'test.key'),
    cert: path.join(__dirname, 'ssl', 'test.crt')
  }
  if (opts) {
    for (i in opts) {
      options[i] = opts[i]
    }
  }

  for (i in options) {
    if (i !== 'requestCert' && i !== 'rejectUnauthorized' && i !== 'ciphers') {
      options[i] = fs.readFileSync(options[i])
    }
  }

  var s = https.createServer(options, function (req, resp) {
    s.emit(req.url, req, resp)
  })
  s.on('listening', function () {
    s.port = this.address().port
    s.url = 'https://localhost:' + s.port
  })
  s.port = 0
  s.protocol = 'https'
  return s
}

exports.createPostStream = function (text) {
  var postStream = new stream.Stream()
  postStream.writeable = true
  postStream.readable = true
  setTimeout(function () {
    postStream.emit('data', Buffer.from(text))
    postStream.emit('end')
  }, 0)
  return postStream
}
exports.createPostValidator = function (text, reqContentType) {
  var l = function (req, resp) {
    var r = ''
    req.on('data', function (chunk) {
      r += chunk
    })
    req.on('end', function () {
      if (
        req.headers['content-type'] &&
        req.headers['content-type'].indexOf('boundary=') >= 0
      ) {
        var boundary = req.headers['content-type'].split('boundary=')[1]
        text = text.replace(/__BOUNDARY__/g, boundary)
      }
      assert.equal(r, text)
      if (reqContentType) {
        assert.ok(req.headers['content-type'])
        assert.ok(~req.headers['content-type'].indexOf(reqContentType))
      }
      resp.writeHead(200, { 'content-type': 'text/plain' })
      resp.write(r)
      resp.end()
    })
  }
  return l
}
exports.createPostJSONValidator = function (value, reqContentType) {
  var l = function (req, resp) {
    var r = ''
    req.on('data', function (chunk) {
      r += chunk
    })
    req.on('end', function () {
      var parsedValue = JSON.parse(r)
      assert.deepEqual(parsedValue, value)
      if (reqContentType) {
        assert.ok(req.headers['content-type'])
        assert.ok(~req.headers['content-type'].indexOf(reqContentType))
      }
      resp.writeHead(200, { 'content-type': 'application/json' })
      resp.write(r)
      resp.end()
    })
  }
  return l
}
exports.createGetResponse = function (text, contentType) {
  var l = function (req, resp) {
    contentType = contentType || 'text/plain'
    resp.writeHead(200, { 'content-type': contentType })
    resp.write(text)
    resp.end()
  }
  return l
}
exports.createChunkResponse = function (chunks, contentType) {
  var l = function (req, resp) {
    contentType = contentType || 'text/plain'
    resp.writeHead(200, { 'content-type': contentType })
    chunks.forEach(function (chunk) {
      resp.write(chunk)
    })
    resp.end()
  }
  return l
}

exports.createHttp2Server = function (opts) {
  var i
  var options = {
    key: path.join(__dirname, 'ssl', 'test.key'),
    cert: path.join(__dirname, 'ssl', 'test.crt')
  }
  if (opts) {
    for (i in opts) {
      options[i] = opts[i]
    }
  }

  for (i in options) {
    if (i !== 'requestCert' && i !== 'rejectUnauthorized' && i !== 'ciphers') {
      options[i] = fs.readFileSync(options[i])
    }
  }

  var s = http2.createSecureServer(options, function (req, resp) {
    s.emit(req.url, req, resp)
  })
  s.on('listening', function () {
    s.port = this.address().port
    s.url = 'https://localhost:' + s.port
  })

  s.port = 0
  s.protocol = 'https'
  return s
}

exports.createSocksServer = function ({
  auth = null, // { username: 'user', password: 'pass' } or null for no auth
  allowConnection = () => true
} = {}) {
  // Connection log to track SOCKS connections (protocol-agnostic)
  const connectionLog = []

  const server = net.createServer((clientSocket) => {
    clientSocket.once('data', (chunk) => {
      const version = chunk[0]
      if (version === 0x04) return handleSocks4(clientSocket, chunk)
      if (version === 0x05) return handleSocks5(clientSocket, chunk)
      clientSocket.end()
    })
  })

  function handleSocks4 (socket, chunk) {
    const cmd = chunk[1]
    const dstPort = chunk.readUInt16BE(2)
    const ipBytes = chunk.slice(4, 8)
    const ip = ipBytes.join('.')
    const userIdEnd = chunk.indexOf(0x00, 8)
    if (userIdEnd === -1) return socket.end()

    let dstAddr

    // SOCKS4a: if IP is 0.0.0.x and hostname is present
    if (ipBytes[0] === 0 && ipBytes[1] === 0 && ipBytes[2] === 0 && ipBytes[3] !== 0) {
      const hostnameStart = userIdEnd + 1
      const hostnameEnd = chunk.indexOf(0x00, hostnameStart)
      if (hostnameEnd === -1) return socket.end()
      const hostname = chunk.toString('utf8', hostnameStart, hostnameEnd)
      dstAddr = hostname
    } else {
      dstAddr = ip
    }

    if (!allowConnection({ dstAddr, dstPort, version: 4 })) {
      return socket.end(Buffer.from([0x00, 0x5B]))
    }

    if (cmd !== 0x01) return socket.end(Buffer.from([0x00, 0x5B]))

    connectAndPipe(socket, dstAddr, dstPort, 4)
  }

  function handleSocks5 (socket, initialChunk) {
    const nMethods = initialChunk[1]
    const methods = initialChunk.slice(2, 2 + nMethods)

    const useAuth = !!auth
    const NO_AUTH = 0x00
    const USER_PASS = 0x02

    if (useAuth && !methods.includes(USER_PASS)) {
      socket.end(Buffer.from([0x05, 0xFF]))
      return
    }
    if (!useAuth && !methods.includes(NO_AUTH)) {
      socket.end(Buffer.from([0x05, 0xFF]))
      return
    }

    socket.write(Buffer.from([0x05, useAuth ? USER_PASS : NO_AUTH]))

    const waitForRequest = () => {
      socket.once('data', (req) => {
        const cmd = req[1]
        const atyp = req[3]
        let offset = 4
        let addr, port

        if (atyp === 0x01) { // IPv4
          addr = `${req[offset++]}.${req[offset++]}.${req[offset++]}.${req[offset++]}`
        } else if (atyp === 0x03) { // Domain
          const len = req[offset++]
          addr = req.toString('utf8', offset, offset + len)
          offset += len
        } else {
          return socket.end(Buffer.from([0x05, 0x08]))
        }

        port = req.readUInt16BE(offset)

        if (!allowConnection({ dstAddr: addr, dstPort: port, version: 5 })) {
          return socket.end(Buffer.from([0x05, 0x02]))
        }

        if (cmd !== 0x01) return socket.end(Buffer.from([0x05, 0x07]))

        connectAndPipe(socket, addr, port, 5)
      })
    }

    if (useAuth) {
      socket.once('data', (authChunk) => {
        const uLen = authChunk[1]
        const username = authChunk.toString('utf8', 2, 2 + uLen)
        const pLen = authChunk[2 + uLen]
        const password = authChunk.toString('utf8', 3 + uLen, 3 + uLen + pLen)
        if (
          username === auth.username &&
          password === auth.password
        ) {
          socket.write(Buffer.from([0x01, 0x00]))
          waitForRequest()
        } else {
          socket.end(Buffer.from([0x01, 0x01])) // auth failure
        }
      })
    } else {
      waitForRequest()
    }
  }

  function connectAndPipe (clientSocket, dstAddr, dstPort, version) {
    // Log the connection attempt (protocol-agnostic)
    const connectionEntry = {
      timestamp: Date.now(),
      clientAddress: clientSocket.remoteAddress,
      targetHost: dstAddr,
      targetPort: dstPort,
      version: version,
      success: false
    }

    const connectToTarget = (resolvedAddr) => {
      const targetSocket = net.createConnection({ host: resolvedAddr, port: dstPort }, () => {
        // Mark connection as successful
        connectionEntry.success = true
        connectionLog.push(connectionEntry)

        if (version === 4) {
          const resp = Buffer.alloc(8)
          resp[1] = 0x5A
          clientSocket.write(resp)
        } else if (version === 5) {
          const resp = Buffer.from([
            0x05, 0x00, 0x00, 0x01,
            0, 0, 0, 0,
            0, 0
          ])
          clientSocket.write(resp)
        }

        // Pure TCP pipe (no protocol awareness)
        clientSocket.pipe(targetSocket).pipe(clientSocket)
      })

      targetSocket.on('error', () => {
        if (version === 4) clientSocket.end(Buffer.from([0x00, 0x5B]))
        else if (version === 5) clientSocket.end(Buffer.from([0x05, 0x04]))
      })
    }

    // Resolve DNS only if hostname
    if (/^[\d.]+$/.test(dstAddr)) {
      connectToTarget(dstAddr)
    } else {
      dns.lookup(dstAddr, (err, address) => {
        if (err) return clientSocket.end()
        connectToTarget(address)
      })
    }
  }

  // Expose connection log for testing
  server.getConnectionLog = () => connectionLog
  server.clearConnectionLog = () => { connectionLog.length = 0 }

  return server
}
