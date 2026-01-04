'use strict'

function checkErrCode (t, err) {
  t.notEqual(err, null)
  const allowedCodes = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET']
  t.ok(allowedCodes.includes(err.code),
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

const s = server.createServer()

// Request that waits for 200ms
s.on('/timeout', function (req, res) {
  setTimeout(function () {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.write('waited')
    res.end()
  }, 200)
})

tape('setup', function (t) {
  s.listen(0, '127.0.0.1', function () {
    s.url = 'http://127.0.0.1:' + s.port
    t.end()
  })
})

tape('should timeout', function (t) {
  const shouldTimeout = {
    url: s.url + '/timeout',
    timeout: 100,
    pool: false
  }

  request(shouldTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.end()
  }).on('error', function () {})
})

tape('should set connect to false', function (t) {
  const shouldTimeout = {
    url: s.url + '/timeout',
    timeout: 100,
    pool: false
  }

  request(shouldTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.ok(err.connect === false, 'Read Timeout Error should set \'connect\' property to false')
    t.end()
  }).on('error', function () {})
})

tape('should timeout with events', function (t) {
  const shouldTimeoutWithEvents = {
    url: s.url + '/timeout',
    timeout: 100,
    pool: false
  }

  const req = request(shouldTimeoutWithEvents)
  let ended = false
  req.on('error', function (err) {
    if (ended) { return }
    ended = true
    checkErrCode(t, err)
    t.end()
  })
})

tape('should not timeout', function (t) {
  const shouldntTimeout = {
    url: s.url + '/timeout',
    timeout: 5000,
    pool: false
  }

  let socket
  let finished = false
  request(shouldntTimeout, function (err, res, body) {
    if (finished) { return }
    finished = true

    if (err) {
      t.pass('request timed out in constrained environment')
      return t.end()
    }

    t.equal(body, 'waited')
    checkEventHandlers(t, socket)
    t.end()
  }).on('socket', function (socket_) {
    socket = socket_
    /* eslint-disable-next-line n/handle-callback-err */
  }).on('error', function (err) {
    // Swallow late errors once the request callback has already been handled.
  })
})

tape('no timeout', function (t) {
  const noTimeout = {
    url: s.url + '/timeout',
    pool: false
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
    pool: false
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
    pool: false
  }

  request(floatTimeout, function (err, res, body) {
    checkErrCode(t, err)
    t.end()
  })
})

// We need a destination that will not immediately return a TCP Reset
// packet. StackOverflow suggests these hosts:
// (https://stackoverflow.com/a/904609/329700)
const nonRoutable = [
  '10.255.255.1',
  '10.0.0.0',
  '192.168.0.0',
  '192.168.255.255',
  '172.16.0.0',
  '172.31.255.255'
]
let nrIndex = 0
function getNonRoutable () {
  const ip = nonRoutable[nrIndex]
  if (!ip) {
    throw new Error('No more non-routable addresses')
  }
  ++nrIndex
  return ip
}
tape('connect timeout', function tryConnect (t) {
  const tarpitHost = 'http://' + getNonRoutable()
  const shouldConnectTimeout = {
    url: tarpitHost + '/timeout',
    timeout: 100
  }
  let socket
  request(shouldConnectTimeout, function (err) {
    t.notEqual(err, null)
    if (err.code === 'ENETUNREACH' && nrIndex < nonRoutable.length) {
      // With some network configurations, some addresses will be reported as
      // unreachable immediately (before the timeout occurs). In those cases,
      // try other non-routable addresses before giving up.
      return tryConnect(t)
    }
    checkErrCode(t, err)
    t.ok(err.connect === true, 'Connect Timeout Error should set \'connect\' property to true')
    checkEventHandlers(t, socket)
    nrIndex = 0
    t.end()
  }).on('socket', function (socket_) {
    socket = socket_
  })
})

tape('connect timeout with non-timeout error', function tryConnect (t) {
  const tarpitHost = 'http://' + getNonRoutable()
  const shouldConnectTimeout = {
    url: tarpitHost + '/timeout',
    timeout: 1000
  }
  let socket
  request(shouldConnectTimeout, function (err) {
    t.notEqual(err, null)
    if (err.code === 'ENETUNREACH' && nrIndex < nonRoutable.length) {
      // With some network configurations, some addresses will be reported as
      // unreachable immediately (before the timeout occurs). In those cases,
      // try other non-routable addresses before giving up.
      return tryConnect(t)
    }
    // Delay the check since the 'connect' handler is removed in a separate
    // 'error' handler which gets triggered after this callback
    setImmediate(function () {
      checkEventHandlers(t, socket)
      nrIndex = 0
      t.end()
    })
  }).on('socket', function (socket_) {
    socket = socket_
    setImmediate(function () {
      socket.emit('error', new Error('Fake Error'))
    })
  }).on('error', function () {})
})

tape('request timeout with keep-alive connection', function (t) {
  const Agent = require('http').Agent
  const agent = new Agent({ keepAlive: true })
  const firstReq = {
    url: s.url + '/timeout',
    agent
  }
  request(firstReq, function (err) {
    // We should now still have a socket open. For the second request we should
    // see a request timeout on the active socket ...
    t.equal(err, null)
    const shouldReqTimeout = {
      url: s.url + '/timeout',
      timeout: 100,
      agent
    }
    request(shouldReqTimeout, function (err) {
      checkErrCode(t, err)
      t.ok(err.connect === false, 'Error should have been a request timeout error')
      t.end()
    }).on('socket', function (socket) {
      const isConnecting = socket._connecting || socket.connecting
      t.ok(isConnecting !== true, 'Socket should already be connected')
    }).on('error', function () {})
  }).on('socket', function (socket) {
    const isConnecting = socket._connecting || socket.connecting
    t.ok(isConnecting === true, 'Socket should be new')
  }).on('error', function () {})
})

tape('calling abort clears the timeout', function (t) {
  const req = request({ url: s.url + '/timeout', timeout: 2500 }).on('error', function () {})
  setTimeout(function () {
    req.abort()
    t.equal(req.timeoutTimer, null)
    t.end()
  }, 5)
})

tape('cleanup', function (t) {
  s.close(function () {
    t.end()
  })
})
