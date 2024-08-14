'use strict'

var server = require('./server')
var request = require('../index')
var tape = require('tape')

var s

function createServer () {
  const s = server.createServer()
  s.keepAliveTimeout = 5000

  // Request that waits for 200ms
  s.on('/timeout', function (req, res) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end()
  })

  return s
}

tape('setup', function (t) {
  s = createServer()
  s.listen(0, function () {
    t.end()
  })
})

tape('should reuse the same socket', function (t) {
  var shouldTimeout = {
    url: s.url + '/timeout',
    pool: {}, // Provide pool so global pool is not shared between tests
    agentOptions: {
      keepAlive: true
    }
  }

  var socket
  request(shouldTimeout, function (err) {
    t.equal(err, null)
    request(shouldTimeout, function (err) {
      t.equal(err, null)
      t.end()
    }).on('socket', function (socket_) {
      t.equal(socket.identifier, socket_.identifier)
      socket.identifier = undefined
    })
  }).on('socket', function (socket_) {
    socket = socket_
    socket.identifier = '1234'
  })
})

tape('create a new socket when idle timeout is less than keep alive and time b/w requests is greater than idle timeout', function (t) {
  var shouldTimeout = {
    url: s.url + '/timeout',
    pool: {},
    agentOptions: {
      keepAlive: true,
      timeout: 1000
    }
  }

  var socket
  request(shouldTimeout, function (err) {
    t.equal(err, null)
    setTimeout(function () {
      request(shouldTimeout, function (err) {
        t.equal(err, null)
        t.end()
      }).on('socket', function (socket_) {
        t.notEqual(socket.identifier, socket_.identifier)
      })
    }, 1100)
  }).on('socket', function (socket_) {
    socket = socket_
    socket.identifier = '12345'
  })
})

tape('create a new socket when idle timeout is greater than keep alive and time b/w requests is greater than idle timeout', function (t) {
  var shouldTimeout = {
    url: s.url + '/timeout',
    pool: {},
    agentOptions: {
      keepAlive: true,
      timeout: 2000
    }
  }

  var socket
  request(shouldTimeout, function (err) {
    t.equal(err, null)
    setTimeout(function () {
      request(shouldTimeout, function (err) {
        t.equal(err, null)
        t.end()
      }).on('socket', function (socket_) {
        t.notEqual(socket.identifier, socket_.identifier)
      })
    }, 2100)
  }).on('socket', function (socket_) {
    socket = socket_
    socket.identifier = '12345'
  })
})

tape('cleanup', function (t) {
  s.close(function () {
    t.end()
  })
})
