# node_flow_client.HumanTasksApi

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**human_task_claim**](HumanTasksApi.md#human_task_claim) | **POST** /v1/ns/{ns}/human-tasks/{id}/claim | Take possession of a human task
[**human_task_complete**](HumanTasksApi.md#human_task_complete) | **POST** /v1/ns/{ns}/human-tasks/{id}/complete | Complete a human task and let the workflow continue
[**human_task_get**](HumanTasksApi.md#human_task_get) | **GET** /v1/ns/{ns}/human-tasks/{id} | Fetch one human task
[**human_task_inbox**](HumanTasksApi.md#human_task_inbox) | **GET** /v1/ns/{ns}/human-tasks | List the human tasks this user can act on
[**human_task_reassign**](HumanTasksApi.md#human_task_reassign) | **POST** /v1/ns/{ns}/human-tasks/{id}/reassign | Replace who a human task is assigned to
[**human_task_release**](HumanTasksApi.md#human_task_release) | **POST** /v1/ns/{ns}/human-tasks/{id}/release | Give a claimed task back to the pool
[**human_task_search**](HumanTasksApi.md#human_task_search) | **GET** /v1/ns/{ns}/human-tasks/search | Search every human task in the namespace
[**human_task_skip**](HumanTasksApi.md#human_task_skip) | **POST** /v1/ns/{ns}/human-tasks/{id}/skip | Skip a human task


# **human_task_claim**
> object human_task_claim(ns, id)

Take possession of a human task

Single-winner: two people claiming the same task at the same moment resolve to one, and the loser is told rather than both starting work.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Take possession of a human task
        api_response = api_instance.human_task_claim(ns, id)
        print("The response of HumanTasksApi->human_task_claim:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_claim: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **human_task_complete**
> object human_task_complete(ns, id)

Complete a human task and let the workflow continue

Requires holding the claim. Without that, one person’s answer could silently replace another’s on a task they were actively working.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Complete a human task and let the workflow continue
        api_response = api_instance.human_task_complete(ns, id)
        print("The response of HumanTasksApi->human_task_complete:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_complete: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **human_task_get**
> object human_task_get(ns, id)

Fetch one human task

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Fetch one human task
        api_response = api_instance.human_task_get(ns, id)
        print("The response of HumanTasksApi->human_task_get:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_get: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **human_task_inbox**
> object human_task_inbox(ns)

List the human tasks this user can act on

Assigned to them, held by them, or unassigned and free to claim. Never another person's assignment, and never something someone else holds.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # List the human tasks this user can act on
        api_response = api_instance.human_task_inbox(ns)
        print("The response of HumanTasksApi->human_task_inbox:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_inbox: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

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

# **human_task_reassign**
> object human_task_reassign(ns, id)

Replace who a human task is assigned to

An operator action. Takes an assignment chain — `[{ "user": "email", "slaMinutes": 30 }, { "group": "name" }]` — and releases any claim, so nobody keeps working a task that was moved away from them.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Replace who a human task is assigned to
        api_response = api_instance.human_task_reassign(ns, id)
        print("The response of HumanTasksApi->human_task_reassign:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_reassign: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **human_task_release**
> object human_task_release(ns, id)

Give a claimed task back to the pool

The assignment is left intact — releasing is not reassigning.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Give a claimed task back to the pool
        api_response = api_instance.human_task_release(ns, id)
        print("The response of HumanTasksApi->human_task_release:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_release: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **human_task_search**
> object human_task_search(ns)

Search every human task in the namespace

The operator view: what is waiting, with whom, and for how long — across assignees, unlike the inbox. `state` is open (default), unclaimed, claimed, completed or all; `assignee` is an email, `group` a group name. Tasks of workflows the caller’s tags cannot reach are left out.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # Search every human task in the namespace
        api_response = api_instance.human_task_search(ns)
        print("The response of HumanTasksApi->human_task_search:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_search: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

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

# **human_task_skip**
> object human_task_skip(ns, id)

Skip a human task

The workflow continues as if the task completed; the reason is recorded in its output.

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
    api_instance = node_flow_client.HumanTasksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Skip a human task
        api_response = api_instance.human_task_skip(ns, id)
        print("The response of HumanTasksApi->human_task_skip:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling HumanTasksApi->human_task_skip: %s\n" % e)
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
**200** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

