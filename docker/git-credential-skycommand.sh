#!/bin/sh
set -eu

action="${1:-get}"

case "$action" in
  get)
    protocol=""
    host=""

    while IFS='=' read -r key value; do
      case "$key" in
        protocol) protocol="$value" ;;
        host) host="$value" ;;
      esac
    done

    expected_host="${SKYCOMMAND_GITHUB_HOST:-github.com}"
    token_file="${SKYCOMMAND_GITHUB_TOKEN_FILE:-/run/secrets/skycommand_github_token}"
    username="${SKYCOMMAND_GITHUB_USERNAME:-}"

    [ "$protocol" = "https" ] || exit 0
    [ "$host" = "$expected_host" ] || exit 0
    [ -n "$username" ] || exit 0
    [ -r "$token_file" ] || exit 0

    token="$(tr -d '\r\n' < "$token_file")"
    [ -n "$token" ] || exit 0

    printf 'username=%s\n' "$username"
    printf 'password=%s\n' "$token"
    ;;
  store|erase)
    # The token remains in the Docker secret mount. Never persist credentials
    # into the container filesystem or the mounted repositories.
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
