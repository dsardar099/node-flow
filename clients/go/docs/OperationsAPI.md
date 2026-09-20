# \OperationsAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ExecutionBulk**](OperationsAPI.md#ExecutionBulk) | **Post** /v1/ns/{ns}/executions/bulk/{action} | Pause, resume, retry or terminate many executions
[**ExecutionDecide**](OperationsAPI.md#ExecutionDecide) | **Post** /v1/ns/{ns}/executions/{id}/decide | Force an evaluation — an escape hatch and a diagnostic
[**ExecutionPause**](OperationsAPI.md#ExecutionPause) | **Post** /v1/ns/{ns}/executions/{id}/pause | Stop scheduling new tasks
[**ExecutionRerun**](OperationsAPI.md#ExecutionRerun) | **Post** /v1/ns/{ns}/executions/{id}/rerun | Discard from a task onward and run again from there
[**ExecutionResume**](OperationsAPI.md#ExecutionResume) | **Post** /v1/ns/{ns}/executions/{id}/resume | Resume a paused execution
[**ExecutionRetry**](OperationsAPI.md#ExecutionRetry) | **Post** /v1/ns/{ns}/executions/{id}/retry | Re-run the failed tasks of a terminal execution
[**ExecutionSkipTask**](OperationsAPI.md#ExecutionSkipTask) | **Post** /v1/ns/{ns}/executions/{id}/skip-task | Skip a scheduled task without running it
[**ExecutionTerminate**](OperationsAPI.md#ExecutionTerminate) | **Post** /v1/ns/{ns}/executions/{id}/terminate | End an execution and release everything it holds
[**MetricsScrape**](OperationsAPI.md#MetricsScrape) | **Get** /v1/metrics | Prometheus exposition



## ExecutionBulk

> interface{} ExecutionBulk(ctx, ns, action).ExecutionBulkRequest(executionBulkRequest).Execute()

Pause, resume, retry or terminate many executions



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
	action := "action_example" // string | 
	executionBulkRequest := *openapiclient.NewExecutionBulkRequest([]string{"WorkflowIds_example"}) // ExecutionBulkRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OperationsAPI.ExecutionBulk(context.Background(), ns, action).ExecutionBulkRequest(executionBulkRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionBulk``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionBulk`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionBulk`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**action** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionBulkRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionBulkRequest** | [**ExecutionBulkRequest**](ExecutionBulkRequest.md) |  | 

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


## ExecutionDecide

> interface{} ExecutionDecide(ctx, ns, id).Execute()

Force an evaluation — an escape hatch and a diagnostic

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
	resp, r, err := apiClient.OperationsAPI.ExecutionDecide(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionDecide``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionDecide`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionDecide`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionDecideRequest struct via the builder pattern


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


## ExecutionPause

> interface{} ExecutionPause(ctx, ns, id).Execute()

Stop scheduling new tasks



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
	resp, r, err := apiClient.OperationsAPI.ExecutionPause(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionPause``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionPause`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionPause`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionPauseRequest struct via the builder pattern


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


## ExecutionRerun

> interface{} ExecutionRerun(ctx, ns, id).ExecutionRerunRequest(executionRerunRequest).Execute()

Discard from a task onward and run again from there



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
	executionRerunRequest := *openapiclient.NewExecutionRerunRequest("FromTaskRef_example") // ExecutionRerunRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OperationsAPI.ExecutionRerun(context.Background(), ns, id).ExecutionRerunRequest(executionRerunRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionRerun``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionRerun`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionRerun`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionRerunRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionRerunRequest** | [**ExecutionRerunRequest**](ExecutionRerunRequest.md) |  | 

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


## ExecutionResume

> interface{} ExecutionResume(ctx, ns, id).Execute()

Resume a paused execution

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
	resp, r, err := apiClient.OperationsAPI.ExecutionResume(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionResume``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionResume`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionResume`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionResumeRequest struct via the builder pattern


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


## ExecutionRetry

> interface{} ExecutionRetry(ctx, ns, id).Execute()

Re-run the failed tasks of a terminal execution



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
	resp, r, err := apiClient.OperationsAPI.ExecutionRetry(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionRetry``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionRetry`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionRetry`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionRetryRequest struct via the builder pattern


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


## ExecutionSkipTask

> interface{} ExecutionSkipTask(ctx, ns, id).ExecutionSkipTaskRequest(executionSkipTaskRequest).Execute()

Skip a scheduled task without running it

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
	executionSkipTaskRequest := *openapiclient.NewExecutionSkipTaskRequest("TaskRef_example") // ExecutionSkipTaskRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OperationsAPI.ExecutionSkipTask(context.Background(), ns, id).ExecutionSkipTaskRequest(executionSkipTaskRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionSkipTask``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionSkipTask`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionSkipTask`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionSkipTaskRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionSkipTaskRequest** | [**ExecutionSkipTaskRequest**](ExecutionSkipTaskRequest.md) |  | 

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


## ExecutionTerminate

> interface{} ExecutionTerminate(ctx, ns, id).ExecutionTerminateRequest(executionTerminateRequest).Execute()

End an execution and release everything it holds



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
	executionTerminateRequest := *openapiclient.NewExecutionTerminateRequest() // ExecutionTerminateRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OperationsAPI.ExecutionTerminate(context.Background(), ns, id).ExecutionTerminateRequest(executionTerminateRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.ExecutionTerminate``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecutionTerminate`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.ExecutionTerminate`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiExecutionTerminateRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **executionTerminateRequest** | [**ExecutionTerminateRequest**](ExecutionTerminateRequest.md) |  | 

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


## MetricsScrape

> interface{} MetricsScrape(ctx).Execute()

Prometheus exposition



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OperationsAPI.MetricsScrape(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OperationsAPI.MetricsScrape``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetricsScrape`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `OperationsAPI.MetricsScrape`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiMetricsScrapeRequest struct via the builder pattern


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

