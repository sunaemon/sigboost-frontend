'use strict';

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
const uniqueValidator = require('mongoose-unique-validator');
const passportLocalMongoose = require('passport-local-mongoose');
const logger = require('./helper/logger');
const config = require('config');

const url = config.mongodb.url;
const connection = mongoose.createConnection(url, function(err) {
    if (err) {
        logger.system.error(`Error connected: ${url} - ${err}`);
    } else {
        logger.system.info(`Success connected: ${url}`);
    }
});

const userSchema = new mongoose.Schema({
    admin: { type: Boolean, deault: false },
    active: { type: Boolean, default: true },
    balance: { type: Number, default: 0 },
    // two phase commit用。jobに対する課金を行うと同時にpending_jobにjobを追加する
    // jobをpaidにした後にpending_jobからjobを削除する。
    pending_job: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true }]
});
userSchema.plugin(uniqueValidator);
userSchema.plugin(passportLocalMongoose);

const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: 0 },
    stripe_charge: { type: mongoose.Schema.Types.Mixed, required: true }
});

const jobSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    start: Date,
    end: Date,
    state: { type: String, required: true },
    top_filename: { type: String, required: true },
    filenames: { type: [String], required: true },
    price: { type: Number, required: true }, //ユーザーに請求される金額
    paid: { type: Boolean, required: true, default: false },
    outputfile_can_be_downloaded: { type: Boolean, default: false },
    done: { type: Boolean, default: false }, // エラーで終了したか、出力ファイルが生成したタイミングでtrueになる。
    terminated: { type: Boolean, default: false }, // 実行ジョブが終了済みかどうか。doneになった場合、これ以上ログの更新はない。
    instance: String, // ec2 instanceのid
    spotmaxprice: Number, // spot requestの入札価格
    spotcharge: Number, // spot instanceの実際の利用料金
    spotrequest: String // spot requestitd
});

const jobLogSchema = new mongoose.Schema({
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    timestamp: Date,
    data: String
});

exports.User = connection.model('User', userSchema);
exports.Job = connection.model('Job', jobSchema);
exports.JobLog = connection.model('JobLog', jobLogSchema);
exports.Transaction = connection.model('Transaction', transactionSchema);
exports.connection = connection;
