'use strict'

const net = require('net')

// Force all ephemeral servers in tests to bind only to localhost.
const originalListen = net.Server.prototype.listen

net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number') {
    const port = args[0]

    if (args.length === 1) {
      return originalListen.call(this, port, '::')
    }

    if (typeof args[1] === 'function') {
      return originalListen.call(this, port, '::', args[1])
    }

    if (typeof args[1] === 'number' && typeof args[2] === 'function') {
      return originalListen.call(this, port, '::', args[1], args[2])
    }
  }

  return originalListen.apply(this, args)
}
