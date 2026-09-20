# node_flow_client.ConductorApi

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**conductor_correlated**](ConductorApi.md#conductor_correlated) | **GET** /conductor/api/workflow/{name}/correlated/{correlationId} | Executions by correlation id (Conductor)
[**conductor_create_task_defs**](ConductorApi.md#conductor_create_task_defs) | **POST** /conductor/api/metadata/taskdefs | Create task definitions (Conductor)
[**conductor_delete_workflow**](ConductorApi.md#conductor_delete_workflow) | **DELETE** /conductor/api/metadata/workflow/{name}/{version} | Delete a workflow version (Conductor)
[**conductor_execute_workflow**](ConductorApi.md#conductor_execute_workflow) | **POST** /conductor/api/workflow/execute/{name} | Start a workflow and wait (Conductor)
[**conductor_execute_workflow2**](ConductorApi.md#conductor_execute_workflow2) | **POST** /conductor/api/workflow/execute/{name}/{version} | Start a workflow and wait (Conductor)
[**conductor_get_task**](ConductorApi.md#conductor_get_task) | **GET** /conductor/api/tasks/{taskId} | Fetch a task (Conductor)
[**conductor_get_task_def**](ConductorApi.md#conductor_get_task_def) | **GET** /conductor/api/metadata/taskdefs/{name} | Fetch a task definition (Conductor)
[**conductor_get_workflow**](ConductorApi.md#conductor_get_workflow) | **GET** /conductor/api/metadata/workflow/{name} | Fetch a workflow definition (Conductor)
[**conductor_get_workflow_run**](ConductorApi.md#conductor_get_workflow_run) | **GET** /conductor/api/workflow/{workflowId} | Fetch an execution (Conductor)
[**conductor_list_task_defs**](ConductorApi.md#conductor_list_task_defs) | **GET** /conductor/api/metadata/taskdefs | List task definitions (Conductor)
[**conductor_list_workflows**](ConductorApi.md#conductor_list_workflows) | **GET** /conductor/api/metadata/workflow | List workflow definitions (Conductor)
[**conductor_log**](ConductorApi.md#conductor_log) | **POST** /conductor/api/tasks/{taskId}/log | Append a log line to a task (Conductor)
[**conductor_pause**](ConductorApi.md#conductor_pause) | **PUT** /conductor/api/workflow/{workflowId}/pause | Pause an execution (Conductor)
[**conductor_poll**](ConductorApi.md#conductor_poll) | **GET** /conductor/api/tasks/poll/{taskType} | Poll for one task (Conductor)
[**conductor_poll_batch**](ConductorApi.md#conductor_poll_batch) | **GET** /conductor/api/tasks/poll/batch/{taskType} | Poll for a batch of tasks (Conductor)
[**conductor_queue_sizes**](ConductorApi.md#conductor_queue_sizes) | **GET** /conductor/api/tasks/queue/sizes | Queue depths by task type (Conductor)
[**conductor_register_workflow**](ConductorApi.md#conductor_register_workflow) | **POST** /conductor/api/metadata/workflow | Register a workflow definition (Conductor)
[**conductor_register_workflows**](ConductorApi.md#conductor_register_workflows) | **PUT** /conductor/api/metadata/workflow | Register workflow definitions in bulk (Conductor)
[**conductor_rerun**](ConductorApi.md#conductor_rerun) | **POST** /conductor/api/workflow/{workflowId}/rerun | Re-run an execution from a task (Conductor)
[**conductor_restart**](ConductorApi.md#conductor_restart) | **POST** /conductor/api/workflow/{workflowId}/restart | Restart an execution (Conductor)
[**conductor_resume**](ConductorApi.md#conductor_resume) | **PUT** /conductor/api/workflow/{workflowId}/resume | Resume an execution (Conductor)
[**conductor_retry**](ConductorApi.md#conductor_retry) | **POST** /conductor/api/workflow/{workflowId}/retry | Retry the failed tasks of an execution (Conductor)
[**conductor_search**](ConductorApi.md#conductor_search) | **GET** /conductor/api/workflow/search | Search executions (Conductor)
[**conductor_start_named**](ConductorApi.md#conductor_start_named) | **POST** /conductor/api/workflow/{name} | Start a workflow by name (Conductor)
[**conductor_start_workflow**](ConductorApi.md#conductor_start_workflow) | **POST** /conductor/api/workflow | Start a workflow (Conductor)
[**conductor_terminate**](ConductorApi.md#conductor_terminate) | **DELETE** /conductor/api/workflow/{workflowId} | Terminate an execution (Conductor)
[**conductor_token**](ConductorApi.md#conductor_token) | **POST** /conductor/api/token | Conductor-compatible token exchange
[**conductor_update_by_ref**](ConductorApi.md#conductor_update_by_ref) | **POST** /conductor/api/tasks/{workflowId}/{taskRefName}/{status} | Report a task result by reference (Conductor)
[**conductor_update_task**](ConductorApi.md#conductor_update_task) | **POST** /conductor/api/tasks | Report a task result (Conductor)
[**conductor_update_task_def**](ConductorApi.md#conductor_update_task_def) | **PUT** /conductor/api/metadata/taskdefs | Update a task definition (Conductor)


# **conductor_correlated**
> object conductor_correlated(name, correlation_id)

Executions by correlation id (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 
    correlation_id = 'correlation_id_example' # str | 

    try:
        # Executions by correlation id (Conductor)
        api_response = api_instance.conductor_correlated(name, correlation_id)
        print("The response of ConductorApi->conductor_correlated:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_correlated: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 
 **correlation_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_create_task_defs**
> object conductor_create_task_defs()

Create task definitions (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Create task definitions (Conductor)
        api_response = api_instance.conductor_create_task_defs()
        print("The response of ConductorApi->conductor_create_task_defs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_create_task_defs: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_delete_workflow**
> object conductor_delete_workflow(name, version)

Delete a workflow version (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 
    version = 'version_example' # str | 

    try:
        # Delete a workflow version (Conductor)
        api_response = api_instance.conductor_delete_workflow(name, version)
        print("The response of ConductorApi->conductor_delete_workflow:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_delete_workflow: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 
 **version** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_execute_workflow**
> object conductor_execute_workflow(name)

Start a workflow and wait (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 

    try:
        # Start a workflow and wait (Conductor)
        api_response = api_instance.conductor_execute_workflow(name)
        print("The response of ConductorApi->conductor_execute_workflow:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_execute_workflow: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_execute_workflow2**
> object conductor_execute_workflow2(name, version)

Start a workflow and wait (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 
    version = 'version_example' # str | 

    try:
        # Start a workflow and wait (Conductor)
        api_response = api_instance.conductor_execute_workflow2(name, version)
        print("The response of ConductorApi->conductor_execute_workflow2:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_execute_workflow2: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 
 **version** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_get_task**
> object conductor_get_task(task_id)

Fetch a task (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    task_id = 'task_id_example' # str | 

    try:
        # Fetch a task (Conductor)
        api_response = api_instance.conductor_get_task(task_id)
        print("The response of ConductorApi->conductor_get_task:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_get_task: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **task_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_get_task_def**
> object conductor_get_task_def(name)

Fetch a task definition (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 

    try:
        # Fetch a task definition (Conductor)
        api_response = api_instance.conductor_get_task_def(name)
        print("The response of ConductorApi->conductor_get_task_def:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_get_task_def: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_get_workflow**
> object conductor_get_workflow(name)

Fetch a workflow definition (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 

    try:
        # Fetch a workflow definition (Conductor)
        api_response = api_instance.conductor_get_workflow(name)
        print("The response of ConductorApi->conductor_get_workflow:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_get_workflow: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_get_workflow_run**
> object conductor_get_workflow_run(workflow_id)

Fetch an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Fetch an execution (Conductor)
        api_response = api_instance.conductor_get_workflow_run(workflow_id)
        print("The response of ConductorApi->conductor_get_workflow_run:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_get_workflow_run: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_list_task_defs**
> object conductor_list_task_defs()

List task definitions (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # List task definitions (Conductor)
        api_response = api_instance.conductor_list_task_defs()
        print("The response of ConductorApi->conductor_list_task_defs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_list_task_defs: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_list_workflows**
> object conductor_list_workflows()

List workflow definitions (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # List workflow definitions (Conductor)
        api_response = api_instance.conductor_list_workflows()
        print("The response of ConductorApi->conductor_list_workflows:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_list_workflows: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_log**
> object conductor_log(task_id)

Append a log line to a task (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    task_id = 'task_id_example' # str | 

    try:
        # Append a log line to a task (Conductor)
        api_response = api_instance.conductor_log(task_id)
        print("The response of ConductorApi->conductor_log:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_log: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **task_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_pause**
> object conductor_pause(workflow_id)

Pause an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Pause an execution (Conductor)
        api_response = api_instance.conductor_pause(workflow_id)
        print("The response of ConductorApi->conductor_pause:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_pause: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_poll**
> object conductor_poll(task_type)

Poll for one task (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    task_type = 'task_type_example' # str | 

    try:
        # Poll for one task (Conductor)
        api_response = api_instance.conductor_poll(task_type)
        print("The response of ConductorApi->conductor_poll:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_poll: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **task_type** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_poll_batch**
> object conductor_poll_batch(task_type)

Poll for a batch of tasks (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    task_type = 'task_type_example' # str | 

    try:
        # Poll for a batch of tasks (Conductor)
        api_response = api_instance.conductor_poll_batch(task_type)
        print("The response of ConductorApi->conductor_poll_batch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_poll_batch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **task_type** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_queue_sizes**
> object conductor_queue_sizes()

Queue depths by task type (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Queue depths by task type (Conductor)
        api_response = api_instance.conductor_queue_sizes()
        print("The response of ConductorApi->conductor_queue_sizes:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_queue_sizes: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_register_workflow**
> object conductor_register_workflow()

Register a workflow definition (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Register a workflow definition (Conductor)
        api_response = api_instance.conductor_register_workflow()
        print("The response of ConductorApi->conductor_register_workflow:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_register_workflow: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_register_workflows**
> object conductor_register_workflows()

Register workflow definitions in bulk (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Register workflow definitions in bulk (Conductor)
        api_response = api_instance.conductor_register_workflows()
        print("The response of ConductorApi->conductor_register_workflows:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_register_workflows: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_rerun**
> object conductor_rerun(workflow_id)

Re-run an execution from a task (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Re-run an execution from a task (Conductor)
        api_response = api_instance.conductor_rerun(workflow_id)
        print("The response of ConductorApi->conductor_rerun:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_rerun: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_restart**
> object conductor_restart(workflow_id)

Restart an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Restart an execution (Conductor)
        api_response = api_instance.conductor_restart(workflow_id)
        print("The response of ConductorApi->conductor_restart:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_restart: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_resume**
> object conductor_resume(workflow_id)

Resume an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Resume an execution (Conductor)
        api_response = api_instance.conductor_resume(workflow_id)
        print("The response of ConductorApi->conductor_resume:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_resume: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_retry**
> object conductor_retry(workflow_id)

Retry the failed tasks of an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Retry the failed tasks of an execution (Conductor)
        api_response = api_instance.conductor_retry(workflow_id)
        print("The response of ConductorApi->conductor_retry:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_retry: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_search**
> object conductor_search()

Search executions (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Search executions (Conductor)
        api_response = api_instance.conductor_search()
        print("The response of ConductorApi->conductor_search:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_search: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_start_named**
> object conductor_start_named(name)

Start a workflow by name (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    name = 'name_example' # str | 

    try:
        # Start a workflow by name (Conductor)
        api_response = api_instance.conductor_start_named(name)
        print("The response of ConductorApi->conductor_start_named:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_start_named: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **name** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_start_workflow**
> object conductor_start_workflow(conductor_start_workflow_request)

Start a workflow (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.conductor_start_workflow_request import ConductorStartWorkflowRequest
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    conductor_start_workflow_request = node_flow_client.ConductorStartWorkflowRequest() # ConductorStartWorkflowRequest | 

    try:
        # Start a workflow (Conductor)
        api_response = api_instance.conductor_start_workflow(conductor_start_workflow_request)
        print("The response of ConductorApi->conductor_start_workflow:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_start_workflow: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductor_start_workflow_request** | [**ConductorStartWorkflowRequest**](ConductorStartWorkflowRequest.md)|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_terminate**
> object conductor_terminate(workflow_id)

Terminate an execution (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 

    try:
        # Terminate an execution (Conductor)
        api_response = api_instance.conductor_terminate(workflow_id)
        print("The response of ConductorApi->conductor_terminate:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_terminate: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_token**
> object conductor_token(conductor_token_request)

Conductor-compatible token exchange

### Example


```python
import node_flow_client
from node_flow_client.models.conductor_token_request import ConductorTokenRequest
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)


# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    conductor_token_request = node_flow_client.ConductorTokenRequest() # ConductorTokenRequest | 

    try:
        # Conductor-compatible token exchange
        api_response = api_instance.conductor_token(conductor_token_request)
        print("The response of ConductorApi->conductor_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductor_token_request** | [**ConductorTokenRequest**](ConductorTokenRequest.md)|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_update_by_ref**
> object conductor_update_by_ref(workflow_id, task_ref_name, status)

Report a task result by reference (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    workflow_id = 'workflow_id_example' # str | 
    task_ref_name = 'task_ref_name_example' # str | 
    status = 'status_example' # str | 

    try:
        # Report a task result by reference (Conductor)
        api_response = api_instance.conductor_update_by_ref(workflow_id, task_ref_name, status)
        print("The response of ConductorApi->conductor_update_by_ref:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_update_by_ref: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **workflow_id** | **str**|  | 
 **task_ref_name** | **str**|  | 
 **status** | **str**|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_update_task**
> object conductor_update_task(conductor_update_task_request)

Report a task result (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.conductor_update_task_request import ConductorUpdateTaskRequest
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)
    conductor_update_task_request = node_flow_client.ConductorUpdateTaskRequest() # ConductorUpdateTaskRequest | 

    try:
        # Report a task result (Conductor)
        api_response = api_instance.conductor_update_task(conductor_update_task_request)
        print("The response of ConductorApi->conductor_update_task:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_update_task: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **conductor_update_task_request** | [**ConductorUpdateTaskRequest**](ConductorUpdateTaskRequest.md)|  | 

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **conductor_update_task_def**
> object conductor_update_task_def()

Update a task definition (Conductor)

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost
# See configuration.py for a list of all supported configuration parameters.
configuration = node_flow_client.Configuration(
    host = "http://localhost"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: apiKey
configuration.api_key['apiKey'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['apiKey'] = 'Bearer'

# Configure Bearer authorization (JWT): bearer
configuration = node_flow_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with node_flow_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = node_flow_client.ConductorApi(api_client)

    try:
        # Update a task definition (Conductor)
        api_response = api_instance.conductor_update_task_def()
        print("The response of ConductorApi->conductor_update_task_def:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling ConductorApi->conductor_update_task_def: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

