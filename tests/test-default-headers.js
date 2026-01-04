'use strict'

const METHODS = require('http').METHODS
const tape = require('tape')
const destroyable = require('server-destroy')

const request = require('../index')
const httpServer = require('./server').createServer()

destroyable(httpServer)

function forEachAsync (items, fn, cb) {
  !cb && (cb = function () { /* (ಠ_ಠ) */ })

  if (!(Array.isArray(items) && fn)) { return cb() }

  let index = 0
  const totalItems = items.length
  function next (err) {
    if (err || index >= totalItems) {
      return cb(err)
    }

    try {
      fn.call(items, items[index++], next)
    } catch (error) {
      return cb(error)
    }
  }

  if (!totalItems) { return cb() }

  next()
}

tape('setup', function (t) {
  httpServer.listen(0, t.end)
})

tape('default headers', function (t) {
  const url = httpServer.url
  // @note Node.js <= v10 force adds content-length
  const traceHeaders = parseInt(process.version.slice(1)) <= 10
    ? 'host | connection | content-length'
    : 'host | connection'

  httpServer.on('request', function (req, res) {
    const headers = Object.keys(req.headers).join(' | ')
    switch (req.method) {
      case 'GET':
      case 'HEAD':
      case 'DELETE':
      case 'OPTIONS':
        t.equal(headers, 'host | connection')
        break
      case 'TRACE':
        t.equal(headers, traceHeaders)
        break
      default:
        t.equal(headers, 'host | content-length | connection')
        break
    }
    res.end()
  })

  forEachAsync(METHODS, function (method, next) {
    if (method === 'CONNECT') { return next() }
    request({ url, method }, next)
  }, t.end)
})

tape('cleanup', function (t) {
  httpServer.destroy(t.end)
})
