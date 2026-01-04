'use strict'

const url = require('url')
const tape = require('tape')
const request = require('../index')
const server = require('./server')

// Clean up environment variables before tests
const originalEnv = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  http_proxy: process.env.http_proxy,
  https_proxy: process.env.https_proxy
}

function cleanEnv () {
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
}

function restoreEnv () {
  Object.keys(originalEnv).forEach(key => {
    if (originalEnv[key] !== undefined) {
      process.env[key] = originalEnv[key]
    } else {
      delete process.env[key]
    }
  })
}

function createTestServers (callback) {
  const targetServer = server.createEchoServer()

  targetServer.listen(0, '127.0.0.1', () => {
    const targetPort = targetServer.address().port

    const socksServer = server.createSocksServer({
      auth: null
    }).listen(0, () => {
      const socksPort = socksServer.address().port
      socksServer.clearConnectionLog()
      callback(null, {
        targetServer,
        targetPort,
        socksServer,
        socksPort
      })
    })
  })
}

function createAuthTestServers (auth, callback) {
  const targetServer = server.createEchoServer()
  targetServer.listen(0, '127.0.0.1', () => {
    const targetPort = targetServer.address().port

    const socksServer = server.createSocksServer({
      auth
    }).listen(0, () => {
      const socksPort = socksServer.address().port
      socksServer.clearConnectionLog()
      callback(null, {
        targetServer,
        targetPort,
        socksServer,
        socksPort
      })
    })
  })
}

tape('setup', function (t) {
  cleanEnv()
  t.end()
})

tape('Direct request (no proxy) should create NO SOCKS connections', function (t) {
  const targetServer = server.createEchoServer()

  // Create a dummy SOCKS server to verify no connections are made to it
  const socksServer = server.createSocksServer({}).listen(0, () => {
    socksServer.clearConnectionLog()

    targetServer.listen(0, '127.0.0.1', () => {
      const targetPort = targetServer.address().port

      request({
        url: `http://127.0.0.1:${targetPort}/direct-no-proxy`,
        timeout: 5000
        // Note: NO proxy configuration - direct request
      }, (err, res, body) => {
        t.error(err, 'no error for direct request')
        t.equal(res.statusCode, 200, 'status code 200')

        const data = JSON.parse(body)
        t.equal(data.url, '/direct-no-proxy', 'correct URL received')

        // Validate NO SOCKS connections were made
        const connectionLog = socksServer.getConnectionLog()
        t.equal(connectionLog.length, 0, 'direct request created no SOCKS connections')

        targetServer.close()
        socksServer.close()
        t.end()
      })
    })
  })
})

