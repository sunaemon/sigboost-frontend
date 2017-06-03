import subprocess
import os,sys
import argparse


"""
# handler.py
    AMIインスタンス上のsigboo_dockerをハンドルして合成を行う。

## 流れ：
    ファイルの転送 -> HLSのソースの更新 -> 合成 -> 合成結果の取得

## Usage：
    -i 入力となるmaxpatが入っているディレクトリを指定する
    -o BOOT.binの出力先となるディレクトリを指定する。ディレクトリは存在している必要がある。
    -n 入力となるmaxpatのトップ階層となるmaxpatの名前を指定する。(ex. fm)
    -k AMIのキーを指定する
    -m AMIのマシン名を指定する（ex. ubuntu@ec2-54-250-171-127.ap-northeast-1.compute.amazonaws.com)
    -c チェックアウトするブランチ名を指定する。指定しなければ最新のmasterブランチを取得し合成を行う。(ex. refs/tags/v0.0.1) (ex. origin/dev)
    ex. python3 handler.py -i ~/input -o ~/output -n fm -k ~/keys/admin_tokyo.pem -m ubuntu@ec2-54-250-171-127.ap-northeast-1.compute.amazonaws.com -c refs/remotes/origin/master


## 補足：
    主にXSDKの不具合を回避するためのWorkaroundが幾つか仕込まれている。
        - 初回の合成のみXSDKのMake Projectに時間がかかりタイムアウトでコケる問題
            パッチ済みのxsdb.tclによるXSDK自体の更新と、HLS側のパッチ（--increase_xsdk_timeoutオプション）で回避
        - XSDKのMake ProjectでrlwrapがSIGFPEでクラッシュする
            TERMを強制的に紐付けてsshで解決(ssh -t -t)
            標準入力に/dev/nullを与えた環境下ではssh -t -tでも回避できないため、screenを噛ませる
        - XSDKの起動時、画面出力先が無くてgtk_initchetk()で死ぬ
            vnc.shで事前にVNCのデーモンを立ち上げ、そこを出力先にした状態で動かして回避
    詳細は　https://github.com/kuguma/sigboost/wiki/VIVADO-Fuckin'-Issues　を確認されたし。

"""


class Environment:
    pem = "" # ex) 'admin.pem'
    backend = "" # ex) ubuntu@ec2-52-204-60-126.compute-1.amazonaws.com
    container = "sigboo_builder"
    image = "sigboo:latest"
    prj_name = ""
    indir_front = "~/input"
    outdir_front = "~/output"
    option = ""
    checkout = "" # version of sigboost-hls


# -------------------
# ArgParse & Set Environment Value
# -------------------

def set_env(env):
    # 引数設定
    parser = argparse.ArgumentParser(description='handler of sigboost HLS Backend (EC2)')
    parser.add_argument('--input', '-i', required=True)
    parser.add_argument('--output', '-o', required=True)
    parser.add_argument('--name', '-n', required=True)
    parser.add_argument('--key', '-k', required=True)
    parser.add_argument('--machine', '-m', required=True)
    parser.add_argument("--checkout", '-c')
    opt = parser.parse_args()
    env.indir_front = opt.input
    env.outdir_front = opt.output
    env.prj_name = opt.name
    env.pem = opt.key
    env.backend = opt.machine
    env.checkout = opt.checkout #ex : refs/tags/v0.0.1 , origin/dev


# -------------------
# utils
# -------------------

def ec2_shell(env, s, tty=False):
    if tty:
        cmd = "ssh -t -t -i {env.pem} {env.backend} {s}".format(**locals())
    else:
        cmd = "ssh -i {env.pem} {env.backend} {s}".format(**locals())
    shell(cmd)

def shell(s):
    print("-------------------------\nCMD : "+s,flush=True)
    subprocess.call(s,shell=True)


# -------------------
# for Handle EC2
# -------------------

def remote_proc(env):
    prepare(env)
    update_repo(env)
    push_input(env)
    hls(env)
    fetch_result(env)
    end(env)

def update_repo(env):
    if env.checkout != None:
        ec2_shell( env, "sudo docker exec -t {env.container} \"bash -c 'cd /root/sigboost-hls/ && git fetch -q && git checkout -q -b sigboo_build {env.checkout}'\"".format(**locals()) )
    else:
        ec2_shell( env, "sudo docker exec -t {env.container} \"bash -c 'cd /root/sigboost-hls/ && git pull -q'\"".format(**locals()) )

def prepare(env):
    # container start-up
    ec2_shell( env, "sudo docker kill {env.container}".format(**locals()) )
    ec2_shell( env, "sudo docker rm {env.container}".format(**locals()) )
    ec2_shell( env, "sudo docker run -v /home/ubuntu/input/:/root/input/ -v /home/ubuntu/output/:/root/work/{env.prj_name}/output/ -v /home/ubuntu/log/:/root/work/{env.prj_name}/log/ --name {env.container} -itd {env.image}".format(**locals()) )

def push_input(env):
    # frontend -> backend
    shell( "scp -i {env.pem} -r {env.indir_front} {env.backend}:~/".format(**locals()) )
    # Workaround of Xilinx FXXKING BUG
    script_path = os.path.abspath(os.path.dirname(__file__))
    shell( "scp -i {env.pem} {script_path}/xsdb.tcl {env.backend}:~/xsdb.tcl".format(**locals()) )
    #ec2_shell( env, "sudo docker exec -t {env.container} sed -n 6246p /opt/Xilinx/SDK/2015.2/scripts/xsdb/xsdb/xsdb.tcl".format(**locals()) )
    ec2_shell( env, "sudo docker cp xsdb.tcl {env.container}:/opt/Xilinx/SDK/2015.2/scripts/xsdb/xsdb/xsdb.tcl".format(**locals()) )
    #ec2_shell( env, "sudo docker exec -t {env.container} sed -n 6246p /opt/Xilinx/SDK/2015.2/scripts/xsdb/xsdb/xsdb.tcl".format(**locals()) )

    # backend -> container
    #ec2_shell( env, "sudo docker cp input/ {env.container}:/root/".format(**locals()) )

def hls(env):
    ec2_shell( env, "sudo docker exec -t {env.container} cp -r /lib/terminfo/x/ /usr/share/terminfo/x/".format(**locals()), tty=True)
    ec2_shell( env, "screen sudo docker exec -t {env.container} \"bash -c 'sh /root/vnc.sh && ps && python3 /root/sigboost-hls/script/sigboost_hls_system.py -m /root/input/{env.prj_name}.maxpat -p {env.prj_name} --increase_xsdk_timeout'\"".format(**locals()), tty=True)

def fetch_result(env):
    # container -> backend
    #ec2_shell( env, "sudo docker cp {env.container}:/root/work/{env.prj_name}/output/BOOT.bin output/BOOT.bin".format(**locals()) )
    # backend -> frontend
    shell( "scp -i {env.pem} {env.backend}:~/output/BOOT.bin {env.outdir_front}/BOOT.bin".format(**locals()) )

def end(env):
    ec2_shell( env,"sudo docker stop {env.container}".format(**locals()) )


# -------------------
# main
# -------------------

def main(env):
    set_env(env);
    #local_proc(env)
    remote_proc(env)


if __name__ == '__main__':
    env = Environment()
    #update_repo(env)
    main(env)
