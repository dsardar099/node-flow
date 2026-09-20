# StatusListenerCreateRequestConfigAnyOf

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Url** | **string** |  | 
**SecretName** | Pointer to **string** |  | [optional] 
**Headers** | Pointer to **map[string]string** |  | [optional] 

## Methods

### NewStatusListenerCreateRequestConfigAnyOf

`func NewStatusListenerCreateRequestConfigAnyOf(url string, ) *StatusListenerCreateRequestConfigAnyOf`

NewStatusListenerCreateRequestConfigAnyOf instantiates a new StatusListenerCreateRequestConfigAnyOf object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewStatusListenerCreateRequestConfigAnyOfWithDefaults

`func NewStatusListenerCreateRequestConfigAnyOfWithDefaults() *StatusListenerCreateRequestConfigAnyOf`

NewStatusListenerCreateRequestConfigAnyOfWithDefaults instantiates a new StatusListenerCreateRequestConfigAnyOf object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetUrl

`func (o *StatusListenerCreateRequestConfigAnyOf) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *StatusListenerCreateRequestConfigAnyOf) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *StatusListenerCreateRequestConfigAnyOf) SetUrl(v string)`

SetUrl sets Url field to given value.


### GetSecretName

`func (o *StatusListenerCreateRequestConfigAnyOf) GetSecretName() string`

GetSecretName returns the SecretName field if non-nil, zero value otherwise.

### GetSecretNameOk

`func (o *StatusListenerCreateRequestConfigAnyOf) GetSecretNameOk() (*string, bool)`

GetSecretNameOk returns a tuple with the SecretName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecretName

`func (o *StatusListenerCreateRequestConfigAnyOf) SetSecretName(v string)`

SetSecretName sets SecretName field to given value.

### HasSecretName

`func (o *StatusListenerCreateRequestConfigAnyOf) HasSecretName() bool`

HasSecretName returns a boolean if a field has been set.

### GetHeaders

`func (o *StatusListenerCreateRequestConfigAnyOf) GetHeaders() map[string]string`

GetHeaders returns the Headers field if non-nil, zero value otherwise.

### GetHeadersOk

`func (o *StatusListenerCreateRequestConfigAnyOf) GetHeadersOk() (*map[string]string, bool)`

GetHeadersOk returns a tuple with the Headers field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHeaders

`func (o *StatusListenerCreateRequestConfigAnyOf) SetHeaders(v map[string]string)`

SetHeaders sets Headers field to given value.

### HasHeaders

`func (o *StatusListenerCreateRequestConfigAnyOf) HasHeaders() bool`

HasHeaders returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


