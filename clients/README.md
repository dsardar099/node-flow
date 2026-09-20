# node-flow API clients

Generated from the server's OpenAPI 3.1 document (`openapi.json`, committed next to them) with
[OpenAPI Generator](https://openapi-generator.tech) 7.16.

| Language   | Directory     | Package                        |
|------------|---------------|--------------------------------|
| Python     | `python/`     | `node_flow_client`             |
| Go         | `go/`         | `github.com/node-flow/node-flow-go/nodeflow` |
| Java       | `java/`       | `dev.nodeflow:node-flow-client` |
| TypeScript | `typescript/` | `@node-flow-dev/api-client` (fetch) |

Operations are grouped by area (`ExecutionsApi`, `MetadataApi`, `AiApi`, …) and named after the
server's own handlers, so `POST /v1/ns/{ns}/executions/{name}/execute` is `execution_execute`
(Python), `ExecutionExecute` (Go) and `executionExecute` (Java, TypeScript).

Authenticate with an API key, sent as `X-API-Key`:

```python
import node_flow_client as nf

config = nf.Configuration(host="http://localhost:3000")
config.api_key["apiKey"] = "nf_..."
with nf.ApiClient(config) as client:
    run = nf.ExecutionsApi(client).execution_execute(
        "default", "checkout", nf.ExecutionExecuteRequest(input={"orderId": "A-1"}, wait_for_seconds=10)
    )
    print(run["status"], run["output"])
```

```go
cfg := nodeflow.NewConfiguration()
cfg.Servers = nodeflow.ServerConfigurations{{URL: "http://localhost:3000"}}
client := nodeflow.NewAPIClient(cfg)
ctx := context.WithValue(context.Background(), nodeflow.ContextAPIKeys,
	map[string]nodeflow.APIKey{"apiKey": {Key: os.Getenv("NF_API_KEY")}})
run, _, err := client.ExecutionsAPI.ExecutionExecute(ctx, "default", "checkout").
	ExecutionExecuteRequest(nodeflow.ExecutionExecuteRequest{Input: map[string]interface{}{"orderId": "A-1"}}).Execute()
```

## Regenerating

With a server running:

```sh
./generate.sh http://localhost:3000              # all four
./generate.sh http://localhost:3000 python go    # some
```

Worker fleets written in TypeScript should use `@node-flow-dev/sdk`, which adds leasing, heartbeats and
retries on top of the API; these clients are the API itself.
