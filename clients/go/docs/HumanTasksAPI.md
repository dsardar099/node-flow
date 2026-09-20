# \HumanTasksAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**HumanTaskClaim**](HumanTasksAPI.md#HumanTaskClaim) | **Post** /v1/ns/{ns}/human-tasks/{id}/claim | Take possession of a human task
[**HumanTaskComplete**](HumanTasksAPI.md#HumanTaskComplete) | **Post** /v1/ns/{ns}/human-tasks/{id}/complete | Complete a human task and let the workflow continue
[**HumanTaskGet**](HumanTasksAPI.md#HumanTaskGet) | **Get** /v1/ns/{ns}/human-tasks/{id} | Fetch one human task
[**HumanTaskInbox**](HumanTasksAPI.md#HumanTaskInbox) | **Get** /v1/ns/{ns}/human-tasks | List the human tasks this user can act on
[**HumanTaskReassign**](HumanTasksAPI.md#HumanTaskReassign) | **Post** /v1/ns/{ns}/human-tasks/{id}/reassign | Replace who a human task is assigned to
[**HumanTaskRelease**](HumanTasksAPI.md#HumanTaskRelease) | **Post** /v1/ns/{ns}/human-tasks/{id}/release | Give a claimed task back to the pool
[**HumanTaskSearch**](HumanTasksAPI.md#HumanTaskSearch) | **Get** /v1/ns/{ns}/human-tasks/search | Search every human task in the namespace
[**HumanTaskSkip**](HumanTasksAPI.md#HumanTaskSkip) | **Post** /v1/ns/{ns}/human-tasks/{id}/skip | Skip a human task



## HumanTaskClaim

> interface{} HumanTaskClaim(ctx, ns, id).Execute()

Take possession of a human task



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskClaim(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskClaim``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskClaim`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskClaim`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskClaimRequest struct via the builder pattern


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


## HumanTaskComplete

> interface{} HumanTaskComplete(ctx, ns, id).Execute()

Complete a human task and let the workflow continue



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskComplete(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskComplete``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskComplete`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskComplete`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskCompleteRequest struct via the builder pattern


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


## HumanTaskGet

> interface{} HumanTaskGet(ctx, ns, id).Execute()

Fetch one human task

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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskGet(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskGet``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskGet`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskGetRequest struct via the builder pattern


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


## HumanTaskInbox

> interface{} HumanTaskInbox(ctx, ns).Execute()

List the human tasks this user can act on



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskInbox(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskInbox``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskInbox`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskInbox`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskInboxRequest struct via the builder pattern


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


## HumanTaskReassign

> interface{} HumanTaskReassign(ctx, ns, id).Execute()

Replace who a human task is assigned to



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskReassign(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskReassign``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskReassign`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskReassign`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskReassignRequest struct via the builder pattern


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


## HumanTaskRelease

> interface{} HumanTaskRelease(ctx, ns, id).Execute()

Give a claimed task back to the pool



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskRelease(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskRelease``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskRelease`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskRelease`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskReleaseRequest struct via the builder pattern


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


## HumanTaskSearch

> interface{} HumanTaskSearch(ctx, ns).Execute()

Search every human task in the namespace



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskSearch(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskSearch``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskSearch`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskSearch`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskSearchRequest struct via the builder pattern


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


## HumanTaskSkip

> interface{} HumanTaskSkip(ctx, ns, id).Execute()

Skip a human task



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
	resp, r, err := apiClient.HumanTasksAPI.HumanTaskSkip(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `HumanTasksAPI.HumanTaskSkip``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `HumanTaskSkip`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `HumanTasksAPI.HumanTaskSkip`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiHumanTaskSkipRequest struct via the builder pattern


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

