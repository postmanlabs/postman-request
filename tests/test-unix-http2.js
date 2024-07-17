'use strict'

var request = require('../index').defaults({strictSSL: false, protocolVersion: 'http2'})
var fs = require('fs')
var rimraf = require('rimraf')
var assert = require('assert')
var tape = require('tape')
var url = require('url')
var destroyable = require('server-destroy')
var server = require('./server')

var rawPath = [null, 'raw', 'path'].join('/')
var queryPath = [null, 'query', 'path'].join('/')
var searchString = '?foo=bar'
var socket = [__dirname, 'tmp-socket'].join('/')
var expectedBody = 'connected'
var statusCode = 200

var s = server.createHttp2Server()

rimraf.sync(socket)

s.on(rawPath, function (req, res) {
  var incomingUrl = url.parse(req.url)
  assert.equal(incomingUrl.pathname, rawPath, 'requested path is sent to server')
  res.writeHead(statusCode)
  res.end(expectedBody)
})

s.on(queryPath + searchString, function (req, res) {
  var incomingUrl = url.parse(req.url)
  assert.equal(incomingUrl.pathname, queryPath, 'requested path is sent to server')
  assert.equal(incomingUrl.search, searchString, 'query string is sent to server')
  res.writeHead(statusCode)
  res.end(expectedBody)
})

destroyable(s)

function setup () {
  return new Promise((resolve) => s.listen(socket, function () {
    resolve()
  }))
}

function tearDown (cb) {
  s.destroy(() => {
    fs.unlink(socket, function () {
      cb()
    })
  })
}

tape('unix socket connection', async function (t) {
  await setup()
  request('https://unix:' + socket + ':' + rawPath, function (err, res, body) {
    t.equal(err, null, 'no error in connection')
    t.equal(res.statusCode, statusCode, 'got HTTP 200 OK response')
    t.equal(body, expectedBody, 'expected response body is received')
    tearDown(() => {
      t.end()
    })
  })
})

tape('unix socket connection with qs', async function (t) {
  await setup()
  request({
    uri: 'https://unix:' + socket + ':' + queryPath,
    qs: {
      foo: 'bar'
    }
  }, function (err, res, body) {
    t.equal(err, null, 'no error in connection')
    t.equal(res.statusCode, statusCode, 'got HTTP 200 OK response')
    t.equal(body, expectedBody, 'expected response body is received')
    tearDown(() => {
      t.end()
    })
  })
})
