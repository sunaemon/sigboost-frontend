'use strict';

const express = require('express');
const router = express.Router();
const multer  = require('multer');
const upload = multer({ dest: 'uploads/', limits: { fieldSize: 1024 * 1024, fileSize: 1024 * 1024, parts: 10 } });
const spawn = require('child-process-promise').spawn;
const sanitize = require('sanitize-filename');
const fs = require('fs-promise');
const path = require('path');
const os = require('os');
const model = require('../model');
const Job = model.Job;
const User = model.User;
const JobLog = model.JobLog;
const mongoose = require('mongoose');
const logger = require('../helper/logger');
const co = require('co');
const mergeStream = require('merge-stream');
const config = require('config');
const AWS = require('aws-sdk');

router.get('/', function(req, res) {
    if (req.user.admin) {
        Job.find({}).populate('user').exec(function(err, jobs) {
            res.render('jobs/index', { title: 'Jobs', jobs: jobs, user: req.user });
        });
    } else {
        Job.find({ user: req.user }, function(err, jobs) {
            res.render('jobs/index', { title: 'Jobs', jobs: jobs, user: req.user });
        });
    }
});

router.get('/new', function(req, res) {
    res.render('jobs/new', { title: 'New Job', user: req.user, price: config.price });
});

router.get('/:id', function(req, res, next) {
    co(function *() {
        let q;
        if (req.user.admin) {
            q = { _id: mongoose.Types.ObjectId(req.params.id) };
        } else {
            q = { _id: mongoose.Types.ObjectId(req.params.id), user: req.user };
        }
        const job = yield Job.findOne(q);

        res.render('jobs/show', { title: 'Job', job: job, user: req.user });
    }).catch(function(err) {
        next(err);
    });
});

router.get('/data/:id', function(req, res, next) {
    co(function *() {
        const job = yield Job.findOne({ _id: mongoose.Types.ObjectId(req.params.id), user: req.user });
        const logs = yield JobLog.find({ job: mongoose.Types.ObjectId(req.params.id) });

        res.json({ job, logs });
    }).catch(function(err) {
        next(err);
    });
});

router.get('/download/:id', function(req, res, next) {
    Job.findOne({ _id: mongoose.Types.ObjectId(req.params.id), user: req.user })
        .then(function(job) {
            if (job.done && job.outputfile_can_be_downloaded) {
                const output_binary = path.resolve(os.homedir(), job._id.toString(), 'output/BOOT.bin');
                res.download(output_binary);
            } else {
                const err = new Error('no output');
                err.status = 404;
                next(err);
            }
        });
});

function validate_post_param(req, res, next) {
    if (!req.body.top) {
        const err = new Error('top is empty');
        err.status = 500;
        next(err);
        return;
    }

    const filenames = [];
    const top_filename = sanitize(req.body.top);
    if (top_filename !== req.body.top) {
        const err = new Error('top is invalid');
        err.status = 500;
        next(err);
        return;
    }

    for (let i = 0; i < req.files.length; i++) {
        filenames.push(sanitize(req.files[i].originalname));

        if (filenames[i] !== req.files[i].originalname) {
            const err = new Error('Filename is invalid');
            err.status = 500;
            next(err);
            return;
        }
    }

    let contains = false;
    for (let i = 0; i < req.files.length; i++) {
        if (filenames[i] === top_filename) {
            contains = true;
        }
    }

    if (!contains) {
        const err = new Error('top is not contained in max_patches');
        err.status = 500;
        next(err);
        return;
    }

    if (!req.user.admin) {
        if (!['refs/remotes/origin/master'].includes(req.body.checkout_ref)) {
            const err = new Error('checkout_ref is invalid');
            err.status = 500;
            next(err);
            return;
        }
    }

    let allowed_instances;
    if (req.user.admin) {
        allowed_instances = ['c4.large', 'c4.xlarge', 'c4.2xlarge'];
    } else {
        allowed_instances = ['c4.xlarge'];
    }

    if (!allowed_instances.includes(req.body.instance)) {
        const err = new Error('instance is invalid');
        err.status = 500;
        next(err);
        return;
    }

    //TODO: 東京リージョンのon demand instanceの価格。変更になる場合があるので、APIで取ってくるべき。
    const ondemand_price = {
        'c4.large': '0.126',
        'c4.xlarge': '0.252',
        'c4.2xlarge': '0.504'
    };

    req.filenames = filenames;
    req.top_filename = top_filename;
    req.checkout_ref = req.body.checkout_ref;
    req.instance = req.body.instance;
    req.spotprice = ondemand_price[req.instance];

    next();
}

