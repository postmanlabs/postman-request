'use strict'

var server = require('./server')
var request = require('../index')
var tape = require('tape')
var destroyable = require('server-destroy')


var s = server.createHttp2Server()
destroyable(s)

s.on('/redirect/from', function (req, res) {
  res.writeHead(301, {
    location: '/redirect/to'
  })
  res.end()
})

s.on('/redirect/to', function (req, res) {
  res.end('ok')
})

s.on('/headers.json', function (req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json'
  })

  res.end(JSON.stringify(req.headers))
})

tape('setup', function (t) {
  s.listen(0, function () {
    tape('cleanup', function (t) {
      s.destroy(function () {
        t.end()
      })
    })
    t.end()
  })
})



tape('undefined headers', function (t) {
  request({
    url: s.url + '/headers.json',
    headers: {
      'X-TEST-1': 'test1',
      'X-TEST-2': undefined
    },
    json: true,
    strictSSL: false,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body['x-test-1'], 'test1')
    t.equal(typeof body['x-test-2'], 'undefined')
    t.end()
  })
})

tape('preserve port in authority header if non-standard port', function (t) {
  request({
    url: s.url + '/headers.json',
    strictSSL: false,
    protocolVersion: 'http2'
  }, function (err, res, body, debug) {
    t.equal(err, null)
    console.log()
    t.equal(debug[0].request.headers.find(({key}) => key === ':authority').value, 'localhost:' + s.port)
    t.end()
  })
})


tape('strip port in authority header if explicit standard port (:443) & protocol (HTTPS)', function (t) {
  request({
    url: 'https://localhost:443/headers.json',
    strictSSL: false,
    protocolVersion: 'http2'
  }, function (_err, res, body, debug) {
    t.equal(debug[0].request.headers.find(({key}) => key === ':authority').value, 'localhost')
    t.end()
  })
})


tape('strip port in authority header if implicit standard port & protocol (HTTPS)', function (t) {
  request({
    url: 'https://localhost/headers.json',
    strictSSL: false,
    protocolVersion: 'http2'
  }, function (_err, res, body, debug) {
    t.equal(debug[0].request.headers.find(({key}) => key === ':authority').value, 'localhost')
    t.end()
  })
})
