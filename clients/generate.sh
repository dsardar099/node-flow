#!/usr/bin/env bash
# Regenerates the API clients from a running server's OpenAPI document.
#
#   ./generate.sh [server-url] [languages...]
#   ./generate.sh http://localhost:3000 python go java typescript
#
# Needs Docker. The document is snapshotted to openapi.json first, so the clients
# and the contract they were built from are committed together.
set -euo pipefail
cd "$(dirname "$0")"

url="${1:-http://localhost:3000}"
shift || true
languages=("${@:-python go java typescript}")
[ $# -eq 0 ] && languages=(python go java typescript)
image="openapitools/openapi-generator-cli:v7.16.0"

curl -fsS "$url/v1/openapi.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s),null,2)+'\n'))" > openapi.json

for language in "${languages[@]}"; do
  case "$language" in
    python)     generator=python;            extra="--package-name node_flow_client --additional-properties=projectName=node-flow-client,packageVersion=0.1.0" ;;
    go)         generator=go;                extra="--git-user-id node-flow --git-repo-id node-flow-go --additional-properties=packageName=nodeflow,isGoSubmodule=true,generateInterfaces=false" ;;
    java)       generator=java;              extra="--additional-properties=groupId=dev.nodeflow,artifactId=node-flow-client,artifactVersion=0.1.0,invokerPackage=dev.nodeflow.client,apiPackage=dev.nodeflow.client.api,modelPackage=dev.nodeflow.client.model,hideGenerationTimestamp=true" ;;
    typescript) generator=typescript-fetch;  extra="--additional-properties=npmName=@node-flow/api-client,npmVersion=0.1.0,supportsES6=true" ;;
    *) echo "unknown language: $language" >&2; exit 1 ;;
  esac
  rm -rf "$language"
  # shellcheck disable=SC2086
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/local" "$image" generate -i /local/openapi.json -g "$generator" -o "/local/$language" $extra > "/tmp/node-flow-generate-$language.log" 2>&1 \
    || { cat "/tmp/node-flow-generate-$language.log" >&2; exit 1; }
  echo "generated $language"
done
