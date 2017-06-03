'use strict';

const chai = require('chai');
// const expect = chai.expect;
const assert = chai.assert;
const AWS = require('aws-sdk-mock');
const app = require('../app');
const request = require('supertest');
const config = require('config');
//const mongoose = require('mongoose');
const models = require('../model');
const User = models.User;
const Job = models.Job;
const passport = require('passport');
const co = require('co');
passport.use(User.createStrategy());
const cleardb = require('mocha-mongoose')(config.mongodb.url, { noClear: true });
const stripe = require('stripe')(config.stripe.secret_key);

/* eslint-env mocha */

function register(username, password, options) {
    options = options || {};
    const admin = options.admin || false;
    const active = options.active || false;
    const balance = options.balance || 0;
    return new Promise((resolve, reject) => {
        const user = new User({ username: username, admin: admin, active: active, balance: balance });
        User.register(user, password, err => {
            if (err) {
                reject(err);
            }
            resolve(user);
        });
    });
}

describe('login', () => {
    beforeEach(function(done) {
        cleardb(done);
    });

    it('fails if user does not exist', () =>
            co(function *() {
                yield request(app)
                    .post('/users/signin')
                    .send({ username: 'hoga', password: 'hoge' })
                    .expect(data => {
                        assert.include(data.res.text, 'Password or username are incorrect');
                    });
            }));
    it('fails if password is wrong', () =>
            co(function *() {
                yield register('hoga', 'foo');
                yield request(app)
                    .post('/users/signin')
                    .send({ username: 'hoga', password: 'bar' })
                    .expect(data => {
                        assert.include(data.res.text, 'Password or username are incorrect');
                    });
            }));
    it('fails if it is inactive', () =>
            co(function *() {
                yield register('hoga', 'foo', { active: false });
                yield request(app)
                    .post('/users/signin')
                    .send({ username: 'hoga', password: 'foo' })
                    .expect(data => {
                        assert.include(data.res.text, 'inactive');
                    });
            }));

    it('success if username and password is correct', () =>
        co(function *() {
            yield register('hoga', 'foo', { active: true });
            yield request(app)
                .post('/users/signin')
                .send({ username: 'hoga', password: 'foo' })
                .expect(302, 'Found. Redirecting to /');
        }));
});

describe('user without login', () => {
    it('can access /', () =>
            request(app)
            .get('/')
            .expect(200)
      );
    it('can access /info/tokushou', () =>
            request(app)
            .get('/info/tokushou')
            .expect(200)
      );
    it('can access /info/shikinkessai', () =>
            request(app)
            .get('/info/shikinkessai')
            .expect(200)
      );
    it('can signin /users/signin', () =>
        request(app)
        .get('/users/signin')
        .expect(200)
      );
    it('can signup /users/signup', () =>
        request(app)
        .get('/users/signup')
        .expect(200)
      );
    it('cannnot access /users/', () =>
        request(app)
        .get('/users/')
        .expect(403)
      );
    it('cannnot access /users/charge', () =>
        request(app)
        .get('/users/charge')
        .expect(403)
      );
    it('cannot access /jobs/', () =>
        request(app)
        .get('/jobs/')
        .expect(403)
      );
    it('cannot access /jobs/new', () =>
        request(app)
        .get('/jobs/new')
        .expect(403)
      );
});

describe('users without admin and balance', () => {
    let agent;
    let job;
    let user;
    let another_user;
    let another_users_job;
    before(() => co(function *() {
        yield cleardb;

        user = yield register('hoga', 'foo', { active: true });

        another_user = yield register('hoge', 'foo', { active: true });

        job = new Job({
            user: user._id,
            state: 'unpaied',
            top_filename: 'test',
            filenames: ['test'],
            price: config.price,
            paid: false
        });
        yield job.save();

        another_users_job = new Job({
            user: another_user._id,
            state: 'unpaied',
            top_filename: 'hoge',
            filenames: ['hoge'],
            price: config.price,
            paid: false
        });
        yield another_users_job.save();

        agent = request.agent(app);
        yield agent
            .post('/users/signin')
            .send({ username: 'hoga', password: 'foo' });
    }));

    it('can access /users/me', () =>
        agent.get('/users/me')
             .expect(302, `Found. Redirecting to /users/${user._id}`)
      );
    it('can access /users/:id', () =>
        agent.get(`/users/${user._id}`)
             .expect(200)
      );
    it('can access /jobs/:id', () =>
        agent.get(`/jobs/${job._id}`)
             .expect(200)
      );
    it('can access /jobs/new', () =>
        agent.get('/jobs/new')
             .expect(200)
      );
    it('cannnot access /users/', () =>
        agent.get('/users/')
             .expect(403)
      );
    it('cannot access another user\'s page', () =>
        agent.get(`/users/${another_user._id}`)
             .expect(500)
      );
    it('cannot access another user\'s job', () =>
        agent.get(`/jobs/${another_users_job._id}`)
             .expect(500)
      );
    it('cannot specify checkout_ref', () =>
       agent.post('/jobs/')
             .attach('max_patches', './test/midi_device.maxpat')
             .field('top', 'midi_device.maxpat')
             .field('checkout_ref', 'refs/remotes/origin/dev')
             .field('instance', 'c4.xlarge')
             .expect(500)
             .expect(data => {
                 assert.include(data.res.text, 'checkout_ref is invalid');
             })
      );
    it('cannot specify instance', () =>
       agent.post('/jobs/')
             .attach('max_patches', './test/midi_device.maxpat')
             .field('top', 'midi_device.maxpat')
             .field('checkout_ref', 'refs/remotes/origin/master')
             .field('instance', 'c4.2xlarge')
             .expect(500)
             .expect(data => {
                 assert.include(data.res.text, 'instance is invalid');
             })
      );
    it('cannot create a job because of shortage of his balance', () =>
       agent.post('/jobs/')
             .attach('max_patches', './test/midi_device.maxpat')
             .field('top', 'midi_device.maxpat')
             .field('checkout_ref', 'refs/remotes/origin/master')
             .field('instance', 'c4.xlarge')
             .expect(500)
             .expect(data => {
                 assert.include(data.res.text, 'balance is too short');
             })
      );

    it('can purchase point', () => co(function *() {
        const old_user = yield User.findOne({ _id: user });
        assert.equal(old_user.balance, 0);
        const token = yield stripe.tokens.create({
            card: {
                number: '4242424242424242',
                exp_month: 12,
                exp_year: 2018,
                cvc: '123'
            }
        });
        yield agent.post('/users/charge')
                   .send({ stripeToken: token.id })
                   .expect(302, 'Found. Redirecting to /users/me');
        const new_user = yield User.findOne({ _id: user });
        assert.equal(new_user.balance, 999);
    }));
    it('cannot access /users/:id after logout', () => co(function *() {
        yield agent.get('/users/signout')
            .expect(302, 'Found. Redirecting to /');
        yield agent.get(`/users/${user._id}`)
             .expect(403);
    }));
});

