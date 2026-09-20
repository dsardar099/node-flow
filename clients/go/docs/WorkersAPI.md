# \WorkersAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**QueueDepth**](WorkersAPI.md#QueueDepth) | **Get** /v1/ns/{ns}/queues/{queue}/depth | Queue depth — the real signal for autoscaling a worker fleet
[**QueueLease**](WorkersAPI.md#QueueLease) | **Post** /v1/ns/{ns}/queues/{queue}/lease | Lease a batch of tasks, optionally waiting for work to appear
[**QueueOverview**](WorkersAPI.md#QueueOverview) | **Get** /v1/ns/{ns}/queues | All queues currently holding work, with depth and lease holders
[**QueueWorkers**](WorkersAPI.md#QueueWorkers) | **Get** /v1/ns/{ns}/queues/workers | Workers seen polling in the last 24 hours, by queue
[**TaskAppendLogs**](WorkersAPI.md#TaskAppendLogs) | **Post** /v1/ns/{ns}/tasks/{taskId}/logs | Append log lines to a running task
[**TaskHeartbeat**](WorkersAPI.md#TaskHeartbeat) | **Post** /v1/ns/{ns}/tasks/{taskId}/heartbeat | Extend the lease on a long-running task
[**TaskReport**](WorkersAPI.md#TaskReport) | **Post** /v1/ns/{ns}/tasks/{taskId}/report | Report a terminal result



## QueueDepth

> interface{} QueueDepth(ctx, ns, queue).Execute()

Queue depth — the real signal for autoscaling a worker fleet

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
	queue := "queue_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.QueueDepth(context.Background(), ns, queue).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.QueueDepth``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `QueueDepth`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.QueueDepth`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**queue** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiQueueDepthRequest struct via the builder pattern


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


## QueueLease

> interface{} QueueLease(ctx, ns, queue).QueueLeaseRequest(queueLeaseRequest).Execute()

Lease a batch of tasks, optionally waiting for work to appear



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
	queue := "queue_example" // string | 
	queueLeaseRequest := *openapiclient.NewQueueLeaseRequest("WorkerId_example") // QueueLeaseRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.QueueLease(context.Background(), ns, queue).QueueLeaseRequest(queueLeaseRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.QueueLease``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `QueueLease`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.QueueLease`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**queue** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiQueueLeaseRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **queueLeaseRequest** | [**QueueLeaseRequest**](QueueLeaseRequest.md) |  | 

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


## QueueOverview

> interface{} QueueOverview(ctx, ns).Execute()

All queues currently holding work, with depth and lease holders

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.QueueOverview(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.QueueOverview``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `QueueOverview`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.QueueOverview`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiQueueOverviewRequest struct via the builder pattern


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


## QueueWorkers

> interface{} QueueWorkers(ctx, ns).Execute()

Workers seen polling in the last 24 hours, by queue

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.QueueWorkers(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.QueueWorkers``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `QueueWorkers`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.QueueWorkers`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiQueueWorkersRequest struct via the builder pattern


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


## TaskAppendLogs

> interface{} TaskAppendLogs(ctx, ns, taskId).TaskAppendLogsRequest(taskAppendLogsRequest).Execute()

Append log lines to a running task



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
	taskId := "taskId_example" // string | 
	taskAppendLogsRequest := *openapiclient.NewTaskAppendLogsRequest("WorkflowId_example", "LeaseToken_example", []openapiclient.TaskAppendLogsRequestLogsInner{*openapiclient.NewTaskAppendLogsRequestLogsInner("Message_example")}) // TaskAppendLogsRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.TaskAppendLogs(context.Background(), ns, taskId).TaskAppendLogsRequest(taskAppendLogsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.TaskAppendLogs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `TaskAppendLogs`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.TaskAppendLogs`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiTaskAppendLogsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **taskAppendLogsRequest** | [**TaskAppendLogsRequest**](TaskAppendLogsRequest.md) |  | 

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


## TaskHeartbeat

> interface{} TaskHeartbeat(ctx, ns, taskId).TaskHeartbeatRequest(taskHeartbeatRequest).Execute()

Extend the lease on a long-running task



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
	taskId := "taskId_example" // string | 
	taskHeartbeatRequest := *openapiclient.NewTaskHeartbeatRequest("QueueName_example", "LeaseToken_example") // TaskHeartbeatRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.TaskHeartbeat(context.Background(), ns, taskId).TaskHeartbeatRequest(taskHeartbeatRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.TaskHeartbeat``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `TaskHeartbeat`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.TaskHeartbeat`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiTaskHeartbeatRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **taskHeartbeatRequest** | [**TaskHeartbeatRequest**](TaskHeartbeatRequest.md) |  | 

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


## TaskReport

> interface{} TaskReport(ctx, ns, taskId).TaskReportRequest(taskReportRequest).Execute()

Report a terminal result



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
	taskId := "taskId_example" // string | 
	taskReportRequest := *openapiclient.NewTaskReportRequest("QueueName_example", "WorkflowId_example", "LeaseToken_example", "Status_example") // TaskReportRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.WorkersAPI.TaskReport(context.Background(), ns, taskId).TaskReportRequest(taskReportRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `WorkersAPI.TaskReport``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `TaskReport`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `WorkersAPI.TaskReport`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiTaskReportRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **taskReportRequest** | [**TaskReportRequest**](TaskReportRequest.md) |  | 

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

