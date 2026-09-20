# \EventsAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**EventHandlerActivity**](EventsAPI.md#EventHandlerActivity) | **Get** /v1/ns/{ns}/event-handlers/activity | Event handler activity
[**EventHandlerCreate**](EventsAPI.md#EventHandlerCreate) | **Post** /v1/ns/{ns}/event-handlers | Create an inbound event handler
[**EventHandlerDisable**](EventsAPI.md#EventHandlerDisable) | **Post** /v1/ns/{ns}/event-handlers/{name}/disable | Disable an event handler
[**EventHandlerEnable**](EventsAPI.md#EventHandlerEnable) | **Post** /v1/ns/{ns}/event-handlers/{name}/enable | Enable an event handler
[**EventHandlerExecutions**](EventsAPI.md#EventHandlerExecutions) | **Get** /v1/ns/{ns}/event-handlers/executions | Event executions — the event monitor
[**EventHandlerGet**](EventsAPI.md#EventHandlerGet) | **Get** /v1/ns/{ns}/event-handlers/{name} | Fetch one event handler
[**EventHandlerList**](EventsAPI.md#EventHandlerList) | **Get** /v1/ns/{ns}/event-handlers | List event handlers
[**EventHandlerRemove**](EventsAPI.md#EventHandlerRemove) | **Delete** /v1/ns/{ns}/event-handlers/{name} | Delete an event handler
[**EventHandlerSources**](EventsAPI.md#EventHandlerSources) | **Get** /v1/ns/{ns}/event-handlers/sources | List configured event sources
[**EventHandlerTest**](EventsAPI.md#EventHandlerTest) | **Post** /v1/ns/{ns}/event-handlers/{name}/test | Send a test message to an event handler
[**EventHandlerUpdate**](EventsAPI.md#EventHandlerUpdate) | **Put** /v1/ns/{ns}/event-handlers/{name} | Update an event handler



## EventHandlerActivity

> interface{} EventHandlerActivity(ctx, ns).Hours(hours).Execute()

Event handler activity

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
	resp, r, err := apiClient.EventsAPI.EventHandlerActivity(context.Background(), ns).Hours(hours).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerActivity``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerActivity`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerActivity`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerActivityRequest struct via the builder pattern


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


## EventHandlerCreate

> interface{} EventHandlerCreate(ctx, ns).Execute()

Create an inbound event handler



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
	resp, r, err := apiClient.EventsAPI.EventHandlerCreate(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerCreate``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerCreate`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerCreate`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerCreateRequest struct via the builder pattern


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


## EventHandlerDisable

> interface{} EventHandlerDisable(ctx, ns, name).Execute()

Disable an event handler

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerDisable(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerDisable``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerDisable`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerDisable`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerDisableRequest struct via the builder pattern


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


## EventHandlerEnable

> interface{} EventHandlerEnable(ctx, ns, name).Execute()

Enable an event handler



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerEnable(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerEnable``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerEnable`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerEnable`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerEnableRequest struct via the builder pattern


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


## EventHandlerExecutions

> interface{} EventHandlerExecutions(ctx, ns).Handler(handler).Outcome(outcome).Before(before).Limit(limit).Execute()

Event executions — the event monitor

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
	handler := "handler_example" // string |  (optional)
	outcome := "outcome_example" // string |  (optional)
	before := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	limit := int32(56) // int32 |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerExecutions(context.Background(), ns).Handler(handler).Outcome(outcome).Before(before).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerExecutions``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerExecutions`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerExecutions`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerExecutionsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **handler** | **string** |  | 
 **outcome** | **string** |  | 
 **before** | **string** |  | 
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


## EventHandlerGet

> interface{} EventHandlerGet(ctx, ns, name).Execute()

Fetch one event handler

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerGet(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerGet``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerGet`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerGetRequest struct via the builder pattern


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


## EventHandlerList

> interface{} EventHandlerList(ctx, ns).Execute()

List event handlers

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
	resp, r, err := apiClient.EventsAPI.EventHandlerList(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerList``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerList`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerList`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerListRequest struct via the builder pattern


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


## EventHandlerRemove

> EventHandlerRemove(ctx, ns, name).Execute()

Delete an event handler

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.EventsAPI.EventHandlerRemove(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerRemove``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerRemoveRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## EventHandlerSources

> interface{} EventHandlerSources(ctx, ns).Execute()

List configured event sources

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
	resp, r, err := apiClient.EventsAPI.EventHandlerSources(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerSources``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerSources`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerSources`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerSourcesRequest struct via the builder pattern


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


## EventHandlerTest

> interface{} EventHandlerTest(ctx, ns, name).EventHandlerTestRequest(eventHandlerTestRequest).Execute()

Send a test message to an event handler

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
	eventHandlerTestRequest := *openapiclient.NewEventHandlerTestRequest(map[string]interface{}{"key": interface{}(123)}) // EventHandlerTestRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerTest(context.Background(), ns, name).EventHandlerTestRequest(eventHandlerTestRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerTest``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerTest`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerTest`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerTestRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **eventHandlerTestRequest** | [**EventHandlerTestRequest**](EventHandlerTestRequest.md) |  | 

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


## EventHandlerUpdate

> interface{} EventHandlerUpdate(ctx, ns, name).Execute()

Update an event handler

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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.EventsAPI.EventHandlerUpdate(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `EventsAPI.EventHandlerUpdate``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `EventHandlerUpdate`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `EventsAPI.EventHandlerUpdate`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiEventHandlerUpdateRequest struct via the builder pattern


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

