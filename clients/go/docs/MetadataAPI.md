# \MetadataAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**MetadataDeleteTaskDefinition**](MetadataAPI.md#MetadataDeleteTaskDefinition) | **Delete** /v1/ns/{ns}/metadata/task-definitions/{name} | Delete a task definition
[**MetadataDeleteWorkflow**](MetadataAPI.md#MetadataDeleteWorkflow) | **Delete** /v1/ns/{ns}/metadata/workflows/{name} | Delete one version of a workflow definition
[**MetadataExportBundle**](MetadataAPI.md#MetadataExportBundle) | **Post** /v1/ns/{ns}/metadata/export | Export workflows and task definitions as one JSON bundle
[**MetadataGetTaskDefinition**](MetadataAPI.md#MetadataGetTaskDefinition) | **Get** /v1/ns/{ns}/metadata/task-definitions/{name} | Get a task definition
[**MetadataGetWorkflow**](MetadataAPI.md#MetadataGetWorkflow) | **Get** /v1/ns/{ns}/metadata/workflows/{name} | Fetch one workflow definition
[**MetadataImportBpmnDocument**](MetadataAPI.md#MetadataImportBpmnDocument) | **Post** /v1/ns/{ns}/metadata/workflows/import-bpmn | Convert a BPMN 2.0 process into a workflow definition
[**MetadataImportBundle**](MetadataAPI.md#MetadataImportBundle) | **Post** /v1/ns/{ns}/metadata/import | Import a bundle of workflows and task definitions
[**MetadataListTaskDefinitions**](MetadataAPI.md#MetadataListTaskDefinitions) | **Get** /v1/ns/{ns}/metadata/task-definitions | List task definitions
[**MetadataListWorkflows**](MetadataAPI.md#MetadataListWorkflows) | **Get** /v1/ns/{ns}/metadata/workflows | List registered workflows
[**MetadataRegisterWorkflow**](MetadataAPI.md#MetadataRegisterWorkflow) | **Post** /v1/ns/{ns}/metadata/workflows | Register a workflow definition
[**MetadataSetWorkflowTags**](MetadataAPI.md#MetadataSetWorkflowTags) | **Put** /v1/ns/{ns}/metadata/workflows/{name}/tags | Replace the tags on a workflow
[**MetadataUpsertTaskDefinition**](MetadataAPI.md#MetadataUpsertTaskDefinition) | **Post** /v1/ns/{ns}/metadata/task-definitions | Create or update a task definition
[**MetadataValidateWorkflow**](MetadataAPI.md#MetadataValidateWorkflow) | **Post** /v1/ns/{ns}/metadata/workflows/validate | Validate and compile a workflow definition without registering it
[**SimulationTest**](MetadataAPI.md#SimulationTest) | **Post** /v1/ns/{ns}/metadata/workflows/test | Test a workflow with mocked task outcomes



## MetadataDeleteTaskDefinition

> interface{} MetadataDeleteTaskDefinition(ctx, ns, name).Execute()

Delete a task definition



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
	resp, r, err := apiClient.MetadataAPI.MetadataDeleteTaskDefinition(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataDeleteTaskDefinition``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataDeleteTaskDefinition`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataDeleteTaskDefinition`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataDeleteTaskDefinitionRequest struct via the builder pattern


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


## MetadataDeleteWorkflow

> interface{} MetadataDeleteWorkflow(ctx, ns, name).Version(version).Execute()

Delete one version of a workflow definition



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
	version := int32(56) // int32 | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataDeleteWorkflow(context.Background(), ns, name).Version(version).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataDeleteWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataDeleteWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataDeleteWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataDeleteWorkflowRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **version** | **int32** |  | 

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


## MetadataExportBundle

> interface{} MetadataExportBundle(ctx, ns).MetadataExportBundleRequest(metadataExportBundleRequest).Execute()

Export workflows and task definitions as one JSON bundle



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
	metadataExportBundleRequest := *openapiclient.NewMetadataExportBundleRequest() // MetadataExportBundleRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataExportBundle(context.Background(), ns).MetadataExportBundleRequest(metadataExportBundleRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataExportBundle``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataExportBundle`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataExportBundle`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataExportBundleRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **metadataExportBundleRequest** | [**MetadataExportBundleRequest**](MetadataExportBundleRequest.md) |  | 

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


## MetadataGetTaskDefinition

> interface{} MetadataGetTaskDefinition(ctx, ns, name).Execute()

Get a task definition

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
	resp, r, err := apiClient.MetadataAPI.MetadataGetTaskDefinition(context.Background(), ns, name).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataGetTaskDefinition``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataGetTaskDefinition`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataGetTaskDefinition`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataGetTaskDefinitionRequest struct via the builder pattern


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


## MetadataGetWorkflow

> interface{} MetadataGetWorkflow(ctx, ns, name).Version(version).Execute()

Fetch one workflow definition

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
	version := int32(56) // int32 |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataGetWorkflow(context.Background(), ns, name).Version(version).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataGetWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataGetWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataGetWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataGetWorkflowRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **version** | **int32** |  | 

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


## MetadataImportBpmnDocument

> interface{} MetadataImportBpmnDocument(ctx, ns).MetadataImportBpmnDocumentRequest(metadataImportBpmnDocumentRequest).Execute()

Convert a BPMN 2.0 process into a workflow definition



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
	metadataImportBpmnDocumentRequest := *openapiclient.NewMetadataImportBpmnDocumentRequest("Xml_example") // MetadataImportBpmnDocumentRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataImportBpmnDocument(context.Background(), ns).MetadataImportBpmnDocumentRequest(metadataImportBpmnDocumentRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataImportBpmnDocument``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataImportBpmnDocument`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataImportBpmnDocument`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataImportBpmnDocumentRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **metadataImportBpmnDocumentRequest** | [**MetadataImportBpmnDocumentRequest**](MetadataImportBpmnDocumentRequest.md) |  | 

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


## MetadataImportBundle

> interface{} MetadataImportBundle(ctx, ns).MetadataImportBundleRequest(metadataImportBundleRequest).Execute()

Import a bundle of workflows and task definitions



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
	metadataImportBundleRequest := *openapiclient.NewMetadataImportBundleRequest(map[string]interface{}{"key": interface{}(123)}) // MetadataImportBundleRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataImportBundle(context.Background(), ns).MetadataImportBundleRequest(metadataImportBundleRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataImportBundle``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataImportBundle`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataImportBundle`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataImportBundleRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **metadataImportBundleRequest** | [**MetadataImportBundleRequest**](MetadataImportBundleRequest.md) |  | 

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


## MetadataListTaskDefinitions

> interface{} MetadataListTaskDefinitions(ctx, ns).Execute()

List task definitions

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
	resp, r, err := apiClient.MetadataAPI.MetadataListTaskDefinitions(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataListTaskDefinitions``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataListTaskDefinitions`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataListTaskDefinitions`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataListTaskDefinitionsRequest struct via the builder pattern


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


## MetadataListWorkflows

> interface{} MetadataListWorkflows(ctx, ns).Execute()

List registered workflows

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
	resp, r, err := apiClient.MetadataAPI.MetadataListWorkflows(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataListWorkflows``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataListWorkflows`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataListWorkflows`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataListWorkflowsRequest struct via the builder pattern


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


## MetadataRegisterWorkflow

> interface{} MetadataRegisterWorkflow(ctx, ns).MetadataRegisterWorkflowRequest(metadataRegisterWorkflowRequest).Execute()

Register a workflow definition



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
	metadataRegisterWorkflowRequest := *openapiclient.NewMetadataRegisterWorkflowRequest("Name_example", []openapiclient.Shared2d711327d8{*openapiclient.NewShared2d711327d8("Name_example", "TaskReferenceName_example", "Type_example")}) // MetadataRegisterWorkflowRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataRegisterWorkflow(context.Background(), ns).MetadataRegisterWorkflowRequest(metadataRegisterWorkflowRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataRegisterWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataRegisterWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataRegisterWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataRegisterWorkflowRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **metadataRegisterWorkflowRequest** | [**MetadataRegisterWorkflowRequest**](MetadataRegisterWorkflowRequest.md) |  | 

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


## MetadataSetWorkflowTags

> interface{} MetadataSetWorkflowTags(ctx, ns, name).MetadataSetWorkflowTagsRequest(metadataSetWorkflowTagsRequest).Execute()

Replace the tags on a workflow



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
	metadataSetWorkflowTagsRequest := *openapiclient.NewMetadataSetWorkflowTagsRequest([]string{"Tags_example"}) // MetadataSetWorkflowTagsRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataSetWorkflowTags(context.Background(), ns, name).MetadataSetWorkflowTagsRequest(metadataSetWorkflowTagsRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataSetWorkflowTags``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataSetWorkflowTags`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataSetWorkflowTags`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**name** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataSetWorkflowTagsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


 **metadataSetWorkflowTagsRequest** | [**MetadataSetWorkflowTagsRequest**](MetadataSetWorkflowTagsRequest.md) |  | 

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


## MetadataUpsertTaskDefinition

> interface{} MetadataUpsertTaskDefinition(ctx, ns).MetadataUpsertTaskDefinitionRequest(metadataUpsertTaskDefinitionRequest).Execute()

Create or update a task definition



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
	metadataUpsertTaskDefinitionRequest := *openapiclient.NewMetadataUpsertTaskDefinitionRequest("Name_example") // MetadataUpsertTaskDefinitionRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.MetadataUpsertTaskDefinition(context.Background(), ns).MetadataUpsertTaskDefinitionRequest(metadataUpsertTaskDefinitionRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataUpsertTaskDefinition``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataUpsertTaskDefinition`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataUpsertTaskDefinition`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataUpsertTaskDefinitionRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **metadataUpsertTaskDefinitionRequest** | [**MetadataUpsertTaskDefinitionRequest**](MetadataUpsertTaskDefinitionRequest.md) |  | 

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


## MetadataValidateWorkflow

> interface{} MetadataValidateWorkflow(ctx, ns).Execute()

Validate and compile a workflow definition without registering it



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
	resp, r, err := apiClient.MetadataAPI.MetadataValidateWorkflow(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.MetadataValidateWorkflow``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `MetadataValidateWorkflow`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.MetadataValidateWorkflow`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiMetadataValidateWorkflowRequest struct via the builder pattern


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


## SimulationTest

> interface{} SimulationTest(ctx, ns).SimulationTestRequest(simulationTestRequest).Execute()

Test a workflow with mocked task outcomes



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
	simulationTestRequest := *openapiclient.NewSimulationTestRequest() // SimulationTestRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.MetadataAPI.SimulationTest(context.Background(), ns).SimulationTestRequest(simulationTestRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `MetadataAPI.SimulationTest``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SimulationTest`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `MetadataAPI.SimulationTest`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiSimulationTestRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **simulationTestRequest** | [**SimulationTestRequest**](SimulationTestRequest.md) |  | 

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

