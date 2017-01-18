'use strict'

var request = require('../index')
  , tape = require('tape')

tape('using + in query string', function(t) {
  request({ url: 'http://echo.getpostman.com/get?a=обязательный&b=foo+bar' },
    function (error, response, body) {
      var body = JSON.parse(body)
      t.deepEqual((body.args), {
        a: 'обязательный',
        b: 'foo+bar'
      })
      t.end()
    })
})