tape('SOCKS5 proxy without authentication', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/test`,
      proxy: `socks5://127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/test', 'correct URL received')
      t.equal(data.method, 'GET', 'correct method')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'connection marked as successful')
      t.equal(connectionLog[0].version, 5, 'SOCKS5 version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS5 proxy with URL authentication', function (t) {
  createAuthTestServers({
    username: 'testuser',
    password: 'testpass'
  }, ({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/auth-test`,
      proxy: `socks5://testuser:testpass@127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with authentication')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/auth-test', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'authenticated connection successful')
      t.equal(connectionLog[0].version, 5, 'SOCKS5 version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS5 proxy with proxy.auth property', function (t) {
  createAuthTestServers({
    username: 'propuser',
    password: 'proppass'
  }, ({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    // Test proxy.auth property by using URL without auth and setting proxy.auth separately
    /* eslint-disable-next-line n/no-deprecated-api */
    const proxyUrl = url.parse(`socks5://127.0.0.1:${socksPort}`)
    proxyUrl.auth = 'propuser:proppass'

    request({
      url: `http://127.0.0.1:${targetPort}/prop-auth`,
      proxy: proxyUrl,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with proxy.auth')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/prop-auth', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'proxy.auth connection successful')
      t.equal(connectionLog[0].version, 5, 'SOCKS5 version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS5 proxy authentication failure', function (t) {
  createAuthTestServers({
    username: 'correct',
    password: 'password'
  }, ({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/should-fail`,
      proxy: `socks5://wrong:credentials@127.0.0.1:${socksPort}`,
      timeout: 3000
    }, (err, res, body) => {
      t.ok(err, 'should have error for wrong credentials')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS4 proxy support', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/socks4-test`,
      proxy: `socks4://127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with SOCKS4')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/socks4-test', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'SOCKS4 connection successful')
      t.equal(connectionLog[0].version, 4, 'SOCKS4 version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS4a proxy with hostname resolution', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/socks4a-test`,
      proxy: `socks4a://127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with SOCKS4a')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/socks4a-test', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'SOCKS4a connection successful')
      t.equal(connectionLog[0].version, 4, 'SOCKS4a version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS5h proxy with hostname resolution', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/socks5h-test`,
      proxy: `socks5h://127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with SOCKS5h')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/socks5h-test', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'SOCKS5h connection successful')
      t.equal(connectionLog[0].version, 5, 'SOCKS5h version logged')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('Default socks:// scheme uses SOCKS5', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    request({
      url: `http://127.0.0.1:${targetPort}/default-socks`,
      proxy: `socks://127.0.0.1:${socksPort}`,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with default socks scheme')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/default-socks', 'correct URL received')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection logged')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'default socks connection successful')
      t.equal(connectionLog[0].version, 5, 'default socks:// uses SOCKS5')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS proxy via HTTP_PROXY environment variable', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    // Set SOCKS URL in HTTP_PROXY environment variable (not explicit proxy config)
    process.env.HTTP_PROXY = `socks5://127.0.0.1:${socksPort}`

    request({
      url: `http://127.0.0.1:${targetPort}/env-socks-test`,
      timeout: 5000
    }, (err, res, body) => {
      delete process.env.HTTP_PROXY

      t.error(err, 'no error with SOCKS URL in HTTP_PROXY')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.url, '/env-socks-test', 'correct URL received via SOCKS from HTTP_PROXY')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'environment variable created SOCKS connection')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'environment SOCKS routed to correct target')
      t.equal(connectionLog[0].success, true, 'environment SOCKS connection successful')
      t.equal(connectionLog[0].version, 5, 'environment variable used SOCKS5')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('SOCKS proxy with POST data', function (t) {
  createTestServers(({
    targetServer,
    targetPort,
    socksServer,
    socksPort
  }) => {
    const postData = JSON.stringify({
      test: 'data',
      number: 42
    })

    request({
      url: `http://127.0.0.1:${targetPort}/post-test`,
      method: 'POST',
      proxy: `socks5://127.0.0.1:${socksPort}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      body: postData,
      timeout: 5000
    }, (err, res, body) => {
      t.error(err, 'no error with POST')
      t.equal(res.statusCode, 200, 'status code 200')

      const data = JSON.parse(body)
      t.equal(data.method, 'POST', 'POST method preserved')
      t.equal(data.body, postData, 'POST body preserved')
      t.equal(data.headers['content-type'], 'application/json', 'Content-Type preserved')

      const connectionLog = socksServer.getConnectionLog()
      t.equal(connectionLog.length, 1, 'exactly one SOCKS connection for POST')
      t.equal(connectionLog[0].targetHost, '127.0.0.1', 'correct target host logged')
      t.equal(connectionLog[0].targetPort, targetPort, 'correct target port logged')
      t.equal(connectionLog[0].success, true, 'POST through SOCKS successful')
      t.equal(connectionLog[0].version, 5, 'POST used SOCKS5')

      targetServer.close()
      socksServer.close()
      t.end()
    })
  })
})

tape('Invalid SOCKS proxy handling', function (t) {
  const targetServer = server.createEchoServer()

  targetServer.listen(0, '127.0.0.1', () => {
    const targetPort = targetServer.address().port

    request({
      url: `http://127.0.0.1:${targetPort}/should-fail`,
      proxy: 'socks5://nonexistent.host:1080',
      timeout: 2000
    }, (err, res, body) => {
      t.ok(err, 'should have error for nonexistent SOCKS proxy')
      t.ok(err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT', 'appropriate error condition')

      targetServer.close()
      t.end()
    })
  })
})

tape('cleanup', function (t) {
  restoreEnv()
  t.end()
})
