# AuthCreateApiKeyRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Scopes** | Pointer to **[]string** |  | [optional] [default to []]
**ExpiresAt** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewAuthCreateApiKeyRequest

`func NewAuthCreateApiKeyRequest(name string, ) *AuthCreateApiKeyRequest`

NewAuthCreateApiKeyRequest instantiates a new AuthCreateApiKeyRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAuthCreateApiKeyRequestWithDefaults

`func NewAuthCreateApiKeyRequestWithDefaults() *AuthCreateApiKeyRequest`

NewAuthCreateApiKeyRequestWithDefaults instantiates a new AuthCreateApiKeyRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *AuthCreateApiKeyRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *AuthCreateApiKeyRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *AuthCreateApiKeyRequest) SetName(v string)`

SetName sets Name field to given value.


### GetScopes

`func (o *AuthCreateApiKeyRequest) GetScopes() []string`

GetScopes returns the Scopes field if non-nil, zero value otherwise.

### GetScopesOk

`func (o *AuthCreateApiKeyRequest) GetScopesOk() (*[]string, bool)`

GetScopesOk returns a tuple with the Scopes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetScopes

`func (o *AuthCreateApiKeyRequest) SetScopes(v []string)`

SetScopes sets Scopes field to given value.

### HasScopes

`func (o *AuthCreateApiKeyRequest) HasScopes() bool`

HasScopes returns a boolean if a field has been set.

### GetExpiresAt

`func (o *AuthCreateApiKeyRequest) GetExpiresAt() time.Time`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *AuthCreateApiKeyRequest) GetExpiresAtOk() (*time.Time, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *AuthCreateApiKeyRequest) SetExpiresAt(v time.Time)`

SetExpiresAt sets ExpiresAt field to given value.

### HasExpiresAt

`func (o *AuthCreateApiKeyRequest) HasExpiresAt() bool`

HasExpiresAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


