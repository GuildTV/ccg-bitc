const nconf = require('nconf')

const defaults = {
    http: {
        port: 8081
    },
    osc: {
        port: 5253
    },
    caspar: {
        host: "127.0.0.1",
        port: 5250
    },
    source: {
        channel: 1,
        layer: 10,
    },
    output: {
        channel: 2
    }
  }

const config = nconf
  .argv()
  .defaults(defaults)
  .get()

module.exports = config;
