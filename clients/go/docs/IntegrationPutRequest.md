# IntegrationPutRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Kind** | **string** |  | 
**Provider** | **string** |  | 
**Description** | Pointer to **NullableString** |  | [optional] 
**BaseUrl** | Pointer to **NullableString** |  | [optional] 
**ApiKeySecret** | Pointer to **NullableString** |  | [optional] 
**Models** | Pointer to **[]string** |  | [optional] 
**Config** | Pointer to **map[string]interface{}** |  | [optional] 
**Enabled** | Pointer to **bool** |  | [optional] 

## Methods

### NewIntegrationPutRequest

`func NewIntegrationPutRequest(kind string, provider string, ) *IntegrationPutRequest`

NewIntegrationPutRequest instantiates a new IntegrationPutRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewIntegrationPutRequestWithDefaults

`func NewIntegrationPutRequestWithDefaults() *IntegrationPutRequest`

NewIntegrationPutRequestWithDefaults instantiates a new IntegrationPutRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetKind

`func (o *IntegrationPutRequest) GetKind() string`

GetKind returns the Kind field if non-nil, zero value otherwise.

### GetKindOk

`func (o *IntegrationPutRequest) GetKindOk() (*string, bool)`

GetKindOk returns a tuple with the Kind field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetKind

`func (o *IntegrationPutRequest) SetKind(v string)`

SetKind sets Kind field to given value.


### GetProvider

`func (o *IntegrationPutRequest) GetProvider() string`

GetProvider returns the Provider field if non-nil, zero value otherwise.

### GetProviderOk

`func (o *IntegrationPutRequest) GetProviderOk() (*string, bool)`

GetProviderOk returns a tuple with the Provider field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetProvider

`func (o *IntegrationPutRequest) SetProvider(v string)`

SetProvider sets Provider field to given value.


### GetDescription

`func (o *IntegrationPutRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *IntegrationPutRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *IntegrationPutRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *IntegrationPutRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### SetDescriptionNil

`func (o *IntegrationPutRequest) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *IntegrationPutRequest) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetBaseUrl

`func (o *IntegrationPutRequest) GetBaseUrl() string`

GetBaseUrl returns the BaseUrl field if non-nil, zero value otherwise.

### GetBaseUrlOk

`func (o *IntegrationPutRequest) GetBaseUrlOk() (*string, bool)`

GetBaseUrlOk returns a tuple with the BaseUrl field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBaseUrl

`func (o *IntegrationPutRequest) SetBaseUrl(v string)`

SetBaseUrl sets BaseUrl field to given value.

### HasBaseUrl

`func (o *IntegrationPutRequest) HasBaseUrl() bool`

HasBaseUrl returns a boolean if a field has been set.

### SetBaseUrlNil

`func (o *IntegrationPutRequest) SetBaseUrlNil(b bool)`

 SetBaseUrlNil sets the value for BaseUrl to be an explicit nil

### UnsetBaseUrl
`func (o *IntegrationPutRequest) UnsetBaseUrl()`

UnsetBaseUrl ensures that no value is present for BaseUrl, not even an explicit nil
### GetApiKeySecret

`func (o *IntegrationPutRequest) GetApiKeySecret() string`

GetApiKeySecret returns the ApiKeySecret field if non-nil, zero value otherwise.

### GetApiKeySecretOk

`func (o *IntegrationPutRequest) GetApiKeySecretOk() (*string, bool)`

GetApiKeySecretOk returns a tuple with the ApiKeySecret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiKeySecret

`func (o *IntegrationPutRequest) SetApiKeySecret(v string)`

SetApiKeySecret sets ApiKeySecret field to given value.

### HasApiKeySecret

`func (o *IntegrationPutRequest) HasApiKeySecret() bool`

HasApiKeySecret returns a boolean if a field has been set.

### SetApiKeySecretNil

`func (o *IntegrationPutRequest) SetApiKeySecretNil(b bool)`

 SetApiKeySecretNil sets the value for ApiKeySecret to be an explicit nil

### UnsetApiKeySecret
`func (o *IntegrationPutRequest) UnsetApiKeySecret()`

UnsetApiKeySecret ensures that no value is present for ApiKeySecret, not even an explicit nil
### GetModels

`func (o *IntegrationPutRequest) GetModels() []string`

GetModels returns the Models field if non-nil, zero value otherwise.

### GetModelsOk

`func (o *IntegrationPutRequest) GetModelsOk() (*[]string, bool)`

GetModelsOk returns a tuple with the Models field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetModels

`func (o *IntegrationPutRequest) SetModels(v []string)`

SetModels sets Models field to given value.

### HasModels

`func (o *IntegrationPutRequest) HasModels() bool`

HasModels returns a boolean if a field has been set.

### GetConfig

`func (o *IntegrationPutRequest) GetConfig() map[string]interface{}`

GetConfig returns the Config field if non-nil, zero value otherwise.

### GetConfigOk

`func (o *IntegrationPutRequest) GetConfigOk() (*map[string]interface{}, bool)`

GetConfigOk returns a tuple with the Config field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConfig

`func (o *IntegrationPutRequest) SetConfig(v map[string]interface{})`

SetConfig sets Config field to given value.

### HasConfig

`func (o *IntegrationPutRequest) HasConfig() bool`

HasConfig returns a boolean if a field has been set.

### GetEnabled

`func (o *IntegrationPutRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *IntegrationPutRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *IntegrationPutRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *IntegrationPutRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


