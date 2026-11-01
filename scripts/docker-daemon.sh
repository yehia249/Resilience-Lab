#!/bin/sh
set -eu
# Dedicated project WSL distribution only; never run this on a shared production host.
printf '[network]\ngenerateResolvConf=false\n' > /etc/wsl.conf
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf
exec dockerd --log-level=warn
