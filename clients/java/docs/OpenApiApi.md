# OpenApiApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**openApiDocument**](OpenApiApi.md#openApiDocument) | **GET** /v1/openapi.json | GET /v1/openapi.json |


<a id="openApiDocument"></a>
# **openApiDocument**
> Object openApiDocument()

GET /v1/openapi.json

### Example
```java
// Import classes:
import dev.nodeflow.client.ApiClient;
import dev.nodeflow.client.ApiException;
import dev.nodeflow.client.Configuration;
import dev.nodeflow.client.models.*;
import dev.nodeflow.client.api.OpenApiApi;

public class Example {
  public static void main(String[] args) {
    ApiClient defaultClient = Configuration.getDefaultApiClient();
    defaultClient.setBasePath("http://localhost");

    OpenApiApi apiInstance = new OpenApiApi(defaultClient);
    try {
      Object result = apiInstance.openApiDocument();
      System.out.println(result);
    } catch (ApiException e) {
      System.err.println("Exception when calling OpenApiApi#openApiDocument");
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

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Success |  -  |

