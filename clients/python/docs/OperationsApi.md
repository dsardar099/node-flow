# node_flow_client.OperationsApi

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**execution_bulk**](OperationsApi.md#execution_bulk) | **POST** /v1/ns/{ns}/executions/bulk/{action} | Pause, resume, retry or terminate many executions
[**execution_decide**](OperationsApi.md#execution_decide) | **POST** /v1/ns/{ns}/executions/{id}/decide | Force an evaluation — an escape hatch and a diagnostic
[**execution_pause**](OperationsApi.md#execution_pause) | **POST** /v1/ns/{ns}/executions/{id}/pause | Stop scheduling new tasks
[**execution_rerun**](OperationsApi.md#execution_rerun) | **POST** /v1/ns/{ns}/executions/{id}/rerun | Discard from a task onward and run again from there
[**execution_resume**](OperationsApi.md#execution_resume) | **POST** /v1/ns/{ns}/executions/{id}/resume | Resume a paused execution
[**execution_retry**](OperationsApi.md#execution_retry) | **POST** /v1/ns/{ns}/executions/{id}/retry | Re-run the failed tasks of a terminal execution
[**execution_skip_task**](OperationsApi.md#execution_skip_task) | **POST** /v1/ns/{ns}/executions/{id}/skip-task | Skip a scheduled task without running it
[**execution_terminate**](OperationsApi.md#execution_terminate) | **POST** /v1/ns/{ns}/executions/{id}/terminate | End an execution and release everything it holds
[**metrics_scrape**](OperationsApi.md#metrics_scrape) | **GET** /v1/metrics | Prometheus exposition


# **execution_bulk**
> object execution_bulk(ns, action, execution_bulk_request)

Pause, resume, retry or terminate many executions

Up to 1000 ids. Answers which succeeded and why each of the rest did not.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.execution_bulk_request import ExecutionBulkRequest
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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    action = 'action_example' # str | 
    execution_bulk_request = node_flow_client.ExecutionBulkRequest() # ExecutionBulkRequest | 

    try:
        # Pause, resume, retry or terminate many executions
        api_response = api_instance.execution_bulk(ns, action, execution_bulk_request)
        print("The response of OperationsApi->execution_bulk:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_bulk: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **action** | **str**|  | 
 **execution_bulk_request** | [**ExecutionBulkRequest**](ExecutionBulkRequest.md)|  | 

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

# **execution_decide**
> object execution_decide(ns, id)

Force an evaluation — an escape hatch and a diagnostic

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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Force an evaluation — an escape hatch and a diagnostic
        api_response = api_instance.execution_decide(ns, id)
        print("The response of OperationsApi->execution_decide:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_decide: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_pause**
> object execution_pause(ns, id)

Stop scheduling new tasks

Tasks already queued or leased are not recalled; they run to completion.

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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Stop scheduling new tasks
        api_response = api_instance.execution_pause(ns, id)
        print("The response of OperationsApi->execution_pause:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_pause: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_rerun**
> object execution_rerun(ns, id, execution_rerun_request)

Discard from a task onward and run again from there

For a task that succeeded but produced the wrong answer.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.execution_rerun_request import ExecutionRerunRequest
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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 
    execution_rerun_request = node_flow_client.ExecutionRerunRequest() # ExecutionRerunRequest | 

    try:
        # Discard from a task onward and run again from there
        api_response = api_instance.execution_rerun(ns, id, execution_rerun_request)
        print("The response of OperationsApi->execution_rerun:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_rerun: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 
 **execution_rerun_request** | [**ExecutionRerunRequest**](ExecutionRerunRequest.md)|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_resume**
> object execution_resume(ns, id)

Resume a paused execution

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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Resume a paused execution
        api_response = api_instance.execution_resume(ns, id)
        print("The response of OperationsApi->execution_resume:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_resume: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_retry**
> object execution_retry(ns, id)

Re-run the failed tasks of a terminal execution

Successful tasks keep their results; only failures are reopened.

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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Re-run the failed tasks of a terminal execution
        api_response = api_instance.execution_retry(ns, id)
        print("The response of OperationsApi->execution_retry:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_retry: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_skip_task**
> object execution_skip_task(ns, id, execution_skip_task_request)

Skip a scheduled task without running it

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.execution_skip_task_request import ExecutionSkipTaskRequest
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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 
    execution_skip_task_request = node_flow_client.ExecutionSkipTaskRequest() # ExecutionSkipTaskRequest | 

    try:
        # Skip a scheduled task without running it
        api_response = api_instance.execution_skip_task(ns, id, execution_skip_task_request)
        print("The response of OperationsApi->execution_skip_task:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_skip_task: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 
 **execution_skip_task_request** | [**ExecutionSkipTaskRequest**](ExecutionSkipTaskRequest.md)|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execution_terminate**
> object execution_terminate(ns, id, execution_terminate_request)

End an execution and release everything it holds

Cancels live tasks, purges queue entries, disarms timers, frees permits.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.execution_terminate_request import ExecutionTerminateRequest
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
    api_instance = node_flow_client.OperationsApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 
    execution_terminate_request = node_flow_client.ExecutionTerminateRequest() # ExecutionTerminateRequest | 

    try:
        # End an execution and release everything it holds
        api_response = api_instance.execution_terminate(ns, id, execution_terminate_request)
        print("The response of OperationsApi->execution_terminate:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->execution_terminate: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 
 **execution_terminate_request** | [**ExecutionTerminateRequest**](ExecutionTerminateRequest.md)|  | 

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
**202** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **metrics_scrape**
> object metrics_scrape()

Prometheus exposition

Requires the `metrics:read` scope. Alert on decide_queue_oldest_seconds, timers_overdue and outbox_dead_lettered — each moves before users notice.

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
    api_instance = node_flow_client.OperationsApi(api_client)

    try:
        # Prometheus exposition
        api_response = api_instance.metrics_scrape()
        print("The response of OperationsApi->metrics_scrape:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OperationsApi->metrics_scrape: %s\n" % e)
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

