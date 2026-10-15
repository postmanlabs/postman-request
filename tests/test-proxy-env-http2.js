'use strict'

var fs = require('fs')
var http = require('http')
var http2 = require('http2')
var net = require('net')
var path = require('path')
var tape = require('tape')
var destroyable = require('server-destroy')
var request = require('../index')

var caPath = path.resolve(__dirname, 'ssl/ca/ca.crt')
var ca = fs.readFileSync(caPath)

var proxyEnvVars = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY']
var connects = []

var target = http2.createSecureServer({
  key: fs.readFileSync(path.resolve(__dirname, 'ssl/ca/localhost.key')),
  cert: fs.readFileSync(path.resolve(__dirname, 'ssl/ca/localhost.crt')),
  allowHTTP1: true
}, function (req, res) {
  res.end('http' + req.httpVersion)
})

var proxy = http.createServer()

proxy.on('connect', function (req, clientSocket, head) {
  connects.push(req.url)

  var upstream = net.connect(target.address().port, '127.0.0.1', function () {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', function () { clientSocket.destroy() })
  clientSocket.on('error', function () { upstream.destroy() })
})

destroyable(target)
destroyable(proxy)

// Runs with only the given proxy env vars set, restoring process.env after.
function runTest (name, protocolVersion, env, options, verify) {
  tape(name, function (t) {
    var saved = {}
    proxyEnvVars.forEach(function (v) {
      saved[v] = process.env[v]
      delete process.env[v]
    })
    env = typeof env === 'function' ? env() : env
    options = typeof options === 'function' ? options() : options
    Object.keys(env).forEach(function (v) { process.env[v] = env[v] })
    connects.length = 0

    function restore () {
      proxyEnvVars.forEach(function (v) {
        if (saved[v] === undefined) {
          delete process.env[v]
        } else {
          process.env[v] = saved[v]
        }
      })
    }

    try {
      request(Object.assign({
        url: 'https://localhost:' + target.address().port + '/',
        ca: ca,
        protocolVersion: protocolVersion
      }, options), function (err, res, body) {
        restore()
        t.equal(err, null)
        if (!err) verify(t, res, body)
        t.end()
      })
    } catch (e) {
      restore()
      throw e
    }
  })
}

tape('setup', function (t) {
  target.listen(0, function () {
    proxy.listen(0, '127.0.0.1', function () {
      t.end()
    })
  })
})

;['http2', 'auto'].forEach(function (protocolVersion) {
  var proxyUrl = function () { return 'http://127.0.0.1:' + proxy.address().port }

  runTest(protocolVersion + ': environment proxy falls back to http1 through CONNECT', protocolVersion, function () {
    return { HTTPS_PROXY: proxyUrl() }
  }, {}, function (t, res, body) {
    t.equal(res.statusCode, 200)
    t.equal(body, 'http1.1')
    t.deepEqual(connects, ['localhost:' + target.address().port])
  })

  runTest(protocolVersion + ': NO_PROXY keeps http2 direct', protocolVersion, {
    HTTPS_PROXY: 'http://127.0.0.1:1',
    NO_PROXY: 'localhost'
  }, {}, function (t, res, body) {
    t.equal(res.statusCode, 200)
    t.equal(body, 'http2.0')
    t.equal(connects.length, 0)
  })

  runTest(protocolVersion + ': explicit proxy option falls back to http1', protocolVersion, {}, function () {
    return { proxy: proxyUrl() }
  }, function (t, res, body) {
    t.equal(res.statusCode, 200)
    t.equal(body, 'http1.1')
    t.deepEqual(connects, ['localhost:' + target.address().port])
  })
})

tape('cleanup', function (t) {
  target.destroy(function () {
    proxy.destroy(function () {
      t.end()
    })
  })
})
