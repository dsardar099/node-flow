# EventsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**eventHandlerActivity**](EventsApi.md#eventHandlerActivity) | **GET** /v1/ns/{ns}/event-handlers/activity | Event handler activity |
| [**eventHandlerCreate**](EventsApi.md#eventHandlerCreate) | **POST** /v1/ns/{ns}/event-handlers | Create an inbound event handler |
| [**eventHandlerDisable**](EventsApi.md#eventHandlerDisable) | **POST** /v1/ns/{ns}/event-handlers/{name}/disable | Disable an event handler |
| [**eventHandlerEnable**](EventsApi.md#eventHandlerEnable) | **POST** /v1/ns/{ns}/event-handlers/{name}/enable | Enable an event handler |
| [**eventHandlerExecutions**](EventsApi.md#eventHandlerExecutions) | **GET** /v1/ns/{ns}/event-handlers/executions | Event executions — the event monitor |
| [**eventHandlerGet**](EventsApi.md#eventHandlerGet) | **GET** /v1/ns/{ns}/event-handlers/{name} | Fetch one event handler |
| [**eventHandlerList**](EventsApi.md#eventHandlerList) | **GET** /v1/ns/{ns}/event-handlers | List event handlers |
| [**eventHandlerRemove**](EventsApi.md#eventHandlerRemove) | **DELETE** /v1/ns/{ns}/event-handlers/{name} | Delete an event handler |
| [**eventHandlerSources**](EventsApi.md#eventHandlerSources) | **GET** /v1/ns/{ns}/event-handlers/sources | List configured event sources |
| [**eventHandlerTest**](EventsApi.md#eventHandlerTest) | **POST** /v1/ns/{ns}/event-handlers/{name}/test | Send a test message to an event handler |
| [**eventHandlerUpdate**](EventsApi.md#eventHandlerUpdate) | **PUT** /v1/ns/{ns}/event-handlers/{name} | Update an event handler |


<a id="eventHandlerActivity"></a>
# **eventHandlerActivity**
> Object eventHandlerActivity(ns, hours)

Event handler activity

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    Integer hours = 56; // Integer | 
    try {
      Object result = apiInstance.eventHandlerActivity(ns, hours);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerActivity");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **hours** | **Integer**|  | [optional] |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerCreate"></a>
# **eventHandlerCreate**
> Object eventHandlerCreate(ns)

Create an inbound event handler

Maps a message on a configured source and topic to starting a workflow or finishing a task that is waiting for one.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.eventHandlerCreate(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerCreate");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerDisable"></a>
# **eventHandlerDisable**
> Object eventHandlerDisable(ns, name)

Disable an event handler

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.eventHandlerDisable(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerDisable");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerEnable"></a>
# **eventHandlerEnable**
> Object eventHandlerEnable(ns, name)

Enable an event handler

Takes effect on the consumer’s next start, since a newly-handled topic may need subscribing to.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.eventHandlerEnable(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerEnable");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerExecutions"></a>
# **eventHandlerExecutions**
> Object eventHandlerExecutions(ns, handler, outcome, before, limit)

Event executions — the event monitor

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String handler = "handler_example"; // String | 
    String outcome = "ACTED"; // String | 
    UUID before = UUID.randomUUID(); // UUID | 
    Integer limit = 56; // Integer | 
    try {
      Object result = apiInstance.eventHandlerExecutions(ns, handler, outcome, before, limit);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerExecutions");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **handler** | **String**|  | [optional] |
| **outcome** | **String**|  | [optional] [enum: ACTED, SKIPPED, FAILED] |
| **before** | **UUID**|  | [optional] |
| **limit** | **Integer**|  | [optional] |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerGet"></a>
# **eventHandlerGet**
> Object eventHandlerGet(ns, name)

Fetch one event handler

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.eventHandlerGet(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerGet");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerList"></a>
# **eventHandlerList**
> Object eventHandlerList(ns)

List event handlers

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.eventHandlerList(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerList");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerRemove"></a>
# **eventHandlerRemove**
> eventHandlerRemove(ns, name)

Delete an event handler

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      apiInstance.eventHandlerRemove(ns, name);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerRemove");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |

### Return type

null (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerSources"></a>
# **eventHandlerSources**
> Object eventHandlerSources(ns)

List configured event sources

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.eventHandlerSources(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerSources");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerTest"></a>
# **eventHandlerTest**
> Object eventHandlerTest(ns, name, eventHandlerTestRequest)

Send a test message to an event handler

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    EventHandlerTestRequest eventHandlerTestRequest = new EventHandlerTestRequest(); // EventHandlerTestRequest | 
    try {
      Object result = apiInstance.eventHandlerTest(ns, name, eventHandlerTestRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerTest");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |
| **eventHandlerTestRequest** | [**EventHandlerTestRequest**](EventHandlerTestRequest.md)|  | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="eventHandlerUpdate"></a>
# **eventHandlerUpdate**
> Object eventHandlerUpdate(ns, name)

Update an event handler

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.EventsApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");
    
    // Configure API key authorization: apiKey
    ApiKeyAuth apiKey = (ApiKeyAuth) defaultClient.getAuthentication("apiKey");
    apiKey.setApiKey("YOUR API KEY");
    // Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
    //apiKey.setApiKeyPrefix("Token");

    // Configure HTTP bearer authorization: bearer
    HttpBearerAuth bearer = (HttpBearerAuth) defaultClient.getAuthentication("bearer");
    bearer.setBearerToken("BEARER TOKEN");

    EventsApi apiInstance = new EventsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.eventHandlerUpdate(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling EventsApi#eventHandlerUpdate");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters

| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **ns** | **String**| Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | |
| **name** | **String**|  | |

### Return type

**Object**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

