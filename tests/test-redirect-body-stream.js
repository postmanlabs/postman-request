'use strict'

var http = require('http')
var fs = require('fs')
var path = require('path')
var stream = require('stream')
var crypto = require('crypto')
var request = require('../index')
var tape = require('tape')
var destroyable = require('server-destroy')

var fixtureBody = fs.readFileSync(path.join(__dirname, 'unicycle.jpg'))

var server = http.createServer(function (req, res) {
  var status = Number(req.url.split('/')[1])

  if (status >= 300) {
    // reply before the request body is read
    res.writeHead(status, { location: '/target' })
    return res.end()
  }

  var chunks = []
  req.on('data', function (chunk) { chunks.push(chunk) })
  req.on('end', function () {
    // answer slowly so late writes from an old body can reach this hop
    setTimeout(respond, 100)
  })

  function respond () {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      method: req.method,
      length: Buffer.concat(chunks).length,
      sha1: sha1(Buffer.concat(chunks))
    }))
  }
})

destroyable(server)

var port

function parse (data) {
  try {
    return JSON.parse(data)
  } catch (e) {
    return null
  }
}

function sha1 (buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex')
}

function url (status) {
  return 'http://localhost:' + port + '/' + status
}

tape('setup', function (t) {
  server.listen(0, function () {
    port = this.address().port
    t.end()
  })
})

tape('302: the rest of a streamed body is not sent to the GET hop', function (t) {
  var body = new stream.PassThrough()
  var calls = 0

  body.write('first part')

  var r = request({
    method: 'POST',
    url: url(302),
    body: body,
    followAllRedirects: true
  }, function (err, res, data) {
    data = parse(data)
    calls++
    t.equal(err, null, String(err && err.message) + ' ' + (res && res.statusCode))
    t.equal(data && data.method, 'GET')
    t.equal(data && data.length, 0)
    setTimeout(function () {
      t.equal(calls, 1, 'callback called once')
      t.end()
    }, 50)
  })

  r.on('request', function (req) {
    if (req.method === 'GET') {
      setTimeout(function () {
        body.end('second part')
      }, 20)
    }
  })
})

tape('307: a stream body swapped in the redirect listener is sent in full', function (t) {
  var r = request({
    method: 'POST',
    url: url(307),
    followAllRedirects: true,
    body: stream.Readable.from([fixtureBody]),
    headers: { 'content-length': fixtureBody.length }
  }, function (err, res, data) {
    data = parse(data)
    t.equal(err, null, String(err && err.message) + ' ' + (res && res.statusCode))
    t.equal(data && data.method, 'POST')
    t.equal(data && data.length, fixtureBody.length)
    t.equal(data && data.sha1, sha1(fixtureBody))
    t.end()
  })

  r.on('redirect', function () {
    this.body = stream.Readable.from([fixtureBody])
  })
})

tape('cleanup', function (t) {
  server.destroy(function () {
    t.end()
  })
})
