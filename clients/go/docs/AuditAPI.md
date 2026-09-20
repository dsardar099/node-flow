# \AuditAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**AuditList**](AuditAPI.md#AuditList) | **Get** /v1/ns/{ns}/audit | Read the audit log, newest first



## AuditList

> interface{} AuditList(ctx, ns).Execute()

Read the audit log, newest first



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
	resp, r, err := apiClient.AuditAPI.AuditList(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuditAPI.AuditList``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuditList`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuditAPI.AuditList`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiAuditListRequest struct via the builder pattern


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

