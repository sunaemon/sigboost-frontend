'use strict';

const log4js = require('log4js');
const config = require('config');
log4js.configure(config.log4js.configure);

const logger = {
    system: log4js.getLogger('system'),
    access: log4js.getLogger('access')
};

for (const key in logger) {
    logger[key].setLevel(config.log4js.level);
}

module.exports = logger;
