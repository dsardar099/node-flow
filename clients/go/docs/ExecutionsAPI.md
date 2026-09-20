# \ExecutionsAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ExecutionByCorrelation**](ExecutionsAPI.md#ExecutionByCorrelation) | **Get** /v1/ns/{ns}/executions/by-correlation/{correlationId} | Find executions by correlation id
[**ExecutionExecute**](ExecutionsAPI.md#ExecutionExecute) | **Post** /v1/ns/{ns}/executions/{name}/execute | Start a workflow and wait for its result
[**ExecutionGet**](ExecutionsAPI.md#ExecutionGet) | **Get** /v1/ns/{ns}/executions/{id} | Full execution, including tasks and resolved payloads
[**ExecutionHistory**](ExecutionsAPI.md#ExecutionHistory) | **Get** /v1/ns/{ns}/executions/{id}/history | Ordered execution history
[**ExecutionListMessages**](ExecutionsAPI.md#ExecutionListMessages) | **Get** /v1/ns/{ns}/executions/{id}/messages | Messages pushed into an execution
[**ExecutionOverview**](ExecutionsAPI.md#ExecutionOverview) | **Get** /v1/ns/{ns}/executions/overview | Execution overview for a recent window
[**ExecutionPushMessage**](ExecutionsAPI.md#ExecutionPushMessage) | **Post** /v1/ns/{ns}/executions/{id}/messages | Push a message into a running execution
[**ExecutionReplay**](ExecutionsAPI.md#ExecutionReplay) | **Post** /v1/ns/{ns}/executions/{id}/replay | Replay an execution against a definition version
[**ExecutionRunAgain**](ExecutionsAPI.md#ExecutionRunAgain) | **Post** /v1/ns/{ns}/executions/{id}/run-again | Start a new execution with the same input
[**ExecutionSearchExecutions**](ExecutionsAPI.md#ExecutionSearchExecutions) | **Post** /v1/ns/{ns}/executions/search | Search executions, newest first
[**ExecutionSignal**](ExecutionsAPI.md#ExecutionSignal) | **Post** /v1/ns/{ns}/executions/{id}/signal | Resume the WAIT or YIELD task a workflow is blocked on
[**ExecutionStart**](ExecutionsAPI.md#ExecutionStart) | **Post** /v1/ns/{ns}/executions/{name} | Start a workflow execution
[**ExecutionStatus**](ExecutionsAPI.md#ExecutionStatus) | **Get** /v1/ns/{ns}/executions/{id}/status | Lightweight status, with no payloads resolved
[**ExecutionTaskLogs**](ExecutionsAPI.md#ExecutionTaskLogs) | **Get** /v1/ns/{ns}/executions/{id}/tasks/{taskId}/logs | Log lines written by the worker that ran a task
[**RealtimeStream**](ExecutionsAPI.md#RealtimeStream) | **Get** /v1/ns/{ns}/executions/{id}/stream | Live event stream for one execution (SSE)



## ExecutionByCorrelation

> interface{} ExecutionByCorrelation(ctx, ns, correlationId).Execute()

Find executions by correlation id

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	correlationId := "correlationId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionByCorrelation(context.Background(), ns, correlationId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionByCorrelation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionByCorrelation`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionByCorrelation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**correlationId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionByCorrelationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionExecute

> interface{} ExecutionExecute(ctx, ns, name).ExecutionExecuteRequest(executionExecuteRequest).Execute()

Start a workflow and wait for its result



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	name := "name_example" // string | 
	executionExecuteRequest := *openapiclient.NewExecutionExecuteRequest() // ExecutionExecuteRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionExecute(context.Background(), ns, name).ExecutionExecuteRequest(executionExecuteRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionExecute``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionExecute`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionExecute`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionExecuteRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionExecuteRequest** | [**ExecutionExecuteRequest**](ExecutionExecuteRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionGet

> interface{} ExecutionGet(ctx, ns, id).Execute()

Full execution, including tasks and resolved payloads

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionGet(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionGet``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionGet`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionGetRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionHistory

> interface{} ExecutionHistory(ctx, ns, id).Execute()

Ordered execution history



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionHistory(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionHistory``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionHistory`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionHistory`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionHistoryRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionListMessages

> interface{} ExecutionListMessages(ctx, ns, id).Execute()

Messages pushed into an execution

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionListMessages(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionListMessages``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionListMessages`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionListMessages`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionListMessagesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionOverview

> interface{} ExecutionOverview(ctx, ns).Hours(hours).Execute()

Execution overview for a recent window

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	hours := int32(56) // int32 |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionOverview(context.Background(), ns).Hours(hours).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionOverview``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionOverview`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionOverview`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionOverviewRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **hours** | **int32** |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionPushMessage

> interface{} ExecutionPushMessage(ctx, ns, id).ExecutionPushMessageRequest(executionPushMessageRequest).Execute()

Push a message into a running execution

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 
	executionPushMessageRequest := *openapiclient.NewExecutionPushMessageRequest(map[string]interface{}{"key": interface{}(123)}) // ExecutionPushMessageRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionPushMessage(context.Background(), ns, id).ExecutionPushMessageRequest(executionPushMessageRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionPushMessage``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionPushMessage`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionPushMessage`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionPushMessageRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionPushMessageRequest** | [**ExecutionPushMessageRequest**](ExecutionPushMessageRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionReplay

> interface{} ExecutionReplay(ctx, ns, id).ExecutionReplayRequest(executionReplayRequest).Execute()

Replay an execution against a definition version

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 
	executionReplayRequest := *openapiclient.NewExecutionReplayRequest() // ExecutionReplayRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionReplay(context.Background(), ns, id).ExecutionReplayRequest(executionReplayRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionReplay``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionReplay`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionReplay`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionReplayRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionReplayRequest** | [**ExecutionReplayRequest**](ExecutionReplayRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionRunAgain

> interface{} ExecutionRunAgain(ctx, ns, id).Execute()

Start a new execution with the same input

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionRunAgain(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionRunAgain``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionRunAgain`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionRunAgain`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionRunAgainRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionSearchExecutions

> interface{} ExecutionSearchExecutions(ctx, ns).ExecutionSearchExecutionsRequest(executionSearchExecutionsRequest).Execute()

Search executions, newest first



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	executionSearchExecutionsRequest := *openapiclient.NewExecutionSearchExecutionsRequest() // ExecutionSearchExecutionsRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionSearchExecutions(context.Background(), ns).ExecutionSearchExecutionsRequest(executionSearchExecutionsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionSearchExecutions``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionSearchExecutions`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionSearchExecutions`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionSearchExecutionsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **executionSearchExecutionsRequest** | [**ExecutionSearchExecutionsRequest**](ExecutionSearchExecutionsRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionSignal

> interface{} ExecutionSignal(ctx, ns, id).ExecutionSignalRequest(executionSignalRequest).Execute()

Resume the WAIT or YIELD task a workflow is blocked on



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 
	executionSignalRequest := *openapiclient.NewExecutionSignalRequest() // ExecutionSignalRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionSignal(context.Background(), ns, id).ExecutionSignalRequest(executionSignalRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionSignal``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionSignal`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionSignal`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionSignalRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionSignalRequest** | [**ExecutionSignalRequest**](ExecutionSignalRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionStart

> interface{} ExecutionStart(ctx, ns, name).ExecutionStartRequest(executionStartRequest).Execute()

Start a workflow execution



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	name := "name_example" // string | 
	executionStartRequest := *openapiclient.NewExecutionStartRequest() // ExecutionStartRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionStart(context.Background(), ns, name).ExecutionStartRequest(executionStartRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionStart``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionStart`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionStart`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionStartRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionStartRequest** | [**ExecutionStartRequest**](ExecutionStartRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionStatus

> interface{} ExecutionStatus(ctx, ns, id).Execute()

Lightweight status, with no payloads resolved

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionStatus(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionStatus``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionStatus`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionStatus`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionStatusRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecutionTaskLogs

> interface{} ExecutionTaskLogs(ctx, ns, id, taskId).After(after).Limit(limit).Execute()

Log lines written by the worker that ran a task

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 
	taskId := "taskId_example" // string | 
	after := int32(56) // int32 |  (optional)
	limit := int32(56) // int32 |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.ExecutionTaskLogs(context.Background(), ns, id, taskId).After(after).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.ExecutionTaskLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionTaskLogs`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.ExecutionTaskLogs`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionTaskLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



 **after** | **int32** |  | 
 **limit** | **int32** |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RealtimeStream

> interface{} RealtimeStream(ctx, ns, id).Execute()

Live event stream for one execution (SSE)



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ExecutionsAPI.RealtimeStream(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ExecutionsAPI.RealtimeStream``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RealtimeStream`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ExecutionsAPI.RealtimeStream`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRealtimeStreamRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

