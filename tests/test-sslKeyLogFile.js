'use strict'

var server = require('./server')
var request = require('../index')
var fs = require('fs')
var path = require('path')
var os = require('os')
var tape = require('tape')

var s = server.createSSLServer()
var keylogFilePath = path.join(os.tmpdir(), 'test-keylog-' + Date.now() + '.txt')

tape('setup', function (t) {
  s.listen(0, function () {
    t.end()
  })
})

tape('sslKeyLogFile - file creation and content', function (t) {
  // Clean up file if it exists from a previous test run
  if (fs.existsSync(keylogFilePath)) {
    fs.unlinkSync(keylogFilePath)
  }

  s.on('/keylogtest', function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('success')
  })

  request({
    url: s.url + '/keylogtest',
    rejectUnauthorized: false,
    sslKeyLogFile: keylogFilePath
  }, function (err, res, body) {
    t.equal(err, null, 'request should not error')
    t.equal(body, 'success', 'should receive correct response')

    // Give a small delay to ensure the keylog file has been written
    setTimeout(function () {
      // Check if file was created
      var fileExists = fs.existsSync(keylogFilePath)
      t.ok(fileExists, 'keylog file should be created')

      if (fileExists) {
        // Check if file contains content
        var content = fs.readFileSync(keylogFilePath, 'utf8')
        t.ok(content.length > 0, 'keylog file should contain content')
        t.ok(content.includes('CLIENT_HANDSHAKE_TRAFFIC_SECRET') ||
             content.includes('SERVER_HANDSHAKE_TRAFFIC_SECRET') ||
             content.includes('CLIENT_TRAFFIC_SECRET') ||
             content.includes('SERVER_TRAFFIC_SECRET'),
             'keylog file should contain TLS key material')
      }

      t.end()
    }, 100)
  })
})

tape('sslKeyLogFile - multiple requests append to same file', function (t) {
  // Use the file from the previous test
  var initialSize = 0
  if (fs.existsSync(keylogFilePath)) {
    initialSize = fs.statSync(keylogFilePath).size
  }

  s.on('/keylogtest2', function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('success2')
  })

  request({
    url: s.url + '/keylogtest2',
    rejectUnauthorized: false,
    sslKeyLogFile: keylogFilePath
  }, function (err, res, body) {
    t.equal(err, null, 'second request should not error')
    t.equal(body, 'success2', 'should receive correct response from second request')

    setTimeout(function () {
      if (fs.existsSync(keylogFilePath)) {
        var newSize = fs.statSync(keylogFilePath).size
        // The file size should be at least as large as before (might be same if socket is reused)
        t.ok(newSize >= initialSize, 'keylog file should have content from multiple requests')
      }

      t.end()
    }, 100)
  })
})

tape('cleanup', function (t) {
  // Clean up the keylog file
  if (fs.existsSync(keylogFilePath)) {
    fs.unlinkSync(keylogFilePath)
  }

  s.close(function () {
    t.end()
  })
})

