'use strict'

var tape = require('tape')
var destroyable = require('server-destroy')

var server = require('./server')
var request = require('../index')
var url = require('url')
var Redirect = require('../lib/redirect').Redirect

function lookupLocalhost (hostname, options, callback) {
  callback(null, '127.0.0.1', 4)
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
      cookie: 'manual=1'
    },
    originalCookieHeader: 'manual=1',
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

function runTest (t, statusCode) {
  var s = server.createServer()
  var redirects = 0
  var cookieHeader = 'manual=1'
  var jar = request.jar()

  destroyable(s)

  s.on('/', function (req, res) {
    if (req.headers.host === `${s.redirectHost}:${s.port}`) {
      res.writeHead(statusCode || 302, {
        location: `http://${s.respondHost}:${s.port}/`
      })
      res.end()
    } else if (req.headers.host === `${s.respondHost}:${s.port}`) {
      res.writeHead(200)
      res.end('cookie: ' + (req.headers.cookie || '(nothing)'))
    } else {
      res.writeHead(400)
      res.end('unknown host')
    }
  })

  s.listen(0, function () {
    s.redirectHost = 'test1.local.omg' // resolves to 127.0.0.1
    s.respondHost = 'test2.local.omg' // resolves to 127.0.0.1

    jar.setCookieSync('jar=1', `http://${s.redirectHost}:${s.port}/`)

    request({
      url: `http://${s.redirectHost}:${s.port}/`,
      headers: {
        cookie: cookieHeader
      },
      jar: jar,
      followAllRedirects: true,
      followRedirect: true,
      lookup: lookupLocalhost
    }, function (err, res, body) {
      t.equal(err, null)
      t.equal(redirects, 1)
      t.equal(body.toString(), 'cookie: (nothing)')
      t.equal(res.request.headers.cookie, undefined)
      s.destroy(function () {
        t.end()
      })
    }).on('redirect', function () {
      redirects++
      t.equal(this.response.statusCode, statusCode)
      t.equal(this.uri.href, `http://${s.respondHost}:${s.port}/`)
    })
  })
}

function runPortTest (t) {
  var from = server.createServer()
  var to = server.createServer()
  var redirects = 0
  var cookieHeader = 'manual=1'

  destroyable(from)
  destroyable(to)

  from.on('/', function (req, res) {
    res.writeHead(302, {
      location: to.url + '/'
    })
    res.end()
  })

  to.on('/', function (req, res) {
    res.writeHead(200)
    res.end('cookie: ' + (req.headers.cookie || '(nothing)'))
  })

  from.listen(0, function () {
    to.listen(0, function () {
      request({
        url: from.url,
        headers: {
          cookie: cookieHeader
        },
        followAllRedirects: true,
        followRedirect: true
      }, function (err, res, body) {
        t.equal(err, null)
        t.equal(redirects, 1)
        t.equal(res.request.uri.href, to.url + '/')
        t.equal(body.toString(), 'cookie: (nothing)')
        t.equal(res.request.headers.cookie, undefined)
        from.destroy(function () {
          to.destroy(function () {
            t.end()
          })
        })
      }).on('redirect', function () {
        redirects++
        t.equal(this.response.statusCode, 302)
        t.equal(this.uri.href, to.url + '/')
      })
    })
  })
}

function runProtocolTest (t) {
  var from = server.createServer()
  var to = server.createSSLServer()
  var redirects = 0
  var cookieHeader = 'manual=1'

  destroyable(from)
  destroyable(to)

  from.on('/', function (req, res) {
    res.writeHead(302, {
      location: to.url + '/'
    })
    res.end()
  })

  to.on('/', function (req, res) {
    res.writeHead(200)
    res.end('cookie: ' + (req.headers.cookie || '(nothing)'))
  })

  from.listen(0, function () {
    to.listen(0, function () {
      request({
        url: from.url,
        headers: {
          cookie: cookieHeader
        },
        followAllRedirects: true,
        followRedirect: true,
        rejectUnauthorized: false
      }, function (err, res, body) {
        t.equal(err, null)
        t.equal(redirects, 1)
        t.equal(res.request.uri.href, to.url + '/')
        t.equal(body.toString(), 'cookie: (nothing)')
        t.equal(res.request.headers.cookie, undefined)
        from.destroy(function () {
          to.destroy(function () {
            t.end()
          })
        })
      }).on('redirect', function () {
        redirects++
        t.equal(this.response.statusCode, 302)
        t.equal(this.uri.href, to.url + '/')
      })
    })
  })
}

tape('301 redirect strips cookie header on cross-origin redirect', function (t) {
  runTest(t, 301)
})

tape('302 redirect strips cookie header on cross-origin redirect', function (t) {
  runTest(t, 302)
})

tape('303 redirect strips cookie header on cross-origin redirect', function (t) {
  runTest(t, 303)
})

tape('307 redirect strips cookie header on cross-origin redirect', function (t) {
  runTest(t, 307)
})

tape('308 redirect strips cookie header on cross-origin redirect', function (t) {
  runTest(t, 308)
})

tape('redirect strips cookie header when port changes', function (t) {
  runPortTest(t)
})

tape('redirect strips cookie header when protocol changes', function (t) {
  runProtocolTest(t)
})

tape('redirect preserves cookie header when default port is made explicit', function (t) {
  var httpRequest = requestForRedirect('http://example.com/path', 'http://example.com:80/next')
  var httpsRequest = requestForRedirect('https://example.com/path', 'https://example.com:443/next')

  t.equal(httpRequest.headers.cookie, 'manual=1')
  t.equal(httpRequest.originalCookieHeader, 'manual=1')

  t.equal(httpsRequest.headers.cookie, 'manual=1')
  t.equal(httpsRequest.originalCookieHeader, 'manual=1')
  t.end()
})
