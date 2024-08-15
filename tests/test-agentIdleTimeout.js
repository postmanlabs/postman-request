'use strict'

var server = require('./server')
var request = require('../index')
var tape = require('tape')

var s

function createServer () {
  const s = server.createServer()

  s.on('/', function (req, res) {
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

tape('should reuse the same agent', function (t) {
  const data = {
    url: s.url + '/',
    agentIdleTimeout: 1000
  }

  const r1 = request(data, function (err, res) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    const r2 = request(data, function (err) {
      t.equal(err, null)
      t.end()
      t.equal(r1.agent.identifier, r2.agent.identifier)
    })
  })
  r1.agent.identifier = '1234'
})

tape('should use new agent after timeout', function (t) {
  const data = {
    url: s.url + '/',
    agentIdleTimeout: 100
  }

  const r1 = request(data, function (err, res) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    setTimeout(() => {
      const r2 = request(data, function (err) {
        t.equal(err, null)
        t.end()
        t.notEqual(r1.agent.identifier, r2.agent.identifier)
      })
    }, 200)
  })
  r1.agent.identifier = '12345'
})

tape('cleanup', function (t) {
  s.close(function () {
    t.end()
  })
})
