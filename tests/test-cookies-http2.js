'use strict'

var request = require('../index')
var tape = require('tape')
var destroyable = require('server-destroy')
var server = require('./server')

var validUrl
var malformedUrl
var invalidUrl

var s = server.createHttp2Server()
destroyable(s)

tape('setup', function (t) {
  s.listen(0, function () {
    validUrl = s.url + '/valid'
    malformedUrl = s.url + '/malformed'
    invalidUrl = s.url + '/invalid'

    s.on('/valid', (req, res) => {
      res.setHeader('set-cookie', 'foo=bar')
      res.end('okay')
    })
    s.on('/malformed', (req, res) => {
      res.setHeader('set-cookie', 'foo')
      res.end('okay')
    })
    s.on('/invalid', (req, res) => {
      res.setHeader('set-cookie', 'foo=bar; Domain=foo.com')
      res.end('okay')
    })

    t.end()
  })
})

tape('simple cookie creation', function (t) {
  var cookie = request.cookie('foo=bar')
  t.equals(cookie.key, 'foo')
  t.equals(cookie.value, 'bar')
  t.end()
})

tape('simple malformed cookie creation', function (t) {
  var cookie = request.cookie('foo')
  t.equals(cookie.key, '')
  t.equals(cookie.value, 'foo')
  t.end()
})

tape('after server sends a cookie', function (t) {
  var jar1 = request.jar()
  request({
    method: 'GET',
    url: validUrl,
    jar: jar1,
    protocolVersion: 'http2',
    strictSSL: false
  },
    function (error, response, body) {
      t.equal(error, null)
      t.equal(jar1.getCookieStringSync(validUrl), 'foo=bar')
      t.equal(body, 'okay')

      var cookies = jar1.getCookiesSync(validUrl)
      t.equal(cookies.length, 1)
      t.equal(cookies[0].key, 'foo')
      t.equal(cookies[0].value, 'bar')
      t.end()
    })
})

tape('after server sends a malformed cookie', function (t) {
  var jar = request.jar()
  request({
    method: 'GET',
    url: malformedUrl,
    jar: jar,
    protocolVersion: 'http2',
    strictSSL: false
  },
    function (error, response, body) {
      t.equal(error, null)
      t.equal(jar.getCookieStringSync(malformedUrl), 'foo')
      t.equal(body, 'okay')

      var cookies = jar.getCookiesSync(malformedUrl)
      t.equal(cookies.length, 1)
      t.equal(cookies[0].key, '')
      t.equal(cookies[0].value, 'foo')
      t.end()
    })
})

tape('after server sends a cookie for a different domain', function (t) {
  var jar2 = request.jar()
  request({
    method: 'GET',
    url: invalidUrl,
    jar: jar2,
    protocolVersion: 'http2',
    strictSSL: false
  },
    function (error, response, body) {
      t.equal(error, null)
      t.equal(jar2.getCookieStringSync(validUrl), '')
      t.deepEqual(jar2.getCookiesSync(validUrl), [])
      t.equal(body, 'okay')
      t.end()
    })
})

tape('make sure setCookie works', function (t) {
  var jar3 = request.jar()
  var err = null
  try {
    jar3.setCookieSync(request.cookie('foo=bar'), validUrl)
  } catch (e) {
    err = e
  }
  t.equal(err, null)
  var cookies = jar3.getCookiesSync(validUrl)
  t.equal(cookies.length, 1)
  t.equal(cookies[0].key, 'foo')
  t.equal(cookies[0].value, 'bar')
  t.end()
})

tape('custom store', function (t) {
  var Store = function () {}
  var store = new Store()
  var jar = request.jar(store)
  t.equals(store, jar.store)
  t.end()
})

tape('cleanup', function (t) {
  s.destroy(function () {
    t.end()
  })
})
