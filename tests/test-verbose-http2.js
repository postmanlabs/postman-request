'use strict'

const assert = require('assert')
const tape = require('tape')
const destroyable = require('server-destroy')
const zlib = require('zlib')

const server = require('./server')
const request = require('../index').defaults({ protocolVersion: 'http2' })

const plainServer = server.createServer()
const http2Server = server.createHttp2Server()

destroyable(plainServer)
destroyable(http2Server)

tape('setup', function (t) {
  plainServer.listen(0, function () {
    plainServer.on('/', function (req, res) {
      res.writeHead(200)
      res.end('plain')
    })
    plainServer.on('/redir', function (req, res) {
      res.writeHead(301, { location: 'https://localhost:' + http2Server.port + '/' })
      res.end()
    })

    http2Server.listen(0, function () {
      http2Server.on('/', function (req, res) {
        res.writeHead(200)
        res.end('https')
      })
      http2Server.on('/redir', function (req, res) {
        res.writeHead(301, { location: 'http://localhost:' + plainServer.port + '/' })
        res.end()
      })
      http2Server.on('/gzip', function (req, res) {
        res.writeHead(200, { 'content-encoding': 'gzip' })
        zlib.gzip('gzip', function (err, data) {
          assert.equal(err, null)
          res.end(data)
        })
      })

      t.end()
    })
  })
})

tape('verbose=false [default]', function (t) {
  const options = {
    protocolVersion: 'http2'
  }

  request('http://localhost:' + plainServer.port + '/', options, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'plain')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 1)

    t.equal(res.socket.__SESSION_ID, undefined)
    t.equal(res.socket.__SESSION_DATA, undefined)
    t.deepEqual(Object.keys(debug[0]), ['request', 'response'])

    t.end()
  })
})

tape('HTTP: verbose=true', function (t) {
  const options = { verbose: true, time: false, protocolVersion: 'http2' } // verbose overrides timing setting

  request('http://localhost:' + plainServer.port + '/', options, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'plain')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 1)

    t.equal(typeof res.socket.__SESSION_ID, 'string')
    t.equal(typeof res.socket.__SESSION_DATA, 'object')
    t.deepEqual(Object.keys(debug[0]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[0].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])

    t.notEqual(debug[0].request.headers.length, 0)
    t.deepEqual(debug[0].request.headers[0], { key: 'Host', value: 'localhost:' + plainServer.port })

    t.deepEqual(Object.keys(debug[0].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[0].session.data), ['addresses'])
    t.equal(debug[0].session.reused, false)
    t.deepEqual(Object.keys(debug[0].response), ['statusCode', 'headers', 'httpVersion', 'downloadedBytes'])

    t.notEqual(debug[0].response.headers.length, 0)
    t.equal(debug[0].response.headers[0].key, 'Date')
    t.ok(debug[0].response.headers[0].value)

    t.end()
  })
})

tape('HTTP: redirect(HTTPS) + verbose=true', function (t) {
  const options = {
    verbose: true,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request('http://localhost:' + plainServer.port + '/redir', options, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'https')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 2)

    t.equal(typeof res.socket.__SESSION_ID, 'string')
    t.equal(typeof res.socket.__SESSION_DATA, 'object')

    t.deepEqual(Object.keys(debug[0]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[0].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[0].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[0].session.data), ['addresses'])
    t.equal(debug[0].session.reused, false)
    t.deepEqual(Object.keys(debug[0].response), ['statusCode', 'headers', 'httpVersion'])

    t.deepEqual(Object.keys(debug[1]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[1].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[1].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[1].session.data), ['addresses', 'tls'])
    t.deepEqual(Object.keys(debug[1].session.data.tls), ['reused', 'authorized', 'authorizationError', 'cipher', 'protocol', 'ephemeralKeyInfo', 'peerCertificate'])
    t.equal(debug[1].session.reused, false)
    t.deepEqual(Object.keys(debug[1].response), ['statusCode', 'headers', 'httpVersion', 'downloadedBytes'])

    t.end()
  })
})

