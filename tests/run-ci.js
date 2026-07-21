'use strict'

var childProcess = require('child_process')
var path = require('path')
var fs = require('fs')

var testsDir = __dirname
var taper = path.join(__dirname, '..', 'node_modules', 'taper', 'bin', 'taper.js')
var testFiles = fs.readdirSync(testsDir)
  .filter(function (file) {
    return /^test-.*\.js$/.test(file)
  })
  .sort()
  .map(function (file) {
    return path.join('tests', file)
  })

var result = childProcess.spawnSync(process.execPath, [taper].concat(testFiles), {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

process.exit(result.status)
