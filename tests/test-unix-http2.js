'use strict'

const request = require('../index').defaults({ strictSSL: false, protocolVersion: 'http2' })
const fs = require('fs')
const rimraf = require('rimraf')
const assert = require('assert')
const tape = require('tape')
const url = require('url')
const server = require('./server')

const rawPath = [null, 'raw', 'path'].join('/')
const queryPath = [null, 'query', 'path'].join('/')
const searchString = '?foo=bar'
const socket = [__dirname, 'tmp-socket'].join('/')
const expectedBody = 'connected'
const statusCode = 200

const s = server.createHttp2Server()

rimraf.sync(socket)

s.on(rawPath, function (req, res) {
  /* eslint-disable-next-line n/no-deprecated-api */
  const incomingUrl = url.parse(req.url)
  assert.equal(incomingUrl.pathname, rawPath, 'requested path is sent to server')
  res.writeHead(statusCode)
  res.end(expectedBody)
})

s.on(queryPath + searchString, function (req, res) {
  /* eslint-disable-next-line n/no-deprecated-api */
  const incomingUrl = url.parse(req.url)
  assert.equal(incomingUrl.pathname, queryPath, 'requested path is sent to server')
  assert.equal(incomingUrl.search, searchString, 'query string is sent to server')
  res.writeHead(statusCode)
  res.end(expectedBody)
})

const connections = []

s.on('connection', function (conn) {
  connections.push(conn)
  conn.on('close', function () {
    connections.splice(connections.indexOf(conn), 1)
  })
})

tape('setup', function (t) {
  s.listen(socket, function () {
    t.end()
  })
})

tape('unix socket connection', async function (t) {
  request('https://unix:' + socket + ':' + rawPath, { protocolVersion: 'http2' }, function (err, res, body) {
    t.equal(err, null, 'no error in connection')
    t.equal(res.statusCode, statusCode, 'got HTTP 200 OK response')
    t.equal(body, expectedBody, 'expected response body is received')
    t.end()
  })
})

tape('unix socket connection with qs', async function (t) {
  request({
    uri: 'https://unix:' + socket + ':' + queryPath,
    qs: {
      foo: 'bar'
    },
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null, 'no error in connection')
    t.equal(res.statusCode, statusCode, 'got HTTP 200 OK response')
    t.equal(body, expectedBody, 'expected response body is received')
    t.end()
  })
})

tape('cleanup', function (t) {
  connections.forEach(conn => {
    conn.destroy()
  })
  s.close(function () {
    fs.unlink(socket, function () {
      t.end()
    })
  })
})
