const tape = require('tape')
const server = require('./server')
const request = require('../index')
const destroyable = require('server-destroy')
const urlEncoder = require('postman-url-encoder')

const httpServer = server.createServer()

destroyable(httpServer)

tape('setup', function (t) {
  httpServer.listen(0, function () {
    httpServer.on('/query', function (req, res) {
      res.writeHead(200)
      res.end(req.url)
    })

    httpServer.on('/redirect', function (req, res) {
      res.writeHead(301, {
        Location: httpServer.url + '/query?q={(`*`)}'
      })
      res.end()
    })

    httpServer.on('/relative_redirect', function (req, res) {
      res.writeHead(301, {
        Location: '/query?q={(`*`)}'
      })
      res.end()
    })

    t.end()
  })
})

// @note: all these tests have `disableUrlEncoding` option set to true
// so that it don't do extra encoding on top of given `urlParse` option

tape('without urlParser option', function (t) {
  const requestUrl = httpServer.url + '/query?q={(`*`)}'
  const options = { disableUrlEncoding: true }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to url.parse()
    t.equal(body, '/query?q=%7B(%60*%60)%7D')
    t.end()
  })
})

tape('without urlParser option with redirect', function (t) {
  const requestUrl = httpServer.url + '/redirect'
  const options = { disableUrlEncoding: true }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to url.parse()
    t.equal(body, '/query?q=%7B(%60*%60)%7D')
    t.end()
  })
})

tape('without urlParser option and redirect with relative URL', function (t) {
  const requestUrl = httpServer.url + '/relative_redirect'
  const options = { disableUrlEncoding: true }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to url.parse()
    t.equal(body, '/query?q=%7B(%60*%60)%7D')
    t.end()
  })
})

tape('with urlParser option', function (t) {
  const requestUrl = httpServer.url + '/query?q={(`*`)}'
  const options = {
    disableUrlEncoding: true,
    urlParser: {
      parse: urlEncoder.toNodeUrl,
      resolve: urlEncoder.resolveNodeUrl
    }
  }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to customUrlParser()
    t.equal(body, '/query?q={(`*`)}')
    t.end()
  })
})

tape('with urlParser option and redirect', function (t) {
  const requestUrl = httpServer.url + '/redirect'
  const options = {
    disableUrlEncoding: true,
    urlParser: {
      parse: urlEncoder.toNodeUrl,
      resolve: urlEncoder.resolveNodeUrl
    }
  }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to customUrlParser()
    t.equal(body, '/query?q={(`*`)}')
    t.end()
  })
})

tape('with urlParser option and redirect with relative URL', function (t) {
  const requestUrl = httpServer.url + '/relative_redirect'
  const options = {
    disableUrlEncoding: true,
    urlParser: {
      parse: urlEncoder.toNodeUrl,
      resolve: urlEncoder.resolveNodeUrl
    }
  }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to customUrlParser()
    t.equal(body, '/query?q={(`*`)}')
    t.end()
  })
})

tape('with invalid urlParser option', function (t) {
  const requestUrl = httpServer.url + '/query?q={(`*`)}'
  const options = {
    disableUrlEncoding: true,
    urlParser: 'invalid option. this should be an object'
  }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to url.parse()
    t.equal(body, '/query?q=%7B(%60*%60)%7D')
    t.end()
  })
})

tape('with urlParser option but missing required methods', function (t) {
  const requestUrl = httpServer.url + '/query?q={(`*`)}'
  const options = {
    disableUrlEncoding: true,
    urlParser: {
      parse: urlEncoder.toNodeUrl
      // resolve method is missing in this option
    }
  }

  request(requestUrl, options, function (err, res, body) {
    t.equal(err, null)

    // it should be encoded according to url.parse()
    t.equal(body, '/query?q=%7B(%60*%60)%7D')
    t.end()
  })
})

tape('cleanup', function (t) {
  httpServer.destroy(function () {
    t.end()
  })
})
