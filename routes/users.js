'use strict';

const express = require('express');
const router = express.Router();
const model = require('../model.js');
const User = model.User;
const Transaction = model.Transaction;
const passport = require('passport');
const config = require('config');
const require_authorization = require('../helper/require_authorization');
const request = require('request');
const stripe = require('stripe')(config.stripe.secret_key);
passport.use(User.createStrategy());

router.get('/', require_authorization(), function(req, res) {
    User.find({}, function(err, users) {
        res.render('users/index', { title: 'users', users: users });
    });
});

router.get('/signin', function(req, res) {
    res.render('users/signin', { });
});

router.post('/signin', function(req, res, next) {
    passport.authenticate('local', function(err, user, info) {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.render('users/signin', { title: 'Signin', message: info.message });
        }

        req.logIn(user, function(err) {
            if (err) {
                return next(err);
            }
            if (!user.active) {
                return next(new Error('your account is inactive'));
            }
            req.session.save(function(err) {
                if (err) {
                    return next(err);
                }
                return res.redirect('/');
            });
        });
    })(req, res, next);
});

router.get('/signup', function(req, res) {
    res.render('users/signup', { title: 'Signup', recaptcha: config.recaptcha });
});

router.post('/signup', function(req, res, next) {
    request.post({
        url: 'https://www.google.com/recaptcha/api/siteverify',
        form: {
            secret: config.recaptcha.secret_key,
            response: req.body['g-recaptcha-response']
        }
    }, (err, _, data) => {
        if (err) {
            return next(err);
        }
        if (!JSON.parse(data).success) {
            return next(new Error('recaptcha failed'));
        }
        User.register(new User({ username: req.body.username }), req.body.password, function(err) {
            if (err) {
                return next(err);
            } else {
                res.redirect('/');
            }
        });
    });
});

router.get('/signout', function(req, res) {
    req.logOut();
    res.redirect('/');
});

router.post('/charge', require_authorization({ dont_require_administrator: true }), function(req, res, next) {
    stripe.charges.create({
        amount: 999,
        currency: 'jpy',
        source: req.body.stripeToken
    }, function(err, charge) {
        if (err) {
            return next(err);
        }
        const transaction = new Transaction();
        transaction.user = req.user;
        transaction.amount = charge.amount;
        transaction.stripe_charge = charge;
        transaction.save().then(() => {
            User.findOneAndUpdate({ _id: req.user }, { $inc: { balance: charge.amount } }).then(() =>
                    res.redirect('/users/me')
                    );
        }).catch(err => next(err));
    });
});

router.get('/me', require_authorization({ dont_require_administrator: true }), function(req, res) {
    res.redirect(`/users/${req.user.id}`);
});

router.get('/:id', require_authorization({ dont_require_administrator: true }), function(req, res, next) {
    if (req.user.admin) {
        User.findOne({ _id: req.params.id }, function(err, user) {
            res.render('users/show', { title: user.username, user: user });
        });
    } else if (req.user.id === req.params.id) {
        res.render('users/show', { title: req.user.username, user: req.user });
    } else {
        next(new Error('no user found'));
    }
});

module.exports = router;
