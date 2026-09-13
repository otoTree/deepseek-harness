#!/bin/sh
# Protocol fixture: exercises process groups without launching a Harness application.
trap '' TERM
printf '%s' "$DSH_HOME" > home.txt
printf '%s\n' "$@" > argv.txt
env > env.txt
printf '%s\n' 'dsh web: http://127.0.0.1:4567/?token=test-token'
/bin/sh -c 'trap "" TERM; echo $$ > child.pid; while :; do sleep 1; done' &
echo $$ > parent.pid
while :; do sleep 1; done
