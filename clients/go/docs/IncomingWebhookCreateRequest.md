# IncomingWebhookCreateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Description** | Pointer to **NullableString** |  | [optional] 
**Verifier** | **string** |  | 
**Config** | Pointer to [**IncomingWebhookCreateRequestConfig**](IncomingWebhookCreateRequestConfig.md) |  | [optional] 
**SecretName** | Pointer to **string** |  | [optional] 
**Enabled** | Pointer to **bool** |  | [optional] 

## Methods

### NewIncomingWebhookCreateRequest

`func NewIncomingWebhookCreateRequest(name string, verifier string, ) *IncomingWebhookCreateRequest`

NewIncomingWebhookCreateRequest instantiates a new IncomingWebhookCreateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewIncomingWebhookCreateRequestWithDefaults

`func NewIncomingWebhookCreateRequestWithDefaults() *IncomingWebhookCreateRequest`

NewIncomingWebhookCreateRequestWithDefaults instantiates a new IncomingWebhookCreateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *IncomingWebhookCreateRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *IncomingWebhookCreateRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *IncomingWebhookCreateRequest) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *IncomingWebhookCreateRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *IncomingWebhookCreateRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *IncomingWebhookCreateRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *IncomingWebhookCreateRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### SetDescriptionNil

`func (o *IncomingWebhookCreateRequest) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *IncomingWebhookCreateRequest) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetVerifier

`func (o *IncomingWebhookCreateRequest) GetVerifier() string`

GetVerifier returns the Verifier field if non-nil, zero value otherwise.

### GetVerifierOk

`func (o *IncomingWebhookCreateRequest) GetVerifierOk() (*string, bool)`

GetVerifierOk returns a tuple with the Verifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerifier

`func (o *IncomingWebhookCreateRequest) SetVerifier(v string)`

SetVerifier sets Verifier field to given value.


### GetConfig

`func (o *IncomingWebhookCreateRequest) GetConfig() IncomingWebhookCreateRequestConfig`

GetConfig returns the Config field if non-nil, zero value otherwise.

### GetConfigOk

`func (o *IncomingWebhookCreateRequest) GetConfigOk() (*IncomingWebhookCreateRequestConfig, bool)`

GetConfigOk returns a tuple with the Config field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConfig

`func (o *IncomingWebhookCreateRequest) SetConfig(v IncomingWebhookCreateRequestConfig)`

SetConfig sets Config field to given value.

### HasConfig

`func (o *IncomingWebhookCreateRequest) HasConfig() bool`

HasConfig returns a boolean if a field has been set.

### GetSecretName

`func (o *IncomingWebhookCreateRequest) GetSecretName() string`

GetSecretName returns the SecretName field if non-nil, zero value otherwise.

### GetSecretNameOk

`func (o *IncomingWebhookCreateRequest) GetSecretNameOk() (*string, bool)`

GetSecretNameOk returns a tuple with the SecretName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecretName

`func (o *IncomingWebhookCreateRequest) SetSecretName(v string)`

SetSecretName sets SecretName field to given value.

### HasSecretName

`func (o *IncomingWebhookCreateRequest) HasSecretName() bool`

HasSecretName returns a boolean if a field has been set.

### GetEnabled

`func (o *IncomingWebhookCreateRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *IncomingWebhookCreateRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *IncomingWebhookCreateRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *IncomingWebhookCreateRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


