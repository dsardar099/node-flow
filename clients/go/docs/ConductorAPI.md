# \ConductorAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ConductorCorrelated**](ConductorAPI.md#ConductorCorrelated) | **Get** /conductor/api/workflow/{name}/correlated/{correlationId} | Executions by correlation id (Conductor)
[**ConductorCreateTaskDefs**](ConductorAPI.md#ConductorCreateTaskDefs) | **Post** /conductor/api/metadata/taskdefs | Create task definitions (Conductor)
[**ConductorDeleteWorkflow**](ConductorAPI.md#ConductorDeleteWorkflow) | **Delete** /conductor/api/metadata/workflow/{name}/{version} | Delete a workflow version (Conductor)
[**ConductorExecuteWorkflow**](ConductorAPI.md#ConductorExecuteWorkflow) | **Post** /conductor/api/workflow/execute/{name} | Start a workflow and wait (Conductor)
[**ConductorExecuteWorkflow2**](ConductorAPI.md#ConductorExecuteWorkflow2) | **Post** /conductor/api/workflow/execute/{name}/{version} | Start a workflow and wait (Conductor)
[**ConductorGetTask**](ConductorAPI.md#ConductorGetTask) | **Get** /conductor/api/tasks/{taskId} | Fetch a task (Conductor)
[**ConductorGetTaskDef**](ConductorAPI.md#ConductorGetTaskDef) | **Get** /conductor/api/metadata/taskdefs/{name} | Fetch a task definition (Conductor)
[**ConductorGetWorkflow**](ConductorAPI.md#ConductorGetWorkflow) | **Get** /conductor/api/metadata/workflow/{name} | Fetch a workflow definition (Conductor)
[**ConductorGetWorkflowRun**](ConductorAPI.md#ConductorGetWorkflowRun) | **Get** /conductor/api/workflow/{workflowId} | Fetch an execution (Conductor)
[**ConductorListTaskDefs**](ConductorAPI.md#ConductorListTaskDefs) | **Get** /conductor/api/metadata/taskdefs | List task definitions (Conductor)
[**ConductorListWorkflows**](ConductorAPI.md#ConductorListWorkflows) | **Get** /conductor/api/metadata/workflow | List workflow definitions (Conductor)
[**ConductorLog**](ConductorAPI.md#ConductorLog) | **Post** /conductor/api/tasks/{taskId}/log | Append a log line to a task (Conductor)
[**ConductorPause**](ConductorAPI.md#ConductorPause) | **Put** /conductor/api/workflow/{workflowId}/pause | Pause an execution (Conductor)
[**ConductorPoll**](ConductorAPI.md#ConductorPoll) | **Get** /conductor/api/tasks/poll/{taskType} | Poll for one task (Conductor)
[**ConductorPollBatch**](ConductorAPI.md#ConductorPollBatch) | **Get** /conductor/api/tasks/poll/batch/{taskType} | Poll for a batch of tasks (Conductor)
[**ConductorQueueSizes**](ConductorAPI.md#ConductorQueueSizes) | **Get** /conductor/api/tasks/queue/sizes | Queue depths by task type (Conductor)
[**ConductorRegisterWorkflow**](ConductorAPI.md#ConductorRegisterWorkflow) | **Post** /conductor/api/metadata/workflow | Register a workflow definition (Conductor)
[**ConductorRegisterWorkflows**](ConductorAPI.md#ConductorRegisterWorkflows) | **Put** /conductor/api/metadata/workflow | Register workflow definitions in bulk (Conductor)
[**ConductorRerun**](ConductorAPI.md#ConductorRerun) | **Post** /conductor/api/workflow/{workflowId}/rerun | Re-run an execution from a task (Conductor)
[**ConductorRestart**](ConductorAPI.md#ConductorRestart) | **Post** /conductor/api/workflow/{workflowId}/restart | Restart an execution (Conductor)
[**ConductorResume**](ConductorAPI.md#ConductorResume) | **Put** /conductor/api/workflow/{workflowId}/resume | Resume an execution (Conductor)
[**ConductorRetry**](ConductorAPI.md#ConductorRetry) | **Post** /conductor/api/workflow/{workflowId}/retry | Retry the failed tasks of an execution (Conductor)
[**ConductorSearch**](ConductorAPI.md#ConductorSearch) | **Get** /conductor/api/workflow/search | Search executions (Conductor)
[**ConductorStartNamed**](ConductorAPI.md#ConductorStartNamed) | **Post** /conductor/api/workflow/{name} | Start a workflow by name (Conductor)
[**ConductorStartWorkflow**](ConductorAPI.md#ConductorStartWorkflow) | **Post** /conductor/api/workflow | Start a workflow (Conductor)
[**ConductorTerminate**](ConductorAPI.md#ConductorTerminate) | **Delete** /conductor/api/workflow/{workflowId} | Terminate an execution (Conductor)
[**ConductorToken**](ConductorAPI.md#ConductorToken) | **Post** /conductor/api/token | Conductor-compatible token exchange
[**ConductorUpdateByRef**](ConductorAPI.md#ConductorUpdateByRef) | **Post** /conductor/api/tasks/{workflowId}/{taskRefName}/{status} | Report a task result by reference (Conductor)
[**ConductorUpdateTask**](ConductorAPI.md#ConductorUpdateTask) | **Post** /conductor/api/tasks | Report a task result (Conductor)
[**ConductorUpdateTaskDef**](ConductorAPI.md#ConductorUpdateTaskDef) | **Put** /conductor/api/metadata/taskdefs | Update a task definition (Conductor)



## ConductorCorrelated

> interface{} ConductorCorrelated(ctx, name, correlationId).Execute()

Executions by correlation id (Conductor)

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
	name := "name_example" // string | 
	correlationId := "correlationId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorCorrelated(context.Background(), name, correlationId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorCorrelated``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorCorrelated`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorCorrelated`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 
**correlationId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorCorrelatedRequest struct via the builder pattern


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


## ConductorCreateTaskDefs

> interface{} ConductorCreateTaskDefs(ctx).Execute()

Create task definitions (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorCreateTaskDefs(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorCreateTaskDefs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorCreateTaskDefs`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorCreateTaskDefs`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorCreateTaskDefsRequest struct via the builder pattern


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


## ConductorDeleteWorkflow

> interface{} ConductorDeleteWorkflow(ctx, name, version).Execute()

Delete a workflow version (Conductor)

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
	name := "name_example" // string | 
	version := "version_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorDeleteWorkflow(context.Background(), name, version).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorDeleteWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorDeleteWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorDeleteWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 
**version** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorDeleteWorkflowRequest struct via the builder pattern


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


## ConductorExecuteWorkflow

> interface{} ConductorExecuteWorkflow(ctx, name).Execute()

Start a workflow and wait (Conductor)

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
	name := "name_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorExecuteWorkflow(context.Background(), name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorExecuteWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorExecuteWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorExecuteWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorExecuteWorkflowRequest struct via the builder pattern


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


## ConductorExecuteWorkflow2

> interface{} ConductorExecuteWorkflow2(ctx, name, version).Execute()

Start a workflow and wait (Conductor)

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
	name := "name_example" // string | 
	version := "version_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorExecuteWorkflow2(context.Background(), name, version).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorExecuteWorkflow2``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorExecuteWorkflow2`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorExecuteWorkflow2`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 
**version** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorExecuteWorkflow2Request struct via the builder pattern


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


## ConductorGetTask

> interface{} ConductorGetTask(ctx, taskId).Execute()

Fetch a task (Conductor)

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
	taskId := "taskId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorGetTask(context.Background(), taskId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorGetTask``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorGetTask`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorGetTask`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorGetTaskRequest struct via the builder pattern


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


## ConductorGetTaskDef

> interface{} ConductorGetTaskDef(ctx, name).Execute()

Fetch a task definition (Conductor)

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
	name := "name_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorGetTaskDef(context.Background(), name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorGetTaskDef``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorGetTaskDef`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorGetTaskDef`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorGetTaskDefRequest struct via the builder pattern


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


## ConductorGetWorkflow

> interface{} ConductorGetWorkflow(ctx, name).Execute()

Fetch a workflow definition (Conductor)

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
	name := "name_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorGetWorkflow(context.Background(), name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorGetWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorGetWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorGetWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorGetWorkflowRequest struct via the builder pattern


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


## ConductorGetWorkflowRun

> interface{} ConductorGetWorkflowRun(ctx, workflowId).Execute()

Fetch an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorGetWorkflowRun(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorGetWorkflowRun``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorGetWorkflowRun`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorGetWorkflowRun`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorGetWorkflowRunRequest struct via the builder pattern


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


## ConductorListTaskDefs

> interface{} ConductorListTaskDefs(ctx).Execute()

List task definitions (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorListTaskDefs(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorListTaskDefs``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorListTaskDefs`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorListTaskDefs`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorListTaskDefsRequest struct via the builder pattern


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


## ConductorListWorkflows

> interface{} ConductorListWorkflows(ctx).Execute()

List workflow definitions (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorListWorkflows(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorListWorkflows``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorListWorkflows`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorListWorkflows`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorListWorkflowsRequest struct via the builder pattern


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


## ConductorLog

> interface{} ConductorLog(ctx, taskId).Execute()

Append a log line to a task (Conductor)

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
	taskId := "taskId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorLog(context.Background(), taskId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorLog``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorLog`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorLog`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**taskId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorLogRequest struct via the builder pattern


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


## ConductorPause

> interface{} ConductorPause(ctx, workflowId).Execute()

Pause an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorPause(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorPause``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorPause`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorPause`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorPauseRequest struct via the builder pattern


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


## ConductorPoll

> interface{} ConductorPoll(ctx, taskType).Execute()

Poll for one task (Conductor)

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
	taskType := "taskType_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorPoll(context.Background(), taskType).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorPoll``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorPoll`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorPoll`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**taskType** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorPollRequest struct via the builder pattern


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


## ConductorPollBatch

> interface{} ConductorPollBatch(ctx, taskType).Execute()

Poll for a batch of tasks (Conductor)

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
	taskType := "taskType_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorPollBatch(context.Background(), taskType).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorPollBatch``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorPollBatch`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorPollBatch`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**taskType** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorPollBatchRequest struct via the builder pattern


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


## ConductorQueueSizes

> interface{} ConductorQueueSizes(ctx).Execute()

Queue depths by task type (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorQueueSizes(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorQueueSizes``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorQueueSizes`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorQueueSizes`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorQueueSizesRequest struct via the builder pattern


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


## ConductorRegisterWorkflow

> interface{} ConductorRegisterWorkflow(ctx).Execute()

Register a workflow definition (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorRegisterWorkflow(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorRegisterWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorRegisterWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorRegisterWorkflow`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorRegisterWorkflowRequest struct via the builder pattern


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


## ConductorRegisterWorkflows

> interface{} ConductorRegisterWorkflows(ctx).Execute()

Register workflow definitions in bulk (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorRegisterWorkflows(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorRegisterWorkflows``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorRegisterWorkflows`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorRegisterWorkflows`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorRegisterWorkflowsRequest struct via the builder pattern


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


## ConductorRerun

> interface{} ConductorRerun(ctx, workflowId).Execute()

Re-run an execution from a task (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorRerun(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorRerun``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorRerun`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorRerun`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorRerunRequest struct via the builder pattern


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


## ConductorRestart

> interface{} ConductorRestart(ctx, workflowId).Execute()

Restart an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorRestart(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorRestart``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorRestart`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorRestart`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorRestartRequest struct via the builder pattern


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


## ConductorResume

> interface{} ConductorResume(ctx, workflowId).Execute()

Resume an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorResume(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorResume``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorResume`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorResume`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorResumeRequest struct via the builder pattern


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


## ConductorRetry

> interface{} ConductorRetry(ctx, workflowId).Execute()

Retry the failed tasks of an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorRetry(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorRetry``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorRetry`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorRetry`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorRetryRequest struct via the builder pattern


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


## ConductorSearch

> interface{} ConductorSearch(ctx).Execute()

Search executions (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorSearch(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorSearch``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorSearch`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorSearch`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorSearchRequest struct via the builder pattern


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


## ConductorStartNamed

> interface{} ConductorStartNamed(ctx, name).Execute()

Start a workflow by name (Conductor)

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
	name := "name_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorStartNamed(context.Background(), name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorStartNamed``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorStartNamed`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorStartNamed`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorStartNamedRequest struct via the builder pattern


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


## ConductorStartWorkflow

> interface{} ConductorStartWorkflow(ctx).ConductorStartWorkflowRequest(conductorStartWorkflowRequest).Execute()

Start a workflow (Conductor)

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
	conductorStartWorkflowRequest := *openapiclient.NewConductorStartWorkflowRequest("Name_example") // ConductorStartWorkflowRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorStartWorkflow(context.Background()).ConductorStartWorkflowRequest(conductorStartWorkflowRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorStartWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorStartWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorStartWorkflow`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiConductorStartWorkflowRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductorStartWorkflowRequest** | [**ConductorStartWorkflowRequest**](ConductorStartWorkflowRequest.md) |  | 

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


## ConductorTerminate

> interface{} ConductorTerminate(ctx, workflowId).Execute()

Terminate an execution (Conductor)

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
	workflowId := "workflowId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorTerminate(context.Background(), workflowId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorTerminate``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorTerminate`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorTerminate`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorTerminateRequest struct via the builder pattern


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


## ConductorToken

> interface{} ConductorToken(ctx).ConductorTokenRequest(conductorTokenRequest).Execute()

Conductor-compatible token exchange

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
	conductorTokenRequest := *openapiclient.NewConductorTokenRequest("KeyId_example", "KeySecret_example") // ConductorTokenRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorToken(context.Background()).ConductorTokenRequest(conductorTokenRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorToken``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorToken`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorToken`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiConductorTokenRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductorTokenRequest** | [**ConductorTokenRequest**](ConductorTokenRequest.md) |  | 

### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ConductorUpdateByRef

> interface{} ConductorUpdateByRef(ctx, workflowId, taskRefName, status).Execute()

Report a task result by reference (Conductor)

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
	workflowId := "workflowId_example" // string | 
	taskRefName := "taskRefName_example" // string | 
	status := "status_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorUpdateByRef(context.Background(), workflowId, taskRefName, status).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorUpdateByRef``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorUpdateByRef`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorUpdateByRef`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**workflowId** | **string** |  | 
**taskRefName** | **string** |  | 
**status** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiConductorUpdateByRefRequest struct via the builder pattern


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


## ConductorUpdateTask

> interface{} ConductorUpdateTask(ctx).ConductorUpdateTaskRequest(conductorUpdateTaskRequest).Execute()

Report a task result (Conductor)

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
	conductorUpdateTaskRequest := *openapiclient.NewConductorUpdateTaskRequest("WorkflowInstanceId_example", "TaskId_example", "Status_example") // ConductorUpdateTaskRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ConductorAPI.ConductorUpdateTask(context.Background()).ConductorUpdateTaskRequest(conductorUpdateTaskRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorUpdateTask``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorUpdateTask`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorUpdateTask`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiConductorUpdateTaskRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductorUpdateTaskRequest** | [**ConductorUpdateTaskRequest**](ConductorUpdateTaskRequest.md) |  | 

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


## ConductorUpdateTaskDef

> interface{} ConductorUpdateTaskDef(ctx).Execute()

Update a task definition (Conductor)

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
	resp, r, err := apiClient.ConductorAPI.ConductorUpdateTaskDef(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ConductorAPI.ConductorUpdateTaskDef``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ConductorUpdateTaskDef`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `ConductorAPI.ConductorUpdateTaskDef`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiConductorUpdateTaskDefRequest struct via the builder pattern


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

