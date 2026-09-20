# IncomingWebhookUpdateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Description** | Pointer to **NullableString** |  | [optional] 
**Verifier** | **string** |  | 
**Config** | Pointer to [**IncomingWebhookCreateRequestConfig**](IncomingWebhookCreateRequestConfig.md) |  | [optional] 
**SecretName** | Pointer to **string** |  | [optional] 
**Enabled** | Pointer to **bool** |  | [optional] 

## Methods

### NewIncomingWebhookUpdateRequest

`func NewIncomingWebhookUpdateRequest(verifier string, ) *IncomingWebhookUpdateRequest`

NewIncomingWebhookUpdateRequest instantiates a new IncomingWebhookUpdateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewIncomingWebhookUpdateRequestWithDefaults

`func NewIncomingWebhookUpdateRequestWithDefaults() *IncomingWebhookUpdateRequest`

NewIncomingWebhookUpdateRequestWithDefaults instantiates a new IncomingWebhookUpdateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetDescription

`func (o *IncomingWebhookUpdateRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *IncomingWebhookUpdateRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *IncomingWebhookUpdateRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *IncomingWebhookUpdateRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### SetDescriptionNil

`func (o *IncomingWebhookUpdateRequest) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *IncomingWebhookUpdateRequest) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetVerifier

`func (o *IncomingWebhookUpdateRequest) GetVerifier() string`

GetVerifier returns the Verifier field if non-nil, zero value otherwise.

### GetVerifierOk

`func (o *IncomingWebhookUpdateRequest) GetVerifierOk() (*string, bool)`

GetVerifierOk returns a tuple with the Verifier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerifier

`func (o *IncomingWebhookUpdateRequest) SetVerifier(v string)`

SetVerifier sets Verifier field to given value.


### GetConfig

`func (o *IncomingWebhookUpdateRequest) GetConfig() IncomingWebhookCreateRequestConfig`

GetConfig returns the Config field if non-nil, zero value otherwise.

### GetConfigOk

`func (o *IncomingWebhookUpdateRequest) GetConfigOk() (*IncomingWebhookCreateRequestConfig, bool)`

GetConfigOk returns a tuple with the Config field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConfig

`func (o *IncomingWebhookUpdateRequest) SetConfig(v IncomingWebhookCreateRequestConfig)`

SetConfig sets Config field to given value.

### HasConfig

`func (o *IncomingWebhookUpdateRequest) HasConfig() bool`

HasConfig returns a boolean if a field has been set.

### GetSecretName

`func (o *IncomingWebhookUpdateRequest) GetSecretName() string`

GetSecretName returns the SecretName field if non-nil, zero value otherwise.

### GetSecretNameOk

`func (o *IncomingWebhookUpdateRequest) GetSecretNameOk() (*string, bool)`

GetSecretNameOk returns a tuple with the SecretName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecretName

`func (o *IncomingWebhookUpdateRequest) SetSecretName(v string)`

SetSecretName sets SecretName field to given value.

### HasSecretName

`func (o *IncomingWebhookUpdateRequest) HasSecretName() bool`

HasSecretName returns a boolean if a field has been set.

### GetEnabled

`func (o *IncomingWebhookUpdateRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *IncomingWebhookUpdateRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *IncomingWebhookUpdateRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *IncomingWebhookUpdateRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


