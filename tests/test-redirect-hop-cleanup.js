'use strict'

var http = require('http')
var stream = require('stream')
var request = require('../index')
var tape = require('tape')

var hopSockets = {}

var server = http.createServer(function (req, res) {
  hopSockets[req.url] = req.socket

  if (req.url === '/redirect') {
    // reply before the request body is read (or even fully sent)
    res.writeHead(302, { location: '/target' })
    return res.end()
  }

  if (req.url === '/redirect-streaming') {
    // redirect response whose body is still streaming
    res.writeHead(302, { location: '/target' })
    return res.write('still sending')
  }

  if (req.url === '/redirect-reset') {
    // redirect whose connection is reset while the next hop is in flight
    res.writeHead(302, { location: '/slow-target' })
    res.write('still sending')
    return setTimeout(function () { req.socket.resetAndDestroy() }, 50)
  }

  if (req.url === '/slow-target') {
    return setTimeout(function () {
      res.writeHead(200)
      res.end('ok')
    }, 200)
  }

  res.writeHead(200)
  res.end('ok')
})

var port

tape('setup', function (t) {
  server.listen(0, function () {
    port = this.address().port
    t.end()
  })
})

tape('redirect closes the previous hop when its body was only partly sent', function (t) {
  hopSockets = {}

  var body = new stream.PassThrough()
  var hopRequests = []

  body.write('partial body') // never ended

  var r = request({
    method: 'POST',
    url: 'http://localhost:' + port + '/redirect',
    followAllRedirects: true,
    headers: { 'transfer-encoding': 'chunked' }
  }, function (err, res, data) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    t.equal(data, 'ok')
    t.equal(hopRequests.length, 2)

    var firstHopSocket = hopSockets['/redirect']
    t.ok(firstHopSocket, 'first hop reached the server')
    t.ok(hopRequests[0].destroyed, 'first hop ClientRequest is destroyed')

    if (firstHopSocket.destroyed) {
      return t.end()
    }

    var timer = setTimeout(function () {
      firstHopSocket.removeListener('close', onClose)
      firstHopSocket.destroy()
      t.fail('first hop socket is still open on the server')
      t.end()
    }, 500)

    firstHopSocket.once('close', onClose)

    function onClose () {
      clearTimeout(timer)
      t.pass('first hop socket is closed')
      t.end()
    }
  })

  r.on('request', function (req) {
    hopRequests.push(req)
  })

  body.pipe(r)
})

tape('closing a partly sent hop with a streaming redirect body does not error', function (t) {
  var body = new stream.PassThrough()

  body.write('partial body') // never ended

  var r = request({
    method: 'POST',
    url: 'http://localhost:' + port + '/redirect-streaming',
    followAllRedirects: true,
    headers: { 'transfer-encoding': 'chunked' }
  }, function (err, res, data) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    t.equal(data, 'ok')
    // give a late error from the closed hop a chance to surface
    setTimeout(function () { t.end() }, 50)
  })

  body.pipe(r)
})

tape('errors from a previous hop do not fail the request', function (t) {
  var calls = 0

  request({
    url: 'http://localhost:' + port + '/redirect-reset',
    agent: false
  }, function (err, res, data) {
    calls++
    t.equal(err, null)
    t.equal(res && res.statusCode, 200)
    t.equal(data, 'ok')
    // give a late error from the previous hop a chance to surface
    setTimeout(function () {
      t.equal(calls, 1, 'callback called once')
      t.end()
    }, 50)
  })
})

tape('redirect keeps a completed hop socket reusable', function (t) {
  hopSockets = {}

  var agent = new http.Agent({ keepAlive: true, maxSockets: 1 })

  request({
    url: 'http://localhost:' + port + '/redirect',
    agent: agent
  }, function (err, res, data) {
    t.equal(err, null)
    t.equal(res.statusCode, 200)
    t.equal(data, 'ok')
    t.equal(hopSockets['/redirect'], hopSockets['/target'], 'both hops share one socket')
    agent.destroy()
    t.end()
  })
})

tape('cleanup', function (t) {
  server.closeAllConnections()
  server.close(function () {
    t.end()
  })
})
