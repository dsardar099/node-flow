# OperationsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**executionBulk**](OperationsApi.md#executionBulk) | **POST** /v1/ns/{ns}/executions/bulk/{action} | Pause, resume, retry or terminate many executions |
| [**executionDecide**](OperationsApi.md#executionDecide) | **POST** /v1/ns/{ns}/executions/{id}/decide | Force an evaluation — an escape hatch and a diagnostic |
| [**executionPause**](OperationsApi.md#executionPause) | **POST** /v1/ns/{ns}/executions/{id}/pause | Stop scheduling new tasks |
| [**executionRerun**](OperationsApi.md#executionRerun) | **POST** /v1/ns/{ns}/executions/{id}/rerun | Discard from a task onward and run again from there |
| [**executionResume**](OperationsApi.md#executionResume) | **POST** /v1/ns/{ns}/executions/{id}/resume | Resume a paused execution |
| [**executionRetry**](OperationsApi.md#executionRetry) | **POST** /v1/ns/{ns}/executions/{id}/retry | Re-run the failed tasks of a terminal execution |
| [**executionSkipTask**](OperationsApi.md#executionSkipTask) | **POST** /v1/ns/{ns}/executions/{id}/skip-task | Skip a scheduled task without running it |
| [**executionTerminate**](OperationsApi.md#executionTerminate) | **POST** /v1/ns/{ns}/executions/{id}/terminate | End an execution and release everything it holds |
| [**metricsScrape**](OperationsApi.md#metricsScrape) | **GET** /v1/metrics | Prometheus exposition |


<a id="executionBulk"></a>
# **executionBulk**
> Object executionBulk(ns, action, executionBulkRequest)

Pause, resume, retry or terminate many executions

Up to 1000 ids. Answers which succeeded and why each of the rest did not.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String action = "action_example"; // String | 
    ExecutionBulkRequest executionBulkRequest = new ExecutionBulkRequest(); // ExecutionBulkRequest | 
    try {
      Object result = apiInstance.executionBulk(ns, action, executionBulkRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionBulk");
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
| **action** | **String**|  | |
| **executionBulkRequest** | [**ExecutionBulkRequest**](ExecutionBulkRequest.md)|  | |

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

<a id="executionDecide"></a>
# **executionDecide**
> Object executionDecide(ns, id)

Force an evaluation — an escape hatch and a diagnostic

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.executionDecide(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionDecide");
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
| **id** | **String**|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionPause"></a>
# **executionPause**
> Object executionPause(ns, id)

Stop scheduling new tasks

Tasks already queued or leased are not recalled; they run to completion.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.executionPause(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionPause");
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
| **id** | **String**|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionRerun"></a>
# **executionRerun**
> Object executionRerun(ns, id, executionRerunRequest)

Discard from a task onward and run again from there

For a task that succeeded but produced the wrong answer.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    ExecutionRerunRequest executionRerunRequest = new ExecutionRerunRequest(); // ExecutionRerunRequest | 
    try {
      Object result = apiInstance.executionRerun(ns, id, executionRerunRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionRerun");
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
| **id** | **String**|  | |
| **executionRerunRequest** | [**ExecutionRerunRequest**](ExecutionRerunRequest.md)|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionResume"></a>
# **executionResume**
> Object executionResume(ns, id)

Resume a paused execution

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.executionResume(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionResume");
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
| **id** | **String**|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionRetry"></a>
# **executionRetry**
> Object executionRetry(ns, id)

Re-run the failed tasks of a terminal execution

Successful tasks keep their results; only failures are reopened.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.executionRetry(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionRetry");
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
| **id** | **String**|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionSkipTask"></a>
# **executionSkipTask**
> Object executionSkipTask(ns, id, executionSkipTaskRequest)

Skip a scheduled task without running it

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    ExecutionSkipTaskRequest executionSkipTaskRequest = new ExecutionSkipTaskRequest(); // ExecutionSkipTaskRequest | 
    try {
      Object result = apiInstance.executionSkipTask(ns, id, executionSkipTaskRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionSkipTask");
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
| **id** | **String**|  | |
| **executionSkipTaskRequest** | [**ExecutionSkipTaskRequest**](ExecutionSkipTaskRequest.md)|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="executionTerminate"></a>
# **executionTerminate**
> Object executionTerminate(ns, id, executionTerminateRequest)

End an execution and release everything it holds

Cancels live tasks, purges queue entries, disarms timers, frees permits.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    ExecutionTerminateRequest executionTerminateRequest = new ExecutionTerminateRequest(); // ExecutionTerminateRequest | 
    try {
      Object result = apiInstance.executionTerminate(ns, id, executionTerminateRequest);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#executionTerminate");
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
| **id** | **String**|  | |
| **executionTerminateRequest** | [**ExecutionTerminateRequest**](ExecutionTerminateRequest.md)|  | |

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
| **202** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="metricsScrape"></a>
# **metricsScrape**
> Object metricsScrape()

Prometheus exposition

Requires the &#x60;metrics:read&#x60; scope. Alert on decide_queue_oldest_seconds, timers_overdue and outbox_dead_lettered — each moves before users notice.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OperationsApi;

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

    OperationsApi apiInstance = new OperationsApi(defaultClient);
    try {
      Object result = apiInstance.metricsScrape();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OperationsApi#metricsScrape");
      System.err.println("Status code: " + e.getCode());
      System.err.println("Reason: " + e.getResponseBody());
      System.err.println("Response headers: " + e.getResponseHeaders());
      e.printStackTrace();
    }
  }
}
```

### Parameters
This endpoint does not need any parameter.

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

