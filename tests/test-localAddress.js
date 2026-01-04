'use strict'

const server = require('./server')
const request = require('../index')
const tape = require('tape')

const s = server.createServer()

s.on('/', function (req, res) {
  res.statusCode = 200
  res.end('ok')
})

s.on('/redirect', function (req, res) {
  res.writeHead(301, { location: '/' })
  res.end()
})

tape('setup', function (t) {
  s.listen(0, function () {
    s.url = 'http://127.0.0.1:' + s.port
    t.end()
  })
})

tape('bind to invalid address', function (t) {
  request.get({
    uri: s.url + '/',
    localAddress: '203.0.113.1'
  }, function (err, res) {
    t.notEqual(err, null)
    t.equal(res, undefined)
    t.ok(/EADDRNOTAVAIL|EINVAL/.test(err.message))
    t.end()
  })
})

tape('bind to local address', function (t) {
  const r = request.get({
    uri: s.url + '/',
    localAddress: '127.0.0.1'
  }, function (err, res) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    t.equal(r.req.socket.localAddress, '127.0.0.1')
    t.end()
  })
})

tape('bind to local address on redirect', function (t) {
  const r = request.get({
    uri: s.url + '/redirect',
    localAddress: '127.0.0.1'
  }, function (err, res) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    t.equal(r.req.socket.localAddress, '127.0.0.1')
    t.end()
  })
})

tape('cleanup', function (t) {
  s.close(function () {
    t.end()
  })
})