function setTimeoutPromiss(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

function try_connect(address) {
    return new Promise((resolve, reject) => {
        require('child_process').exec(`${config.ssh_program} -i ${config.key_file} -o ConnectTimeout=1 -o StrictHostKeyChecking=no ${config.user_name}@${address} /bin/echo ok`,
                (err, stdout, stderr) => {
                    logger.system.info(`stdout:${stdout}`);
                    logger.system.info(`stderr:${stderr}`);
                    if (err) {
                        reject(err.Error);
                    }
                    resolve();
                });
    });
}


function retry_connection(address, max_retry) {
    max_retry = max_retry || 100;

    return co(function *() {
        for (let i = 0; i < max_retry; i++) {
            try {
                yield try_connect(address);
                return;
            } catch (err) {
                logger.system.info(`error:${err}!, retry_count:${i}`);
            }
            yield setTimeoutPromiss(1000);
        }
    });
}

function *process_job(id, req) {
    const job_str = id.toString();

    const work_dir = path.resolve(os.homedir(), job_str);

    yield fs.mkdir(work_dir);
    yield fs.mkdir(path.resolve(work_dir, 'input'));
    yield fs.mkdir(path.resolve(work_dir, 'output'));

    for (let i = 0; i < req.files.length; i++) {
        const dest = path.resolve(work_dir, 'input/', req.filenames[i]);
        yield fs.copy(req.files[i].path, dest);
    }

    {
        const job = yield Job.findById(id);
        job.state = 'file prepared';
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }

    const ec2 = new AWS.EC2({ region: config.aws_region, apiVersion: '2016-11-15' });

    /*
    const spot_params = {
        SpotPrice: req.spotprice,
        InstanceCount: 1,
        BlockDurationMinutes: 60,
        LaunchSpecification: {
            ImageId: config.ami_id,
            KeyName: config.key_name,
            SecurityGroups: ['sigboost backend'],
            InstanceType: req.instance,
            EbsOptimized: true
        }
    };

    const spot_data = yield ec2.requestSpotInstances(spot_params).promise();
    const spot_instance_request = spot_data.SpotInstanceRequests[0].SpotInstanceRequestId;
    {
        const job = yield Job.findById(id);
        job.state = 'spot instance request issued';
        job.spotrequest = spot_instance_request;
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }

    // TODO: 入札が成功してインスタンス立ち上げが始まるまで待つ。
    // 時々spot block instanceの価格が高騰してon demand instanceの価格以上になったりすとタイムアウトする。
    // そこら辺の処理をちゃんとするべきだけどサボってる。
    const wait_data = yield ec2.waitFor('spotInstanceRequestFulfilled', { SpotInstanceRequestIds: [spot_instance_request] }).promise();
    logger.system.info(wait_data);
    logger.system.info(wait_data.SpotInstanceRequests);
    const inst = wait_data.SpotInstanceRequests[0].InstanceId;
    logger.system.info(inst);

    {
        const job = yield Job.findById(id);
        job.state = 'spot instance request fullfilled';
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }
    */

    //オンデマンドインスタンスの場合は以下のようにする。
    const params = {
        ImageId: config.ami_id,
        MinCount: 1,
        MaxCount: 1,
        KeyName: config.key_name,
        InstanceType: req.instance,
        SecurityGroups: ['sigboost backend'],
        EbsOptimized: true
    };

    const reserveations = yield ec2.runInstances(params).promise();
    logger.system.info(reserveations);
    const inst = reserveations.Instances[0].InstanceId;

    yield ec2.createTags({ Resources: [inst], Tags: [{ Key: 'Name', Value: 'HLS Backend(managed by frontend)' }] }).promise();
    yield ec2.waitFor('instanceRunning', { InstanceIds: [inst] }).promise();

    {
        const job = yield Job.findById(id);
        job.state = 'instance started';
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }

    const data = yield ec2.describeInstances({ InstanceIds: [inst] }).promise();
    const server_name = data.Reservations[0].Instances[0].PrivateDnsName;
    yield retry_connection(server_name);

    {
        const job = yield Job.findById(id);
        job.state = 'connected';
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }

    const log = fs.createWriteStream(path.resolve(work_dir, 'out.log'), { flags: 'a' });
    const args = [
        path.resolve('scripts/handler.py'),
        '-i', path.resolve(work_dir, 'input'),
        '-o', path.resolve(work_dir, 'output'),
        '-n', req.top_filename.replace(/\.[^/.]+$/, ''),
        '-k', config.key_file,
        '-m', `${config.user_name}@${server_name}`,
        '-c', req.checkout_ref];
    logger.system.info(args);
    const promise = spawn(config.python_program, args);
    const outputStream = mergeStream(promise.childProcess.stdout, promise.childProcess.stderr);
    outputStream.pipe(log);

    // 一行づつjob_loggerに書き込む
    const readline = require('readline');
    readline.createInterface({
        input: outputStream
    }).on('line', line => {
        JobLog.create({ job: id, timestamp: Date.now(), data: line });
    });
    yield promise;

    {
        const job = yield Job.findById(id);
        const output_binary = path.resolve(os.homedir(), job_str, 'output/BOOT.bin');
        if (fs.existsSync(output_binary)) {
            job.state = 'done';
            job.outputfile_can_be_downloaded = true;
        } else {
            job.state = 'error(No output)';
        }
        job.done = true;

        job.end = Date.now();
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }

    yield ec2.terminateInstances({ InstanceIds: [inst] }).promise();
    yield ec2.waitFor('instanceTerminated', { InstanceIds: [inst] }).promise();

    {
        const job = yield Job.findById(id);
        job.state = 'instance terminated';
        job.terminated = true;
        yield job.save();
        yield JobLog.create({ job: job, timestamp: Date.now(), data: `status changed: ${job.state}` });
    }
}

router.post('/', upload.array('max_patches', 10), validate_post_param, function(req, res, next) {
    co(function *() {
        let id;
        try {
            const job = new Job();
            job.start = Date.now();
            job.user = req.user;
            job.top_filename = req.top_filename;
            job.filenames = req.filenames;
            job.instance = req.instance;
            job.sipotprice = req.spotprice;
            job.price = config.price;
            job.paid = false;
            job.state = 'unpaied';
            id = job._id;
            yield job.save();

            const newUser = yield User.findOneAndUpdate({ _id: req.user }, { $inc: { balance: -job.price }, $push: { pending_job: id } }, { new: true });

            if (!req.user.admin && newUser.balance < 0) {
                try {
                    yield User.findOneAndUpdate({ _id: newUser }, { $inc: { balance: job.price }, $pull: { pending_job: id } });
                } catch (err) {
                    logger.system.fatal('cannnot revert balance'); // loggerも同じmongodbにつながっているので、findOneAndUpdateが失敗してこのログの保存がうまくいくか相当怪しいけど、まずい状態なのでログを吐くようにする
                    logger.system.fatal(err);
                    yield Promise.reject(err);
                }
                throw new Error('balance is too short');
            }

            job.state = 'paid';
            job.paid = true;
            yield job.save();

            yield User.findOneAndUpdate({ _id: req.user }, { $pull: { pending_job: id } });

            res.redirect(id.toString());
        } catch (err) {
            logger.system.error(err);
            next(err);
            return;
        }

        yield process_job(id, req);
    }).catch(function(err) {
        logger.system.fatal(err);
    });
});

module.exports = router;
