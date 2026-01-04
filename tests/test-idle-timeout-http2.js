'use strict'

const server = require('./server')
const request = require('../index')
const tape = require('tape')
const destroyable = require('server-destroy')

function checkErrCode (t, err) {
  t.notEqual(err, null)
  t.ok(err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT',
    'Error ETIMEDOUT or ESOCKETTIMEDOUT')
}

const s = server.createHttp2Server()

const streams = []
s.on('/', function (req, res) {
  streams.push(req.stream)
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end()
})

destroyable(s)

tape('setup', function (t) {
  s.listen(0, function () {
    t.end()
  })
})

tape('should reuse the same socket', function (t) {
  const shouldTimeout = {
    url: s.url + '/',
    pool: {},
    protocolVersion: 'http2',
    strictSSL: false,
    agentOptions: {}
  }

  let socket
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
  const shouldTimeout = {
    url: s.url + '/',
    pool: {},
    protocolVersion: 'http2',
    strictSSL: false,
    agentOptions: {
      timeout: 1000
    }
  }

  let socket
  request(shouldTimeout, function (err) {
    t.equal(err, null)
    setTimeout(function () {
      request(shouldTimeout, function (err) {
        t.equal(err, null)
        t.end()
      }).on('socket', function () {
        try {
          socket.identifier // eslint-disable-line
        } catch (e) {
          t.equal(e.message, 'The socket has been disconnected from the Http2Session')
        }
      })
    }, 1100)
  }).on('socket', function (socket_) {
    socket = socket_
    socket.identifier = '12345'
  })
})

tape('create a new socket when idle timeout is greater than keep alive and time b/w requests is greater than idle timeout', function (t) {
  const shouldTimeout = {
    url: s.url + '/',
    pool: {},
    protocolVersion: 'http2',
    strictSSL: false,
    agentOptions: {
      timeout: 2000
    }
  }

  let socket
  request(shouldTimeout, function (err) {
    t.equal(err, null)
    setTimeout(function () {
      request(shouldTimeout, function (err) {
        t.equal(err, null)
        t.end()
      }).on('socket', function () {
        try {
          socket.identifier // eslint-disable-line
        } catch (e) {
          t.equal(e.message, 'The socket has been disconnected from the Http2Session')
        }
      })
    }, 2100)
  }).on('socket', function (socket_) {
    socket = socket_
    socket.identifier = '12345'
  })
})

tape('agent timeout shouldn\'t affect request timeout', (t) => {
  s.on('/timeout', (req, res) => {
    streams.push(req.stream)
    setTimeout(() => {
      if (res.stream.closed) {
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end()
    }, 2000)
  })

  const shouldTimeout = {
    url: s.url + '/timeout',
    pool: {},
    timeout: 2500,
    protocolVersion: 'http2',
    strictSSL: false,
    agentOptions: {
      timeout: 1000
    }
  }

  request(shouldTimeout, function (err) {
    t.equal(err, null)
    setTimeout(function () {
      request({ ...shouldTimeout, timeout: 1000 }, function (err) {
        checkErrCode(t, err)
        t.end()
      })
    }, 2100)
  })
})

tape('cleanup', function (t) {
  const sessions = []

  streams.forEach((stream) => {
    sessions.push(stream.session)
    stream.destroy()
  })

  sessions.forEach((session) => {
    if (!session) { return }
    session.close()
  })

  s.destroy(function () {
    t.end()
  })
})
