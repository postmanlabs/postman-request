'use strict'

var server = require('./server')
var request = require('../index')
var util = require('util')
var tape = require('tape')
var destroyable = require('server-destroy')
var url = require('url')
var Redirect = require('../lib/redirect').Redirect

var s = server.createServer()
var ss = server.createSSLServer()

destroyable(s)
destroyable(ss)

// always send basic auth and allow non-strict SSL
request = request.defaults({
  auth: {
    user: 'test',
    pass: 'testing'
  },
  rejectUnauthorized: false
})

// redirect.from(proto, host).to(proto, host) returns an object with keys:
//   src : source URL
//   dst : destination URL
var redirect = {
  from: function (fromProto, fromHost) {
    return {
      to: function (toProto, toHost) {
        var fromPort = (fromProto === 'http' ? s.port : ss.port)
        var toPort = (toProto === 'http' ? s.port : ss.port)
        return {
          src: util.format(
            '%s://%s:%d/to/%s/%s',
            fromProto, fromHost, fromPort, toProto, toHost),
          dst: util.format(
            '%s://%s:%d/from/%s/%s',
            toProto, toHost, toPort, fromProto, fromHost)
        }
      }
    }
  }
}

function handleRequests (srv) {
  ['http', 'https'].forEach(function (proto) {
    ['localhost', '127.0.0.1'].forEach(function (host) {
      srv.on(util.format('/to/%s/%s', proto, host), function (req, res) {
        var r = redirect
          .from(srv.protocol, req.headers.host.split(':')[0])
          .to(proto, host)
        res.writeHead(301, {
          location: r.dst
        })
        res.end()
      })

      srv.on(util.format('/from/%s/%s', proto, host), function (req, res) {
        res.end('auth: ' + (req.headers.authorization || '(nothing)'))
      })
    })
  })
}

handleRequests(s)
handleRequests(ss)

function runTest (name, redir, expectAuth) {
  tape('redirect to ' + name, function (t) {
    request(redir.src, function (err, res, body) {
      t.equal(err, null)
      t.equal(res.request.uri.href, redir.dst)
      t.equal(res.statusCode, 200)
      t.equal(body, expectAuth
        ? 'auth: Basic dGVzdDp0ZXN0aW5n'
        : 'auth: (nothing)')
      t.end()
    })
  })
}

function redirectResponse (location) {
  return {
    statusCode: 302,
    caseless: {
      has: function (header) {
        return header.toLowerCase() === 'location'
      },
      get: function () {
        return location
      }
    },
    resume: function () {}
  }
}

function requestForRedirect (from, to) {
  var req = {
    uri: url.parse(from),
    urlParser: url,
    headers: {
      host: 'example.com',
      authorization: 'Basic abc'
    },
    method: 'GET',
    debug: function () {},
    removeHeader: function (header) {
      delete this.headers[header.toLowerCase()]
    },
    setHeader: function (header, value) {
      this.headers[header.toLowerCase()] = value
    },
    emit: function () {},
    init: function () {}
  }

  var redirect = new Redirect(req)
  redirect.onResponse(redirectResponse(to))
  return req
}

function runPortTest () {
  tape('redirect to same host different port', function (t) {
    var from = server.createServer()
    var to = server.createServer()

    destroyable(from)
    destroyable(to)

    from.on('/', function (req, res) {
      res.writeHead(301, {
        location: to.url + '/'
      })
      res.end()
    })

    to.on('/', function (req, res) {
      res.end('auth: ' + (req.headers.authorization || '(nothing)'))
    })

    from.listen(0, function () {
      to.listen(0, function () {
        request(from.url, function (err, res, body) {
          t.equal(err, null)
          t.equal(res.request.uri.href, to.url + '/')
          t.equal(res.statusCode, 200)
          t.equal(body, 'auth: (nothing)')
          from.destroy(function () {
            to.destroy(function () {
              t.end()
            })
          })
        })
      })
    })
  })
}

function addTests () {
  runTest('same host and protocol',
    redirect.from('http', 'localhost').to('http', 'localhost'),
    true)

  runTest('same host different protocol',
    redirect.from('http', 'localhost').to('https', 'localhost'),
    false)

  runTest('different host same protocol',
    redirect.from('https', '127.0.0.1').to('https', 'localhost'),
    false)

  runTest('different host and protocol',
    redirect.from('http', 'localhost').to('https', '127.0.0.1'),
    false)

  runPortTest()
}

tape('setup', function (t) {
  s.listen(0, function () {
    ss.listen(0, function () {
      addTests()
      tape('cleanup', function (t) {
        s.destroy(function () {
          ss.destroy(function () {
            t.end()
          })
        })
      })
      t.end()
    })
  })
})

tape('redirect URL helper', function (t) {
  t.deepEqual(
    redirect.from('http', 'localhost').to('https', '127.0.0.1'),
    {
      src: util.format('http://localhost:%d/to/https/127.0.0.1', s.port),
      dst: util.format('https://127.0.0.1:%d/from/http/localhost', ss.port)
    })
  t.deepEqual(
    redirect.from('https', 'localhost').to('http', 'localhost'),
    {
      src: util.format('https://localhost:%d/to/http/localhost', ss.port),
      dst: util.format('http://localhost:%d/from/https/localhost', s.port)
    })
  t.end()
})

tape('redirect preserves authorization when default port is made explicit', function (t) {
  var httpRequest = requestForRedirect('http://example.com/path', 'http://example.com:80/next')
  var httpsRequest = requestForRedirect('https://example.com/path', 'https://example.com:443/next')

  t.equal(httpRequest.headers.authorization, 'Basic abc')
  t.equal(httpsRequest.headers.authorization, 'Basic abc')
  t.end()
})