tape('HTTPS: verbose=true', function (t) {
  const options = {
    verbose: true,
    strictSSL: false,
    time: false, // verbose overrides timing setting
    protocolVersion: 'http2'
  }

  request('https://localhost:' + http2Server.port + '/', options, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'https')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 1)

    t.equal(typeof res.socket.__SESSION_ID, 'string')
    t.equal(typeof res.socket.__SESSION_DATA, 'object')
    t.deepEqual(Object.keys(debug[0]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[0].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[0].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[0].session.data), ['addresses', 'tls'])
    t.deepEqual(Object.keys(debug[0].session.data.tls), ['reused', 'authorized', 'authorizationError', 'cipher', 'protocol', 'ephemeralKeyInfo', 'peerCertificate'])
    t.equal(debug[0].session.reused, true)
    t.deepEqual(Object.keys(debug[0].response), ['statusCode', 'headers', 'httpVersion', 'downloadedBytes'])

    t.end()
  })
})

tape('HTTPS Gzip: verbose=true', function (t) {
  const options = {
    verbose: true,
    strictSSL: false,
    time: false, // verbose overrides timing setting
    protocolVersion: 'http2'
  }

  request('https://localhost:' + http2Server.port + '/gzip', { ...options, gzip: true }, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'gzip')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 1)

    t.equal(typeof res.socket.__SESSION_ID, 'string')
    t.equal(typeof res.socket.__SESSION_DATA, 'object')
    t.deepEqual(Object.keys(debug[0]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[0].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[0].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[0].session.data), ['addresses', 'tls'])
    t.deepEqual(Object.keys(debug[0].session.data.tls), ['reused', 'authorized', 'authorizationError', 'cipher', 'protocol', 'ephemeralKeyInfo', 'peerCertificate'])
    t.equal(debug[0].session.reused, true)
    t.deepEqual(Object.keys(debug[0].response), ['statusCode', 'headers', 'httpVersion', 'downloadedBytes'])
    t.equal(debug[0].response.downloadedBytes, 24)

    t.end()
  })
})

tape('HTTPS: redirect(HTTP) + verbose=true', function (t) {
  const options = {
    verbose: true,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request('https://localhost:' + http2Server.port + '/redir', options, function (err, res, body, debug) {
    t.equal(err, null)
    t.equal(body, 'plain')
    t.equal(Array.isArray(debug), true)
    t.equal(debug.length, 2)

    t.equal(typeof res.socket.__SESSION_ID, 'string')
    t.equal(typeof res.socket.__SESSION_DATA, 'object')

    t.deepEqual(Object.keys(debug[0]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[0].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[0].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[0].session.data), ['addresses', 'tls'])
    t.deepEqual(Object.keys(debug[0].session.data.tls), ['reused', 'authorized', 'authorizationError', 'cipher', 'protocol', 'ephemeralKeyInfo', 'peerCertificate'])
    t.equal(debug[0].session.reused, true)
    t.deepEqual(Object.keys(debug[0].response), ['statusCode', 'headers', 'httpVersion'])

    t.deepEqual(Object.keys(debug[1]), ['request', 'session', 'response', 'timingStart', 'timingStartTimer', 'timings'])
    t.deepEqual(Object.keys(debug[1].request), ['method', 'href', 'headers', 'proxy', 'httpVersion'])
    t.deepEqual(Object.keys(debug[1].session), ['id', 'reused', 'data'])
    t.deepEqual(Object.keys(debug[1].session.data), ['addresses'])
    t.equal(debug[1].session.reused, false)
    t.deepEqual(Object.keys(debug[1].response), ['statusCode', 'headers', 'httpVersion', 'downloadedBytes'])

    t.end()
  })
})

tape('cleanup', function (t) {
  plainServer.destroy(function () {
    http2Server.destroy(function () {
      t.end()
    })
  })
})
