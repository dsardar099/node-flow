# node_flow_client.WebhooksApi

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**hook_receiver_receive**](WebhooksApi.md#hook_receiver_receive) | **POST** /v1/hooks/{id} | Receive a webhook delivery
[**incoming_webhook_create**](WebhooksApi.md#incoming_webhook_create) | **POST** /v1/ns/{ns}/incoming-webhooks | Create an inbound webhook
[**incoming_webhook_get**](WebhooksApi.md#incoming_webhook_get) | **GET** /v1/ns/{ns}/incoming-webhooks/{name} | Fetch an inbound webhook
[**incoming_webhook_list**](WebhooksApi.md#incoming_webhook_list) | **GET** /v1/ns/{ns}/incoming-webhooks | List inbound webhooks
[**incoming_webhook_remove**](WebhooksApi.md#incoming_webhook_remove) | **DELETE** /v1/ns/{ns}/incoming-webhooks/{name} | Delete an inbound webhook
[**incoming_webhook_update**](WebhooksApi.md#incoming_webhook_update) | **PUT** /v1/ns/{ns}/incoming-webhooks/{name} | Update an inbound webhook
[**webhook_deliver**](WebhooksApi.md#webhook_deliver) | **POST** /v1/ns/{ns}/webhooks/{token} | Deliver a callback to a waiting WAIT_FOR_WEBHOOK task


# **hook_receiver_receive**
> object hook_receiver_receive(id)

Receive a webhook delivery

### Example


```python
import node_flow_client
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
    api_instance = node_flow_client.WebhooksApi(api_client)
    id = 'id_example' # str | 

    try:
        # Receive a webhook delivery
        api_response = api_instance.hook_receiver_receive(id)
        print("The response of WebhooksApi->hook_receiver_receive:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->hook_receiver_receive: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**202** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **incoming_webhook_create**
> object incoming_webhook_create(ns, incoming_webhook_create_request)

Create an inbound webhook

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.incoming_webhook_create_request import IncomingWebhookCreateRequest
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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    incoming_webhook_create_request = node_flow_client.IncomingWebhookCreateRequest() # IncomingWebhookCreateRequest | 

    try:
        # Create an inbound webhook
        api_response = api_instance.incoming_webhook_create(ns, incoming_webhook_create_request)
        print("The response of WebhooksApi->incoming_webhook_create:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->incoming_webhook_create: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **incoming_webhook_create_request** | [**IncomingWebhookCreateRequest**](IncomingWebhookCreateRequest.md)|  | 

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
**201** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **incoming_webhook_get**
> object incoming_webhook_get(ns, name)

Fetch an inbound webhook

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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    name = 'name_example' # str | 

    try:
        # Fetch an inbound webhook
        api_response = api_instance.incoming_webhook_get(ns, name)
        print("The response of WebhooksApi->incoming_webhook_get:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->incoming_webhook_get: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
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

# **incoming_webhook_list**
> object incoming_webhook_list(ns)

List inbound webhooks

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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # List inbound webhooks
        api_response = api_instance.incoming_webhook_list(ns)
        print("The response of WebhooksApi->incoming_webhook_list:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->incoming_webhook_list: %s\n" % e)
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

# **incoming_webhook_remove**
> incoming_webhook_remove(ns, name)

Delete an inbound webhook

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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    name = 'name_example' # str | 

    try:
        # Delete an inbound webhook
        api_instance.incoming_webhook_remove(ns, name)
    except Exception as e:
        print("Exception when calling WebhooksApi->incoming_webhook_remove: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **name** | **str**|  | 

### Return type

void (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**204** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **incoming_webhook_update**
> object incoming_webhook_update(ns, name, incoming_webhook_update_request)

Update an inbound webhook

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.incoming_webhook_update_request import IncomingWebhookUpdateRequest
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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    name = 'name_example' # str | 
    incoming_webhook_update_request = node_flow_client.IncomingWebhookUpdateRequest() # IncomingWebhookUpdateRequest | 

    try:
        # Update an inbound webhook
        api_response = api_instance.incoming_webhook_update(ns, name, incoming_webhook_update_request)
        print("The response of WebhooksApi->incoming_webhook_update:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->incoming_webhook_update: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **name** | **str**|  | 
 **incoming_webhook_update_request** | [**IncomingWebhookUpdateRequest**](IncomingWebhookUpdateRequest.md)|  | 

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

# **webhook_deliver**
> object webhook_deliver(ns, token)

Deliver a callback to a waiting WAIT_FOR_WEBHOOK task

Public by design: the unguessable token is the capability, and it completes exactly one task. Single-use, so a retried delivery is a 409 rather than a second completion.

### Example


```python
import node_flow_client
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
    api_instance = node_flow_client.WebhooksApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    token = 'token_example' # str | 

    try:
        # Deliver a callback to a waiting WAIT_FOR_WEBHOOK task
        api_response = api_instance.webhook_deliver(ns, token)
        print("The response of WebhooksApi->webhook_deliver:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->webhook_deliver: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **token** | **str**|  | 

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

