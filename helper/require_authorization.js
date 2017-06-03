'use strict';

module.exports = function(option) {
    option = option || {};
    return function(req, res, next) {
        if (!req.isAuthenticated()) {
            const err = new Error('Not Authrized');
            err.status = 403;
            return next(err);
        }
        if (!req.user.active) {
            const err = new Error('Your Account is not active');
            err.status = 403;
            return next(err);
        }
        if (!option.dont_require_administrator && !req.user.admin) {
            const err = new Error('Permission Denied');
            err.status = 403;
            return next(err);
        }
        next();
    };
};
