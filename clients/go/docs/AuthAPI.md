# \AuthAPI

All URIs are relative to *http://localhost*

Method | HTTP request | Description
------------- | ------------- | -------------
[**AuthCreateApiKey**](AuthAPI.md#AuthCreateApiKey) | **Post** /v1/auth/api-keys | Create an API key
[**AuthCreateServiceAccount**](AuthAPI.md#AuthCreateServiceAccount) | **Post** /v1/auth/service-accounts | Create a service account
[**AuthDisableServiceAccount**](AuthAPI.md#AuthDisableServiceAccount) | **Delete** /v1/auth/service-accounts/{id} | DELETE /v1/auth/service-accounts/{id}
[**AuthListApiKeys**](AuthAPI.md#AuthListApiKeys) | **Get** /v1/auth/api-keys | GET /v1/auth/api-keys
[**AuthListServiceAccounts**](AuthAPI.md#AuthListServiceAccounts) | **Get** /v1/auth/service-accounts | GET /v1/auth/service-accounts
[**AuthMe**](AuthAPI.md#AuthMe) | **Get** /v1/auth/me | Who the caller is
[**AuthRevokeApiKey**](AuthAPI.md#AuthRevokeApiKey) | **Delete** /v1/auth/api-keys/{id} | DELETE /v1/auth/api-keys/{id}
[**AuthToken**](AuthAPI.md#AuthToken) | **Post** /v1/auth/token | Exchange a service-account key and secret for a short-lived token
[**AuthWhoami**](AuthAPI.md#AuthWhoami) | **Get** /v1/auth/whoami | The caller as the server sees them, including scopes
[**SamlCallback**](AuthAPI.md#SamlCallback) | **Post** /v1/auth/saml/{provider}/callback | Complete a SAML login
[**SamlLogin**](AuthAPI.md#SamlLogin) | **Get** /v1/auth/saml/{provider}/login | Begin a SAML login
[**SamlMetadata**](AuthAPI.md#SamlMetadata) | **Get** /v1/auth/saml/{provider}/metadata | The service-provider metadata to upload to the identity provider
[**SsoCallback**](AuthAPI.md#SsoCallback) | **Get** /v1/auth/sso/{provider}/callback | Complete a single sign-on login
[**SsoLogin**](AuthAPI.md#SsoLogin) | **Get** /v1/auth/sso/{provider}/login | Begin a single sign-on login
[**SsoProviders**](AuthAPI.md#SsoProviders) | **Get** /v1/auth/sso/providers | List the identity providers configured for sign-in
[**UserChangePassword**](AuthAPI.md#UserChangePassword) | **Post** /v1/ns/{ns}/users/change-password | Change your own password
[**UserCreateUser**](AuthAPI.md#UserCreateUser) | **Post** /v1/ns/{ns}/users | Create a user
[**UserDisableUser**](AuthAPI.md#UserDisableUser) | **Delete** /v1/ns/{ns}/users/{id} | Disable a user
[**UserListUsers**](AuthAPI.md#UserListUsers) | **Get** /v1/ns/{ns}/users | List users
[**UserLogin**](AuthAPI.md#UserLogin) | **Post** /v1/ns/{ns}/users/login | Log in with email and password
[**UserLogout**](AuthAPI.md#UserLogout) | **Post** /v1/ns/{ns}/users/logout | End the current session
[**UserLogoutEverywhere**](AuthAPI.md#UserLogoutEverywhere) | **Post** /v1/ns/{ns}/users/logout-all | End every session for the current user
[**WorkloadIdentityBind**](AuthAPI.md#WorkloadIdentityBind) | **Post** /v1/ns/{ns}/workload-identities | Bind a certificate or workload token to a service account
[**WorkloadIdentityList**](AuthAPI.md#WorkloadIdentityList) | **Get** /v1/ns/{ns}/workload-identities | List workload identity bindings
[**WorkloadIdentityUnbind**](AuthAPI.md#WorkloadIdentityUnbind) | **Delete** /v1/ns/{ns}/workload-identities/{id} | Remove a binding



## AuthCreateApiKey

> interface{} AuthCreateApiKey(ctx).AuthCreateApiKeyRequest(authCreateApiKeyRequest).Execute()

Create an API key



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	authCreateApiKeyRequest := *openapiclient.NewAuthCreateApiKeyRequest("Name_example") // AuthCreateApiKeyRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthCreateApiKey(context.Background()).AuthCreateApiKeyRequest(authCreateApiKeyRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthCreateApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthCreateApiKey`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthCreateApiKey`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiAuthCreateApiKeyRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **authCreateApiKeyRequest** | [**AuthCreateApiKeyRequest**](AuthCreateApiKeyRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthCreateServiceAccount

> interface{} AuthCreateServiceAccount(ctx).AuthCreateServiceAccountRequest(authCreateServiceAccountRequest).Execute()

Create a service account



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	authCreateServiceAccountRequest := *openapiclient.NewAuthCreateServiceAccountRequest("Name_example") // AuthCreateServiceAccountRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthCreateServiceAccount(context.Background()).AuthCreateServiceAccountRequest(authCreateServiceAccountRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthCreateServiceAccount``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthCreateServiceAccount`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthCreateServiceAccount`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiAuthCreateServiceAccountRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **authCreateServiceAccountRequest** | [**AuthCreateServiceAccountRequest**](AuthCreateServiceAccountRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthDisableServiceAccount

> AuthDisableServiceAccount(ctx, id).Execute()

DELETE /v1/auth/service-accounts/{id}

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.AuthDisableServiceAccount(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthDisableServiceAccount``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiAuthDisableServiceAccountRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthListApiKeys

> interface{} AuthListApiKeys(ctx).Execute()

GET /v1/auth/api-keys

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthListApiKeys(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthListApiKeys``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthListApiKeys`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthListApiKeys`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiAuthListApiKeysRequest struct via the builder pattern


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthListServiceAccounts

> interface{} AuthListServiceAccounts(ctx).Execute()

GET /v1/auth/service-accounts

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthListServiceAccounts(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthListServiceAccounts``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthListServiceAccounts`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthListServiceAccounts`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiAuthListServiceAccountsRequest struct via the builder pattern


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthMe

> interface{} AuthMe(ctx).Execute()

Who the caller is



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthMe(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthMe``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthMe`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthMe`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiAuthMeRequest struct via the builder pattern


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthRevokeApiKey

> AuthRevokeApiKey(ctx, id).Execute()

DELETE /v1/auth/api-keys/{id}

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.AuthRevokeApiKey(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthRevokeApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiAuthRevokeApiKeyRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthToken

> interface{} AuthToken(ctx).AuthTokenRequest(authTokenRequest).Execute()

Exchange a service-account key and secret for a short-lived token

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	authTokenRequest := *openapiclient.NewAuthTokenRequest("KeyId_example", "Secret_example") // AuthTokenRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthToken(context.Background()).AuthTokenRequest(authTokenRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthToken``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthToken`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthToken`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiAuthTokenRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **authTokenRequest** | [**AuthTokenRequest**](AuthTokenRequest.md) |  | 

### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## AuthWhoami

> interface{} AuthWhoami(ctx).Execute()

The caller as the server sees them, including scopes

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.AuthWhoami(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.AuthWhoami``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `AuthWhoami`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.AuthWhoami`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiAuthWhoamiRequest struct via the builder pattern


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SamlCallback

> interface{} SamlCallback(ctx, provider).Execute()

Complete a SAML login



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	provider := "provider_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SamlCallback(context.Background(), provider).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SamlCallback``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SamlCallback`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SamlCallback`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**provider** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSamlCallbackRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SamlLogin

> interface{} SamlLogin(ctx, provider).Execute()

Begin a SAML login



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	provider := "provider_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SamlLogin(context.Background(), provider).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SamlLogin``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SamlLogin`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SamlLogin`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**provider** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSamlLoginRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SamlMetadata

> interface{} SamlMetadata(ctx, provider).Execute()

The service-provider metadata to upload to the identity provider



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	provider := "provider_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SamlMetadata(context.Background(), provider).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SamlMetadata``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SamlMetadata`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SamlMetadata`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**provider** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSamlMetadataRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SsoCallback

> interface{} SsoCallback(ctx, provider).Execute()

Complete a single sign-on login



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	provider := "provider_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SsoCallback(context.Background(), provider).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SsoCallback``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SsoCallback`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SsoCallback`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**provider** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSsoCallbackRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SsoLogin

> interface{} SsoLogin(ctx, provider).Execute()

Begin a single sign-on login



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	provider := "provider_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SsoLogin(context.Background(), provider).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SsoLogin``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SsoLogin`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SsoLogin`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**provider** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiSsoLoginRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## SsoProviders

> interface{} SsoProviders(ctx).Execute()

List the identity providers configured for sign-in



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.SsoProviders(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.SsoProviders``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `SsoProviders`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.SsoProviders`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiSsoProvidersRequest struct via the builder pattern


### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserChangePassword

> UserChangePassword(ctx, ns).UserChangePasswordRequest(userChangePasswordRequest).Execute()

Change your own password



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	userChangePasswordRequest := *openapiclient.NewUserChangePasswordRequest("CurrentPassword_example", "NewPassword_example") // UserChangePasswordRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.UserChangePassword(context.Background(), ns).UserChangePasswordRequest(userChangePasswordRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserChangePassword``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserChangePasswordRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **userChangePasswordRequest** | [**UserChangePasswordRequest**](UserChangePasswordRequest.md) |  | 

### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserCreateUser

> interface{} UserCreateUser(ctx, ns).UserCreateUserRequest(userCreateUserRequest).Execute()

Create a user



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	userCreateUserRequest := *openapiclient.NewUserCreateUserRequest("Email_example", "Name_example", "Password_example") // UserCreateUserRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.UserCreateUser(context.Background(), ns).UserCreateUserRequest(userCreateUserRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserCreateUser``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UserCreateUser`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.UserCreateUser`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserCreateUserRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **userCreateUserRequest** | [**UserCreateUserRequest**](UserCreateUserRequest.md) |  | 

### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserDisableUser

> UserDisableUser(ctx, ns, id).Execute()

Disable a user



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.UserDisableUser(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserDisableUser``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserDisableUserRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserListUsers

> interface{} UserListUsers(ctx, ns).Execute()

List users

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.UserListUsers(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserListUsers``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UserListUsers`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.UserListUsers`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserListUsersRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserLogin

> interface{} UserLogin(ctx, ns).UserLoginRequest(userLoginRequest).Execute()

Log in with email and password



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	userLoginRequest := *openapiclient.NewUserLoginRequest("Email_example", "Password_example") // UserLoginRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.UserLogin(context.Background(), ns).UserLoginRequest(userLoginRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserLogin``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UserLogin`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.UserLogin`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserLoginRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **userLoginRequest** | [**UserLoginRequest**](UserLoginRequest.md) |  | 

### Return type

**interface{}**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserLogout

> UserLogout(ctx, ns).Execute()

End the current session

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.UserLogout(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserLogout``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserLogoutRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## UserLogoutEverywhere

> interface{} UserLogoutEverywhere(ctx, ns).Execute()

End every session for the current user

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.UserLogoutEverywhere(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.UserLogoutEverywhere``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `UserLogoutEverywhere`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.UserLogoutEverywhere`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiUserLogoutEverywhereRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## WorkloadIdentityBind

> interface{} WorkloadIdentityBind(ctx, ns).Execute()

Bind a certificate or workload token to a service account



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.WorkloadIdentityBind(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.WorkloadIdentityBind``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `WorkloadIdentityBind`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.WorkloadIdentityBind`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiWorkloadIdentityBindRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## WorkloadIdentityList

> interface{} WorkloadIdentityList(ctx, ns).Execute()

List workload identity bindings



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.AuthAPI.WorkloadIdentityList(context.Background(), ns).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.WorkloadIdentityList``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `WorkloadIdentityList`: interface{}
	fmt.Fprintf(os.Stdout, "Response from `AuthAPI.WorkloadIdentityList`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 

### Other Parameters

Other parameters are passed through a pointer to a apiWorkloadIdentityListRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

**interface{}**

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## WorkloadIdentityUnbind

> WorkloadIdentityUnbind(ctx, ns, id).Execute()

Remove a binding

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/node-flow/node-flow-go/nodeflow"
)

func main() {
	ns := "ns_example" // string | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one.
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.AuthAPI.WorkloadIdentityUnbind(context.Background(), ns, id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `AuthAPI.WorkloadIdentityUnbind``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**ns** | **string** | Namespace slug. Must match the namespace of the credential, or the request is refused — it does not select one. | 
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiWorkloadIdentityUnbindRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------



### Return type

 (empty response body)

### Authorization

[apiKey](../README.md#apiKey), [bearer](../README.md#bearer)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

