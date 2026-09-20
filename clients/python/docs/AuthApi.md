# node_flow_client.AuthApi

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**auth_create_api_key**](AuthApi.md#auth_create_api_key) | **POST** /v1/auth/api-keys | Create an API key
[**auth_create_service_account**](AuthApi.md#auth_create_service_account) | **POST** /v1/auth/service-accounts | Create a service account
[**auth_disable_service_account**](AuthApi.md#auth_disable_service_account) | **DELETE** /v1/auth/service-accounts/{id} | DELETE /v1/auth/service-accounts/{id}
[**auth_list_api_keys**](AuthApi.md#auth_list_api_keys) | **GET** /v1/auth/api-keys | GET /v1/auth/api-keys
[**auth_list_service_accounts**](AuthApi.md#auth_list_service_accounts) | **GET** /v1/auth/service-accounts | GET /v1/auth/service-accounts
[**auth_me**](AuthApi.md#auth_me) | **GET** /v1/auth/me | Who the caller is
[**auth_revoke_api_key**](AuthApi.md#auth_revoke_api_key) | **DELETE** /v1/auth/api-keys/{id} | DELETE /v1/auth/api-keys/{id}
[**auth_token**](AuthApi.md#auth_token) | **POST** /v1/auth/token | Exchange a service-account key and secret for a short-lived token
[**auth_whoami**](AuthApi.md#auth_whoami) | **GET** /v1/auth/whoami | The caller as the server sees them, including scopes
[**saml_callback**](AuthApi.md#saml_callback) | **POST** /v1/auth/saml/{provider}/callback | Complete a SAML login
[**saml_login**](AuthApi.md#saml_login) | **GET** /v1/auth/saml/{provider}/login | Begin a SAML login
[**saml_metadata**](AuthApi.md#saml_metadata) | **GET** /v1/auth/saml/{provider}/metadata | The service-provider metadata to upload to the identity provider
[**sso_callback**](AuthApi.md#sso_callback) | **GET** /v1/auth/sso/{provider}/callback | Complete a single sign-on login
[**sso_login**](AuthApi.md#sso_login) | **GET** /v1/auth/sso/{provider}/login | Begin a single sign-on login
[**sso_providers**](AuthApi.md#sso_providers) | **GET** /v1/auth/sso/providers | List the identity providers configured for sign-in
[**user_change_password**](AuthApi.md#user_change_password) | **POST** /v1/ns/{ns}/users/change-password | Change your own password
[**user_create_user**](AuthApi.md#user_create_user) | **POST** /v1/ns/{ns}/users | Create a user
[**user_disable_user**](AuthApi.md#user_disable_user) | **DELETE** /v1/ns/{ns}/users/{id} | Disable a user
[**user_list_users**](AuthApi.md#user_list_users) | **GET** /v1/ns/{ns}/users | List users
[**user_login**](AuthApi.md#user_login) | **POST** /v1/ns/{ns}/users/login | Log in with email and password
[**user_logout**](AuthApi.md#user_logout) | **POST** /v1/ns/{ns}/users/logout | End the current session
[**user_logout_everywhere**](AuthApi.md#user_logout_everywhere) | **POST** /v1/ns/{ns}/users/logout-all | End every session for the current user
[**workload_identity_bind**](AuthApi.md#workload_identity_bind) | **POST** /v1/ns/{ns}/workload-identities | Bind a certificate or workload token to a service account
[**workload_identity_list**](AuthApi.md#workload_identity_list) | **GET** /v1/ns/{ns}/workload-identities | List workload identity bindings
[**workload_identity_unbind**](AuthApi.md#workload_identity_unbind) | **DELETE** /v1/ns/{ns}/workload-identities/{id} | Remove a binding


# **auth_create_api_key**
> object auth_create_api_key(auth_create_api_key_request)

Create an API key

The token is returned once and cannot be recovered.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.auth_create_api_key_request import AuthCreateApiKeyRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    auth_create_api_key_request = node_flow_client.AuthCreateApiKeyRequest() # AuthCreateApiKeyRequest | 

    try:
        # Create an API key
        api_response = api_instance.auth_create_api_key(auth_create_api_key_request)
        print("The response of AuthApi->auth_create_api_key:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_create_api_key: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **auth_create_api_key_request** | [**AuthCreateApiKeyRequest**](AuthCreateApiKeyRequest.md)|  | 

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

# **auth_create_service_account**
> object auth_create_service_account(auth_create_service_account_request)

Create a service account

The secret is returned once and cannot be recovered.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.auth_create_service_account_request import AuthCreateServiceAccountRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    auth_create_service_account_request = node_flow_client.AuthCreateServiceAccountRequest() # AuthCreateServiceAccountRequest | 

    try:
        # Create a service account
        api_response = api_instance.auth_create_service_account(auth_create_service_account_request)
        print("The response of AuthApi->auth_create_service_account:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_create_service_account: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **auth_create_service_account_request** | [**AuthCreateServiceAccountRequest**](AuthCreateServiceAccountRequest.md)|  | 

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

# **auth_disable_service_account**
> auth_disable_service_account(id)

DELETE /v1/auth/service-accounts/{id}

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
    api_instance = node_flow_client.AuthApi(api_client)
    id = 'id_example' # str | 

    try:
        # DELETE /v1/auth/service-accounts/{id}
        api_instance.auth_disable_service_account(id)
    except Exception as e:
        print("Exception when calling AuthApi->auth_disable_service_account: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

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

# **auth_list_api_keys**
> object auth_list_api_keys()

GET /v1/auth/api-keys

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
    api_instance = node_flow_client.AuthApi(api_client)

    try:
        # GET /v1/auth/api-keys
        api_response = api_instance.auth_list_api_keys()
        print("The response of AuthApi->auth_list_api_keys:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_list_api_keys: %s\n" % e)
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

# **auth_list_service_accounts**
> object auth_list_service_accounts()

GET /v1/auth/service-accounts

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
    api_instance = node_flow_client.AuthApi(api_client)

    try:
        # GET /v1/auth/service-accounts
        api_response = api_instance.auth_list_service_accounts()
        print("The response of AuthApi->auth_list_service_accounts:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_list_service_accounts: %s\n" % e)
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

# **auth_me**
> object auth_me()

Who the caller is

Namespace-free on purpose: a browser holding a session cookie knows neither its namespace slug nor its scopes until it asks, and every other route needs the namespace in the path.

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
    api_instance = node_flow_client.AuthApi(api_client)

    try:
        # Who the caller is
        api_response = api_instance.auth_me()
        print("The response of AuthApi->auth_me:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_me: %s\n" % e)
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

# **auth_revoke_api_key**
> auth_revoke_api_key(id)

DELETE /v1/auth/api-keys/{id}

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
    api_instance = node_flow_client.AuthApi(api_client)
    id = 'id_example' # str | 

    try:
        # DELETE /v1/auth/api-keys/{id}
        api_instance.auth_revoke_api_key(id)
    except Exception as e:
        print("Exception when calling AuthApi->auth_revoke_api_key: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

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

# **auth_token**
> object auth_token(auth_token_request)

Exchange a service-account key and secret for a short-lived token

### Example


```python
import node_flow_client
from node_flow_client.models.auth_token_request import AuthTokenRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    auth_token_request = node_flow_client.AuthTokenRequest() # AuthTokenRequest | 

    try:
        # Exchange a service-account key and secret for a short-lived token
        api_response = api_instance.auth_token(auth_token_request)
        print("The response of AuthApi->auth_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **auth_token_request** | [**AuthTokenRequest**](AuthTokenRequest.md)|  | 

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

# **auth_whoami**
> object auth_whoami()

The caller as the server sees them, including scopes

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
    api_instance = node_flow_client.AuthApi(api_client)

    try:
        # The caller as the server sees them, including scopes
        api_response = api_instance.auth_whoami()
        print("The response of AuthApi->auth_whoami:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->auth_whoami: %s\n" % e)
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

# **saml_callback**
> object saml_callback(provider)

Complete a SAML login

Validates the assertion, confirms it answers the request this browser started, then issues the same session a password login would.

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
    api_instance = node_flow_client.AuthApi(api_client)
    provider = 'provider_example' # str | 

    try:
        # Complete a SAML login
        api_response = api_instance.saml_callback(provider)
        print("The response of AuthApi->saml_callback:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->saml_callback: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **provider** | **str**|  | 

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
**201** | Success |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **saml_login**
> object saml_login(provider)

Begin a SAML login

Redirects to the identity provider with a freshly generated request id and RelayState, and remembers both in a signed, HttpOnly cookie.

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
    api_instance = node_flow_client.AuthApi(api_client)
    provider = 'provider_example' # str | 

    try:
        # Begin a SAML login
        api_response = api_instance.saml_login(provider)
        print("The response of AuthApi->saml_login:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->saml_login: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **provider** | **str**|  | 

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

# **saml_metadata**
> object saml_metadata(provider)

The service-provider metadata to upload to the identity provider

Saves transcribing an entity id and an ACS URL by hand, which is where SAML setups usually go wrong.

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
    api_instance = node_flow_client.AuthApi(api_client)
    provider = 'provider_example' # str | 

    try:
        # The service-provider metadata to upload to the identity provider
        api_response = api_instance.saml_metadata(provider)
        print("The response of AuthApi->saml_metadata:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->saml_metadata: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **provider** | **str**|  | 

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

# **sso_callback**
> object sso_callback(provider)

Complete a single sign-on login

Verifies state, exchanges the code, verifies the ID token and its nonce, then issues the same session a password login would.

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
    api_instance = node_flow_client.AuthApi(api_client)
    provider = 'provider_example' # str | 

    try:
        # Complete a single sign-on login
        api_response = api_instance.sso_callback(provider)
        print("The response of AuthApi->sso_callback:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->sso_callback: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **provider** | **str**|  | 

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

# **sso_login**
> object sso_login(provider)

Begin a single sign-on login

Redirects to the identity provider with PKCE, a nonce and a state value, and remembers all three in a signed, HttpOnly cookie.

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
    api_instance = node_flow_client.AuthApi(api_client)
    provider = 'provider_example' # str | 

    try:
        # Begin a single sign-on login
        api_response = api_instance.sso_login(provider)
        print("The response of AuthApi->sso_login:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->sso_login: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **provider** | **str**|  | 

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

# **sso_providers**
> object sso_providers()

List the identity providers configured for sign-in

What a login page renders its buttons from, OIDC and SAML together — each says which protocol it speaks, because that decides which URL the button points at. Public by necessity.

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
    api_instance = node_flow_client.AuthApi(api_client)

    try:
        # List the identity providers configured for sign-in
        api_response = api_instance.sso_providers()
        print("The response of AuthApi->sso_providers:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->sso_providers: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

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

# **user_change_password**
> user_change_password(ns, user_change_password_request)

Change your own password

Ends every other session, which is the point of changing it after a compromise.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.user_change_password_request import UserChangePasswordRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    user_change_password_request = node_flow_client.UserChangePasswordRequest() # UserChangePasswordRequest | 

    try:
        # Change your own password
        api_instance.user_change_password(ns, user_change_password_request)
    except Exception as e:
        print("Exception when calling AuthApi->user_change_password: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **user_change_password_request** | [**UserChangePasswordRequest**](UserChangePasswordRequest.md)|  | 

### Return type

void (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**204** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **user_create_user**
> object user_create_user(ns, user_create_user_request)

Create a user

The password must satisfy the policy; see the error detail for what failed.

### Example

* Api Key Authentication (apiKey):
* Bearer (JWT) Authentication (bearer):

```python
import node_flow_client
from node_flow_client.models.user_create_user_request import UserCreateUserRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    user_create_user_request = node_flow_client.UserCreateUserRequest() # UserCreateUserRequest | 

    try:
        # Create a user
        api_response = api_instance.user_create_user(ns, user_create_user_request)
        print("The response of AuthApi->user_create_user:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->user_create_user: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **user_create_user_request** | [**UserCreateUserRequest**](UserCreateUserRequest.md)|  | 

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

# **user_disable_user**
> user_disable_user(ns, id)

Disable a user

Also revokes their sessions — otherwise they stay logged in until expiry.

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Disable a user
        api_instance.user_disable_user(ns, id)
    except Exception as e:
        print("Exception when calling AuthApi->user_disable_user: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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

# **user_list_users**
> object user_list_users(ns)

List users

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # List users
        api_response = api_instance.user_list_users(ns)
        print("The response of AuthApi->user_list_users:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->user_list_users: %s\n" % e)
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

# **user_login**
> object user_login(ns, user_login_request)

Log in with email and password

Sets an HttpOnly session cookie and a readable CSRF cookie. Echo the CSRF value in the X-CSRF-Token header on every subsequent mutating request.

### Example


```python
import node_flow_client
from node_flow_client.models.user_login_request import UserLoginRequest
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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    user_login_request = node_flow_client.UserLoginRequest() # UserLoginRequest | 

    try:
        # Log in with email and password
        api_response = api_instance.user_login(ns, user_login_request)
        print("The response of AuthApi->user_login:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->user_login: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **user_login_request** | [**UserLoginRequest**](UserLoginRequest.md)|  | 

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

# **user_logout**
> user_logout(ns)

End the current session

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # End the current session
        api_instance.user_logout(ns)
    except Exception as e:
        print("Exception when calling AuthApi->user_logout: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

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

# **user_logout_everywhere**
> object user_logout_everywhere(ns)

End every session for the current user

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # End every session for the current user
        api_response = api_instance.user_logout_everywhere(ns)
        print("The response of AuthApi->user_logout_everywhere:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->user_logout_everywhere: %s\n" % e)
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

# **workload_identity_bind**
> object workload_identity_bind(ns)

Bind a certificate or workload token to a service account

Explicit by design: a certificate whose CN matches a service account name proves nothing. The CA or IdP decides who you are; this decides what that identity may do.

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # Bind a certificate or workload token to a service account
        api_response = api_instance.workload_identity_bind(ns)
        print("The response of AuthApi->workload_identity_bind:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->workload_identity_bind: %s\n" % e)
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
**201** | Success |  -  |
**401** | No or invalid credentials |  -  |
**403** | Authenticated, but missing a required scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **workload_identity_list**
> object workload_identity_list(ns)

List workload identity bindings

`lastSeenAt` answers the question asked before removing one: is anything still using it?

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

    try:
        # List workload identity bindings
        api_response = api_instance.workload_identity_list(ns)
        print("The response of AuthApi->workload_identity_list:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling AuthApi->workload_identity_list: %s\n" % e)
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

# **workload_identity_unbind**
> workload_identity_unbind(ns, id)

Remove a binding

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
    api_instance = node_flow_client.AuthApi(api_client)
    ns = 'ns_example' # str | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    id = 'id_example' # str | 

    try:
        # Remove a binding
        api_instance.workload_identity_unbind(ns, id)
    except Exception as e:
        print("Exception when calling AuthApi->workload_identity_unbind: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **ns** | **str**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
 **id** | **str**|  | 

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

