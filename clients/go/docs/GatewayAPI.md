# \GatewayAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ApiGatewayCall**](GatewayAPI.md#ApiGatewayCall) | **Post** /v1/ns/{ns}/api/{workflow} | Call a workflow as a REST endpoint



## ApiGatewayCall

> interface{} ApiGatewayCall(ctx, ns, workflow).Execute()

Call a workflow as a REST endpoint



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
	workflow := "workflow_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.GatewayAPI.ApiGatewayCall(context.Background(), ns, workflow).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GatewayAPI.ApiGatewayCall``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ApiGatewayCall`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `GatewayAPI.ApiGatewayCall`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**workflow** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiApiGatewayCallRequest struct via the builder pattern


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

