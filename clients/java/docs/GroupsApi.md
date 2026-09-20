# GroupsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**groupAddMember**](GroupsApi.md#groupAddMember) | **POST** /v1/ns/{ns}/groups/{name}/members | Add someone to a group |
| [**groupCreate**](GroupsApi.md#groupCreate) | **POST** /v1/ns/{ns}/groups | Create a group |
| [**groupGet**](GroupsApi.md#groupGet) | **GET** /v1/ns/{ns}/groups/{name} | Fetch a group and its members |
| [**groupList**](GroupsApi.md#groupList) | **GET** /v1/ns/{ns}/groups | List groups |
| [**groupRemove**](GroupsApi.md#groupRemove) | **DELETE** /v1/ns/{ns}/groups/{name} | Delete a group |
| [**groupRemoveMember**](GroupsApi.md#groupRemoveMember) | **DELETE** /v1/ns/{ns}/groups/{name}/members/{userId} | Remove someone from a group |
| [**groupSetScopes**](GroupsApi.md#groupSetScopes) | **PUT** /v1/ns/{ns}/groups/{name}/scopes | Replace a group’s scopes |
| [**groupSetTagGrants**](GroupsApi.md#groupSetTagGrants) | **PUT** /v1/ns/{ns}/groups/{name}/tag-grants | Replace the tag patterns this group’s members may reach |


<a id="groupAddMember"></a>
# **groupAddMember**
> groupAddMember(ns, name)

Add someone to a group

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      apiInstance.groupAddMember(ns, name);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupAddMember");
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

<a id="groupCreate"></a>
# **groupCreate**
> Object groupCreate(ns)

Create a group

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.groupCreate(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupCreate");
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

<a id="groupGet"></a>
# **groupGet**
> Object groupGet(ns, name)

Fetch a group and its members

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.groupGet(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupGet");
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

<a id="groupList"></a>
# **groupList**
> Object groupList(ns)

List groups

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    try {
      Object result = apiInstance.groupList(ns);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupList");
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

<a id="groupRemove"></a>
# **groupRemove**
> groupRemove(ns, name)

Delete a group

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      apiInstance.groupRemove(ns, name);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupRemove");
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

<a id="groupRemoveMember"></a>
# **groupRemoveMember**
> groupRemoveMember(ns, name, userId)

Remove someone from a group

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    String userId = "userId_example"; // String | 
    try {
      apiInstance.groupRemoveMember(ns, name, userId);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupRemoveMember");
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
| **userId** | **String**|  | |

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

<a id="groupSetScopes"></a>
# **groupSetScopes**
> Object groupSetScopes(ns, name)

Replace a group’s scopes

Takes effect for every member on their next request, since a principal resolves its scopes each time rather than caching them into a session.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.groupSetScopes(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupSetScopes");
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

<a id="groupSetTagGrants"></a>
# **groupSetTagGrants**
> Object groupSetTagGrants(ns, name)

Replace the tag patterns this group’s members may reach

Tags restrict, they never grant: an untagged resource is governed by scopes alone, and a tagged one additionally needs a matching grant. Patterns match literally or by trailing wildcard, exactly like scopes.

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.auth.*;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.GroupsApi;

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

    GroupsApi apiInstance = new GroupsApi(defaultClient);
    String ns = "ns_example"; // String | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
    String name = "name_example"; // String | 
    try {
      Object result = apiInstance.groupSetTagGrants(ns, name);
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling GroupsApi#groupSetTagGrants");
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

