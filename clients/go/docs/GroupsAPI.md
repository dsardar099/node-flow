# \GroupsAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**GroupAddMember**](GroupsAPI.md#GroupAddMember) | **Post** /v1/ns/{ns}/groups/{name}/members | Add someone to a group
[**GroupCreate**](GroupsAPI.md#GroupCreate) | **Post** /v1/ns/{ns}/groups | Create a group
[**GroupGet**](GroupsAPI.md#GroupGet) | **Get** /v1/ns/{ns}/groups/{name} | Fetch a group and its members
[**GroupList**](GroupsAPI.md#GroupList) | **Get** /v1/ns/{ns}/groups | List groups
[**GroupRemove**](GroupsAPI.md#GroupRemove) | **Delete** /v1/ns/{ns}/groups/{name} | Delete a group
[**GroupRemoveMember**](GroupsAPI.md#GroupRemoveMember) | **Delete** /v1/ns/{ns}/groups/{name}/members/{userId} | Remove someone from a group
[**GroupSetScopes**](GroupsAPI.md#GroupSetScopes) | **Put** /v1/ns/{ns}/groups/{name}/scopes | Replace a group’s scopes
[**GroupSetTagGrants**](GroupsAPI.md#GroupSetTagGrants) | **Put** /v1/ns/{ns}/groups/{name}/tag-grants | Replace the tag patterns this group’s members may reach



## GroupAddMember

> GroupAddMember(ctx, ns, name).Execute()

Add someone to a group

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
	r, err := apiClient.GroupsAPI.GroupAddMember(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupAddMember``: %v\n", err)
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

Other parameters are passed through a pointer to a apiGroupAddMemberRequest struct via the builder pattern


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


## GroupCreate

> interface{} GroupCreate(ctx, ns).Execute()

Create a group

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
	resp, r, err := apiClient.GroupsAPI.GroupCreate(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupCreate``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GroupCreate`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GroupsAPI.GroupCreate`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupCreateRequest struct via the builder pattern


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


## GroupGet

> interface{} GroupGet(ctx, ns, name).Execute()

Fetch a group and its members

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
	resp, r, err := apiClient.GroupsAPI.GroupGet(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupGet``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GroupGet`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GroupsAPI.GroupGet`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupGetRequest struct via the builder pattern


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


## GroupList

> interface{} GroupList(ctx, ns).Execute()

List groups

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
	resp, r, err := apiClient.GroupsAPI.GroupList(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupList``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GroupList`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GroupsAPI.GroupList`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupListRequest struct via the builder pattern


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


## GroupRemove

> GroupRemove(ctx, ns, name).Execute()

Delete a group

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
	r, err := apiClient.GroupsAPI.GroupRemove(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupRemove``: %v\n", err)
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

Other parameters are passed through a pointer to a apiGroupRemoveRequest struct via the builder pattern


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


## GroupRemoveMember

> GroupRemoveMember(ctx, ns, name, userId).Execute()

Remove someone from a group

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
	userId := "userId_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.GroupsAPI.GroupRemoveMember(context.Background(), ns, name, userId).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupRemoveMember``: %v\n", err)
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
**userId** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupRemoveMemberRequest struct via the builder pattern


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


## GroupSetScopes

> interface{} GroupSetScopes(ctx, ns, name).Execute()

Replace a group’s scopes



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
	resp, r, err := apiClient.GroupsAPI.GroupSetScopes(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupSetScopes``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GroupSetScopes`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GroupsAPI.GroupSetScopes`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupSetScopesRequest struct via the builder pattern


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


## GroupSetTagGrants

> interface{} GroupSetTagGrants(ctx, ns, name).Execute()

Replace the tag patterns this group’s members may reach



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
	resp, r, err := apiClient.GroupsAPI.GroupSetTagGrants(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GroupsAPI.GroupSetTagGrants``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GroupSetTagGrants`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GroupsAPI.GroupSetTagGrants`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGroupSetTagGrantsRequest struct via the builder pattern


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

