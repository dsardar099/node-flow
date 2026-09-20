# AuthTokenRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**KeyId** | **string** |  | 
**Secret** | **string** |  | 

## Methods

### NewAuthTokenRequest

`func NewAuthTokenRequest(keyId string, secret string, ) *AuthTokenRequest`

NewAuthTokenRequest instantiates a new AuthTokenRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewAuthTokenRequestWithDefaults

`func NewAuthTokenRequestWithDefaults() *AuthTokenRequest`

NewAuthTokenRequestWithDefaults instantiates a new AuthTokenRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetKeyId

`func (o *AuthTokenRequest) GetKeyId() string`

GetKeyId returns the KeyId field if non-nil, zero value otherwise.

### GetKeyIdOk

`func (o *AuthTokenRequest) GetKeyIdOk() (*string, bool)`

GetKeyIdOk returns a tuple with the KeyId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetKeyId

`func (o *AuthTokenRequest) SetKeyId(v string)`

SetKeyId sets KeyId field to given value.


### GetSecret

`func (o *AuthTokenRequest) GetSecret() string`

GetSecret returns the Secret field if non-nil, zero value otherwise.

### GetSecretOk

`func (o *AuthTokenRequest) GetSecretOk() (*string, bool)`

GetSecretOk returns a tuple with the Secret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecret

`func (o *AuthTokenRequest) SetSecret(v string)`

SetSecret sets Secret field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


