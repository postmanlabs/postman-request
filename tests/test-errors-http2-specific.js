'use strict'

var http2 = require('http2')
var request = require('../index')
var tape = require('tape')
var server = require('./server')
var destroyable = require('server-destroy')

const s = server.createHttp2Server()

destroyable(s)

tape('setup', function (t) {
  s.listen(0, function () {
    t.end()
  })
})

function addTest (errorCode, data = {}) {
  tape('test ' + errorCode, function (t) {
    s.on('/' + errorCode, function (req, res) {
      if (errorCode === 0) {
        res.end()
        return
      }
      res.stream.close(errorCode)
    })
    data.uri = s.url + '/' + errorCode
    request(
      { ...data, strictSSL: false, protocolVersion: 'http2' },
      function (err, resp, body) {
        if (errorCode === 0) {
          t.equal(err, null)
          t.end()
          return
        }
        if (errorCode === 8) {
          t.equal(err.message, `HTTP/2 Stream closed with error code NGHTTP2_CANCEL`)
          t.end()
          return
        }
        t.equal(err.message, `Stream closed with error code ${errorCodes[errorCode]}`)
        t.end()
      }
    )
  })
}

const errorCodes = [
  'NGHTTP2_NO_ERROR',
  'NGHTTP2_PROTOCOL_ERROR',
  'NGHTTP2_INTERNAL_ERROR',
  'NGHTTP2_FLOW_CONTROL_ERROR',
  'NGHTTP2_SETTINGS_TIMEOUT',
  'NGHTTP2_STREAM_CLOSED',
  'NGHTTP2_FRAME_SIZE_ERROR',
  'NGHTTP2_REFUSED_STREAM',
  'NGHTTP2_CANCEL',
  'NGHTTP2_COMPRESSION_ERROR',
  'NGHTTP2_CONNECT_ERROR',
  'NGHTTP2_ENHANCE_YOUR_CALM',
  'NGHTTP2_INADEQUATE_SECURITY',
  'NGHTTP2_HTTP_1_1_REQUIRED'
]

for (let i = 0; i < errorCodes.length; i++) {
  addTest(i)
}

tape('stream reset after the response starts does not throw', function (t) {
  s.on('/reset-after-response', function (req, res) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.write('{"status":500}')
    setTimeout(function () {
      res.stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR)
    }, 10)
  })

  var uncaught = []
  function onUncaught (err) {
    uncaught.push(err.message)
  }
  process.on('uncaughtException', onUncaught)

  request(
    { uri: s.url + '/reset-after-response', strictSSL: false, protocolVersion: 'http2' },
    function (err) {
      t.equal(err.message, 'Stream closed with error code NGHTTP2_INTERNAL_ERROR')
      setTimeout(function () {
        process.removeListener('uncaughtException', onUncaught)
        t.deepEqual(uncaught, [])
        t.end()
      }, 50)
    }
  )
})

tape('cleanup', function (t) {
  s.destroy(function () {
    t.end()
  })
})
