'use strict'

var zlib = require('zlib')
var createBrotliDecompress = zlib.createBrotliDecompress

/**
 * Exports a function that can be used to decompress a Brotli stream.
 *
 * @function
 *
 * @param {Object} options BrotliDecompress options
 * @returns {stream.Transform} A BrotliDecompress Transform function
 */
module.exports.createBrotliDecompress = createBrotliDecompress
