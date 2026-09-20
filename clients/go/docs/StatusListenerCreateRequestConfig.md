# StatusListenerCreateRequestConfig

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Url** | **string** |  | 
**SecretName** | Pointer to **string** |  | [optional] 
**Headers** | Pointer to **map[string]string** |  | [optional] 
**Cluster** | **string** |  | 
**Topic** | **string** |  | 
**Connection** | **string** |  | 
**Destination** | **string** |  | 

## Methods

### NewStatusListenerCreateRequestConfig

`func NewStatusListenerCreateRequestConfig(url string, cluster string, topic string, connection string, destination string, ) *StatusListenerCreateRequestConfig`

NewStatusListenerCreateRequestConfig instantiates a new StatusListenerCreateRequestConfig object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewStatusListenerCreateRequestConfigWithDefaults

`func NewStatusListenerCreateRequestConfigWithDefaults() *StatusListenerCreateRequestConfig`

NewStatusListenerCreateRequestConfigWithDefaults instantiates a new StatusListenerCreateRequestConfig object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetUrl

`func (o *StatusListenerCreateRequestConfig) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *StatusListenerCreateRequestConfig) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *StatusListenerCreateRequestConfig) SetUrl(v string)`

SetUrl sets Url field to given value.


### GetSecretName

`func (o *StatusListenerCreateRequestConfig) GetSecretName() string`

GetSecretName returns the SecretName field if non-nil, zero value otherwise.

### GetSecretNameOk

`func (o *StatusListenerCreateRequestConfig) GetSecretNameOk() (*string, bool)`

GetSecretNameOk returns a tuple with the SecretName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecretName

`func (o *StatusListenerCreateRequestConfig) SetSecretName(v string)`

SetSecretName sets SecretName field to given value.

### HasSecretName

`func (o *StatusListenerCreateRequestConfig) HasSecretName() bool`

HasSecretName returns a boolean if a field has been set.

### GetHeaders

`func (o *StatusListenerCreateRequestConfig) GetHeaders() map[string]string`

GetHeaders returns the Headers field if non-nil, zero value otherwise.

### GetHeadersOk

`func (o *StatusListenerCreateRequestConfig) GetHeadersOk() (*map[string]string, bool)`

GetHeadersOk returns a tuple with the Headers field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHeaders

`func (o *StatusListenerCreateRequestConfig) SetHeaders(v map[string]string)`

SetHeaders sets Headers field to given value.

### HasHeaders

`func (o *StatusListenerCreateRequestConfig) HasHeaders() bool`

HasHeaders returns a boolean if a field has been set.

### GetCluster

`func (o *StatusListenerCreateRequestConfig) GetCluster() string`

GetCluster returns the Cluster field if non-nil, zero value otherwise.

### GetClusterOk

`func (o *StatusListenerCreateRequestConfig) GetClusterOk() (*string, bool)`

GetClusterOk returns a tuple with the Cluster field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCluster

`func (o *StatusListenerCreateRequestConfig) SetCluster(v string)`

SetCluster sets Cluster field to given value.


### GetTopic

`func (o *StatusListenerCreateRequestConfig) GetTopic() string`

GetTopic returns the Topic field if non-nil, zero value otherwise.

### GetTopicOk

`func (o *StatusListenerCreateRequestConfig) GetTopicOk() (*string, bool)`

GetTopicOk returns a tuple with the Topic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTopic

`func (o *StatusListenerCreateRequestConfig) SetTopic(v string)`

SetTopic sets Topic field to given value.


### GetConnection

`func (o *StatusListenerCreateRequestConfig) GetConnection() string`

GetConnection returns the Connection field if non-nil, zero value otherwise.

### GetConnectionOk

`func (o *StatusListenerCreateRequestConfig) GetConnectionOk() (*string, bool)`

GetConnectionOk returns a tuple with the Connection field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConnection

`func (o *StatusListenerCreateRequestConfig) SetConnection(v string)`

SetConnection sets Connection field to given value.


### GetDestination

`func (o *StatusListenerCreateRequestConfig) GetDestination() string`

GetDestination returns the Destination field if non-nil, zero value otherwise.

### GetDestinationOk

`func (o *StatusListenerCreateRequestConfig) GetDestinationOk() (*string, bool)`

GetDestinationOk returns a tuple with the Destination field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDestination

`func (o *StatusListenerCreateRequestConfig) SetDestination(v string)`

SetDestination sets Destination field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


