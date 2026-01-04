'use strict'
const destroyable = require('server-destroy')

function checkErrCode (t, err) {
  t.notEqual(err, null)
  t.ok(err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT',
    'Error ETIMEDOUT or ESOCKETTIMEDOUT')
}

function checkEventHandlers (t, socket) {
  const connectListeners = socket.listeners('connect')
  let found = false
  for (let i = 0; i < connectListeners.length; ++i) {
    const fn = connectListeners[i]
    if (typeof fn === 'function' && fn.name === 'onReqSockConnect') {
      found = true
      break
    }
  }
  t.ok(!found, 'Connect listener should not exist')
}

const server = require('./server')
const request = require('../index')
const tape = require('tape')

const s = server.createHttp2Server()
destroyable(s)

const streams = []
// Request that waits for 200ms
s.on('/timeout', function (req, res) {
  streams.push(req.stream)
  setTimeout(function () {
    if (res.stream.closed) {
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('waited')
    res.end()
  }, 200)
})

tape('setup', function (t) {
  s.listen(0, function () {
    t.end()
  })
})

tape('should timeout', function (t) {
  const shouldTimeout = {
    url: s.url + '/timeout',
    timeout: 100,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request(shouldTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.end()
  })
})

tape('should set connect to false', function (t) {
  const shouldTimeout = {
    url: s.url + '/timeout',
    timeout: 100,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request(shouldTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.ok(err.connect === false, 'Read Timeout Error should set \'connect\' property to false')
    t.end()
  })
})

tape('should timeout with events', function (t) {
  t.plan(3)

  const shouldTimeoutWithEvents = {
    url: s.url + '/timeout',
    timeout: 100,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  let eventsEmitted = 0
  request(shouldTimeoutWithEvents)
    .on('error', function (err) {
      eventsEmitted++
      t.equal(1, eventsEmitted)
      checkErrCode(t, err)
    })
})

tape('should not timeout', function (t) {
  const shouldntTimeout = {
    url: s.url + '/timeout',
    timeout: 1200,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  let socket
  request(shouldntTimeout, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'waited')
    checkEventHandlers(t, socket)
    t.end()
  }).on('socket', function (socket_) {
    socket = socket_
  })
})

tape('no timeout', function (t) {
  const noTimeout = {
    url: s.url + '/timeout',
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request(noTimeout, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'waited')
    t.end()
  })
})

tape('negative timeout', function (t) { // should be treated a zero or the minimum delay
  const negativeTimeout = {
    url: s.url + '/timeout',
    timeout: -1000,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request(negativeTimeout, function (err, res, body) {
    // Only verify error if it is set, since using a timeout value of 0 can lead
    // to inconsistent results, depending on a variety of factors
    if (err) {
      checkErrCode(t, err)
    }
    t.end()
  })
})

tape('float timeout', function (t) { // should be rounded by setTimeout anyway
  const floatTimeout = {
    url: s.url + '/timeout',
    timeout: 100.76,
    strictSSL: false,
    protocolVersion: 'http2'
  }

  request(floatTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.end()
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

  s.close(function () {
    t.end()
  })
})
