#!/bin/sh
# Creates a self-signed code-signing identity for T3 Code Fork, so every build
# gets the same designated requirement and macOS stops asking again for the
# keychain item and privacy permissions after each rebuild. Opt-in: run it once
# by hand. It does nothing when the identity already exists.
#
# The identity lives in its own keychain, ~/.t3-fork/signing, with a random
# password kept beside it. It never touches the login keychain or the keychain
# search list, and needs no admin rights or trust setting: codesign signs with
# an untrusted self-signed certificate, and a locally built app never meets
# Gatekeeper. scripts/fork/release-desktop.sh uses it when present.
#
# To go back to ad-hoc signing, delete ~/.t3-fork/signing.
set -eu

signing_dir="$HOME/.t3-fork/signing"
identity="T3 Code Fork Local Signing"
keychain="$signing_dir/signing.keychain-db"
password_file="$signing_dir/keychain-password"

if [ -f "$password_file" ] && [ -f "$keychain" ]; then
  echo "The signing identity already exists in $keychain."
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
mkdir -p "$signing_dir"
rm -f "$keychain" "$password_file"

cat >"$work/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $identity
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$work/cert.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
  -out "$work/identity.p12" -passout pass:import

password=$(/usr/bin/openssl rand -hex 24)
security create-keychain -p "$password" "$keychain"
security set-keychain-settings "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$work/identity.p12" -k "$keychain" -P import -T /usr/bin/codesign >/dev/null
# Lets codesign use the key without a keychain access prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" \
  >/dev/null
security find-identity -p codesigning "$keychain" | grep -qF "\"$identity\"" || {
  rm -f "$keychain"
  echo "Could not create the signing identity." >&2
  exit 1
}
printf '%s\n' "$password" >"$password_file"
echo "Created \"$identity\" in $keychain. The next release build signs with it."
