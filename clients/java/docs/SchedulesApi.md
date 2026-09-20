# SchedulesApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**scheduleCreate**](SchedulesApi.md#scheduleCreate) | **POST** /v1/ns/{ns}/schedules | Create a cron schedule |
| [**scheduleGet**](SchedulesApi.md#scheduleGet) | **GET** /v1/ns/{ns}/schedules/{name} | Fetch one schedule, with its upcoming runs |
| [**scheduleList**](SchedulesApi.md#scheduleList) | **GET** /v1/ns/{ns}/schedules | List cron schedules |
| [**schedulePause**](SchedulesApi.md#schedulePause) | **POST** /v1/ns/{ns}/schedules/{name}/pause | Pause a schedule |
| [**schedulePreview**](SchedulesApi.md#schedulePreview) | **POST** /v1/ns/{ns}/schedules/preview | Preview when a cron expression fires |
| [**scheduleRemove**](SchedulesApi.md#scheduleRemove) | **DELETE** /v1/ns/{ns}/schedules/{name} | Delete a schedule |
| [**scheduleResume**](SchedulesApi.md#scheduleResume) | **POST** /v1/ns/{ns}/schedules/{name}/resume | Resume a schedule |
| [**scheduleRuns**](SchedulesApi.md#scheduleRuns) | **GET** /v1/ns/{ns}/schedules/{name}/runs | A schedule’s firing history |
| [**scheduleUpdate**](SchedulesApi.md#scheduleUpdate) | **PUT** /v1/ns/{ns}/schedules/{name} | Update a schedule |


<a id="scheduleCreate"></a>
# **scheduleCreate**
> Object scheduleCreate(ns)

Create a cron schedule

Leased and database-backed, so running several replicas produces one firing rather than one per replica.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.scheduleCreate(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleCreate");
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

<a id="scheduleGet"></a>
# **scheduleGet**
> Object scheduleGet(ns, name)

Fetch one schedule, with its upcoming runs

The next few firings are computed rather than stored, which is the cheapest way to answer \&quot;did I get the cron expression right?\&quot;.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.scheduleGet(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleGet");
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

<a id="scheduleList"></a>
# **scheduleList**
> Object scheduleList(ns)

List cron schedules

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.scheduleList(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleList");
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

<a id="schedulePause"></a>
# **schedulePause**
> Object schedulePause(ns, name)

Pause a schedule

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.schedulePause(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#schedulePause");
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

<a id="schedulePreview"></a>
# **schedulePreview**
> Object schedulePreview(ns)

Preview when a cron expression fires

Validates the expression exactly as saving would and returns its next firings, so a form can show \&quot;is that what I meant?\&quot; before anything is saved.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.schedulePreview(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#schedulePreview");
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

<a id="scheduleRemove"></a>
# **scheduleRemove**
> scheduleRemove(ns, name)

Delete a schedule

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      apiInstance.scheduleRemove(ns, name);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleRemove");
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

<a id="scheduleResume"></a>
# **scheduleResume**
> Object scheduleResume(ns, name)

Resume a schedule

Resumes from now, not from the backlog: pausing is an instruction not to run, not a request to defer.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.scheduleResume(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleResume");
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

<a id="scheduleRuns"></a>
# **scheduleRuns**
> Object scheduleRuns(ns, name)

A schedule’s firing history

Newest first: each firing’s occurrence, when it fired, and whether it started a run (with that run’s status now), was skipped because the previous run was still going, or failed to start. Kept for 30 days. Page with &#x60;before&#x60; set to the previous page’s &#x60;nextCursor&#x60;; filter with &#x60;outcome&#x60;.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.scheduleRuns(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleRuns");
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

<a id="scheduleUpdate"></a>
# **scheduleUpdate**
> Object scheduleUpdate(ns, name)

Update a schedule

Replaces its settings and keeps its run history. The next run is recomputed from now, so a changed expression never fires on the old timetable.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.SchedulesApi;

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

    SchedulesApi apiInstance = new SchedulesApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.scheduleUpdate(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling SchedulesApi#scheduleUpdate");
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

