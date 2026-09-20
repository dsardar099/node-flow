# HumanTasksApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**humanTaskClaim**](HumanTasksApi.md#humanTaskClaim) | **POST** /v1/ns/{ns}/human-tasks/{id}/claim | Take possession of a human task |
| [**humanTaskComplete**](HumanTasksApi.md#humanTaskComplete) | **POST** /v1/ns/{ns}/human-tasks/{id}/complete | Complete a human task and let the workflow continue |
| [**humanTaskGet**](HumanTasksApi.md#humanTaskGet) | **GET** /v1/ns/{ns}/human-tasks/{id} | Fetch one human task |
| [**humanTaskInbox**](HumanTasksApi.md#humanTaskInbox) | **GET** /v1/ns/{ns}/human-tasks | List the human tasks this user can act on |
| [**humanTaskReassign**](HumanTasksApi.md#humanTaskReassign) | **POST** /v1/ns/{ns}/human-tasks/{id}/reassign | Replace who a human task is assigned to |
| [**humanTaskRelease**](HumanTasksApi.md#humanTaskRelease) | **POST** /v1/ns/{ns}/human-tasks/{id}/release | Give a claimed task back to the pool |
| [**humanTaskSearch**](HumanTasksApi.md#humanTaskSearch) | **GET** /v1/ns/{ns}/human-tasks/search | Search every human task in the namespace |
| [**humanTaskSkip**](HumanTasksApi.md#humanTaskSkip) | **POST** /v1/ns/{ns}/human-tasks/{id}/skip | Skip a human task |


<a id="humanTaskClaim"></a>
# **humanTaskClaim**
> Object humanTaskClaim(ns, id)

Take possession of a human task

Single-winner: two people claiming the same task at the same moment resolve to one, and the loser is told rather than both starting work.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskClaim(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskClaim");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="humanTaskComplete"></a>
# **humanTaskComplete**
> Object humanTaskComplete(ns, id)

Complete a human task and let the workflow continue

Requires holding the claim. Without that, one person’s answer could silently replace another’s on a task they were actively working.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskComplete(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskComplete");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="humanTaskGet"></a>
# **humanTaskGet**
> Object humanTaskGet(ns, id)

Fetch one human task

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskGet(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskGet");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="humanTaskInbox"></a>
# **humanTaskInbox**
> Object humanTaskInbox(ns)

List the human tasks this user can act on

Assigned to them, held by them, or unassigned and free to claim. Never another person&#39;s assignment, and never something someone else holds.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.humanTaskInbox(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskInbox");
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

<a id="humanTaskReassign"></a>
# **humanTaskReassign**
> Object humanTaskReassign(ns, id)

Replace who a human task is assigned to

An operator action. Takes an assignment chain — &#x60;[{ \&quot;user\&quot;: \&quot;email\&quot;, \&quot;slaMinutes\&quot;: 30 }, { \&quot;group\&quot;: \&quot;name\&quot; }]&#x60; — and releases any claim, so nobody keeps working a task that was moved away from them.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskReassign(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskReassign");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="humanTaskRelease"></a>
# **humanTaskRelease**
> Object humanTaskRelease(ns, id)

Give a claimed task back to the pool

The assignment is left intact — releasing is not reassigning.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskRelease(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskRelease");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

<a id="humanTaskSearch"></a>
# **humanTaskSearch**
> Object humanTaskSearch(ns)

Search every human task in the namespace

The operator view: what is waiting, with whom, and for how long — across assignees, unlike the inbox. &#x60;state&#x60; is open (default), unclaimed, claimed, completed or all; &#x60;assignee&#x60; is an email, &#x60;group&#x60; a group name. Tasks of workflows the caller’s tags cannot reach are left out.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.humanTaskSearch(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskSearch");
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

<a id="humanTaskSkip"></a>
# **humanTaskSkip**
> Object humanTaskSkip(ns, id)

Skip a human task

The workflow continues as if the task completed; the reason is recorded in its output.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.HumanTasksApi;

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

    HumanTasksApi apiInstance = new HumanTasksApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String id = "id_example"; // String | 
    try {
      Object result = apiInstance.humanTaskSkip(ns, id);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling HumanTasksApi#humanTaskSkip");
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
| **200** | Success |  -  |
| **401** | No or invalid credentials |  -  |
| **403** | Authenticated, but missing a required scope |  -  |

