[![CircleCI](https://circleci.com/gh/kuguma/sigboost-frontend/tree/master.svg?style=svg&circle-token=1566b0b4bc639564d747d9fc540885b4caf9849b)](https://circleci.com/gh/kuguma/sigboost-frontend/tree/master)
[![codecov](https://codecov.io/gh/kuguma/sigboost-frontend/branch/master/graph/badge.svg?token=P0gtOH0XjW)](https://codecov.io/gh/kuguma/sigboost-frontend)
[![Dependency Status](https://www.versioneye.com/user/projects/58fc6650710da2402c6705c7/badge.svg?style=flat-square)](https://www.versioneye.com/user/projects/58fc6650710da2402c6705c7)

# sigboost-frontend

Server Frontend of sigboost

- Handle Backend
- User Registration
- Web Application

## refreence
- https://stripe.com/docs/checkout/tutorial
- https://docs.mongodb.com/manual/tutorial/perform-two-phase-commits/

## Localで動かす場合
mongodbをインストールする。
AWSのアクセストークンを~/.aws/credentialsに保存。パーミッションは600にする。
AWSの秘密鍵を~/keys/admin_tokyo.pemに保存。パーミッションは600にする。
```
$ git clone git@github.com:kuguma/sigboost-frontend.git
$ cd sigboost-frontend
$ bower install
$ npm install
$ npm start
```

## フロントエンドサーバーの初回セットアップ
まず、ssh-agentにgit@github.com:kuguma/sigboost-frontend.gitにアクセスできる秘密鍵を登録しておく。

ec2インスタンスにmongodbをインストール。
(refer https://docs.mongodb.com/manual/tutorial/install-mongodb-on-amazon/)

```sh
$ ssh ec2-user@hls.sigboost.audio
$ sudo su
# yum upgrade -y
# yum install -y nginx git
# certbot-auto certonly -d hls.sigboost.audio
# useradd -m node
# uermod -a -G wheel node
# visudo # please activate '%wheel ALL=(ALL): ALL'
# mkdir -p /opt/sigboost_webapp
# chmod -R node /opt/sigboost_webapp
# chkconfig nginx on
# su node
$ cd
$ curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.33.1/install.sh | bash
$ nvm install v6.10
$ npm install -g bower pm2
$ pm2 startup
$ logout
# gpasswd -d node wheel
```

then on local
```sh
# pm2 deploy ecosystem.config.js production
```

#

on ec2
```sh

# cd /opt/sigboost_webapp/current/
# cp nginx.conf /etc/nginx/nginx.conf
# sudo -u node vi config/production.json #config/development.jsonを雛形にトークンの設定をしてください
# service nginx restart
# su node
$ pm2 save
```

## 上記セットアップが済んでいるサーバーに対し、アップデートをデプロイするとき
まず、ssh-agentにgit@github.com:kuguma/sigboost-frontend.gitにアクセスできる秘密鍵を登録しておく。
ローカルで以下を実行。
```sh
$ git clone git@github.com:kuguma/sigboost-frontend.git
$ cd sigboost-frontend
$ npm install -g pm2
$ pm2 deploy ecosystem.config.js production
```


## (管理者むけ)monbodbの叩き方
あるユーザー(この例ではidが58f6e393e766056848c86051のユーザー)に管理者権限を付与したいときは以下のようにする。
```sh
$ mongo
> use sigboost_webapp
switched to db sigboost_webapp
> db.users.update({_id: ObjectId("58f6e393e766056848c86051")}, { $set: { "admin": true }})
WriteResult({ "nMatched" : 1, "nUpserted" : 0, "nModified" : 1 })
```