function setTimeoutPromiss(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

describe('users without admin with balance', () => {
    let agent;
    before(() => co(function *() {
        AWS.mock('EC2', 'requestSpotInstances', function(params, callback) {
            callback(null, { SpotInstanceRequests: [{ SpotInstanceRequestId: 'test' }] });
        });
        AWS.mock('EC2', 'waitFor', function(param, param2, callback) {
            if (param === 'spotInstanceRequestFulfilled') {
                callback(null, { SpotInstanceRequests: [{ InstanceId: 'test' }] });
            } else if (param === 'instanceRunning') {
                callback(null);
            } else if (param === 'instanceTerminated') {
                callback(null);
            }
        });
        AWS.mock('EC2', 'createTags', function(params, callback) {
            callback(null);
        });
        AWS.mock('EC2', 'describeInstances', function(params, callback) {
            callback(null, { Reservations: [{ Instances: [{ PublicDnsName: 'test',  PrivateDnsName: 'test' }] }] });
        });
        AWS.mock('EC2', 'terminateInstances', function(params, callback) {
            callback(null);
        });
        AWS.mock('EC2', 'runInstances', function(params, callback) {
            callback(null, { Instances: [{ InstanceId: 'test' }] });
        });

        yield cleardb;
        yield register('hoga', 'foo', { active: true, balance: 1000 });
        agent = request.agent(app);
        yield agent
            .post('/users/signin')
            .send({ username: 'hoga', password: 'foo' });

    }));

    it('can make a job', () =>
       agent.post('/jobs/')
             .attach('max_patches', './test/midi_device.maxpat')
             .field('top', 'midi_device.maxpat')
             .field('checkout_ref', 'refs/remotes/origin/master')
             .field('instance', 'c4.xlarge')
             .expect(data => {
                 assert.include(data.res.text, 'Found. Redirecting to');
             })
             .expect(302)
      );
    it('can', function() {
        this.timeout(10000);
        return co(function *() {
            const jobs = yield Job.find({});
            console.log('jobs:');
            console.log(jobs);
            const job = jobs[0];
            yield setTimeoutPromiss(100);
            yield agent.get(`/jobs/data/${job._id}`)
                .expect(data => {
                    assert.equal(JSON.parse(data.res.text).job.state, 'instance terminated');
                });
        });
    });

    after(() => AWS.restore());
});

describe('users with admin', () => {
    let agent;
    let job;
    let user;
    let another_user;
    let another_users_job;
    before(() => co(function *() {
        yield cleardb;

        user = yield register('hoga', 'foo', { active: true, admin: true });

        another_user = yield register('hoge', 'foo', { active: true });

        job = new Job({
            user: user._id,
            state: 'unpaied',
            top_filename: 'test',
            filenames: ['test'],
            price: config.price,
            paid: false
        });
        yield job.save();

        another_users_job = new Job({
            user: another_user._id,
            state: 'unpaied',
            top_filename: 'hoge',
            filenames: ['hoge'],
            price: config.price,
            paid: false
        });
        yield another_users_job.save();

        agent = request.agent(app);
        yield agent
            .post('/users/signin')
            .send({ username: 'hoga', password: 'foo' });
    }));

    it('can access /users/', () =>
        agent.get('/users/')
             .expect(200)
      );
    it('can access /users/:id', () =>
        agent.get(`/users/${another_user._id}`)
             .expect(200)
      );
    it('can access /jobs/:id', () =>
        agent.get(`/jobs/${another_users_job._id}`)
             .expect(200)
      );
});
