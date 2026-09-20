# ConductorStartWorkflowRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Version** | Pointer to **int32** |  | [optional] 
**Input** | Pointer to **map[string]interface{}** |  | [optional] 
**CorrelationId** | Pointer to **string** |  | [optional] 
**TaskToDomain** | Pointer to **map[string]string** |  | [optional] 
**Priority** | Pointer to **int32** |  | [optional] 
**IdempotencyKey** | Pointer to **string** |  | [optional] 

## Methods

### NewConductorStartWorkflowRequest

`func NewConductorStartWorkflowRequest(name string, ) *ConductorStartWorkflowRequest`

NewConductorStartWorkflowRequest instantiates a new ConductorStartWorkflowRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewConductorStartWorkflowRequestWithDefaults

`func NewConductorStartWorkflowRequestWithDefaults() *ConductorStartWorkflowRequest`

NewConductorStartWorkflowRequestWithDefaults instantiates a new ConductorStartWorkflowRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *ConductorStartWorkflowRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *ConductorStartWorkflowRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *ConductorStartWorkflowRequest) SetName(v string)`

SetName sets Name field to given value.


### GetVersion

`func (o *ConductorStartWorkflowRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *ConductorStartWorkflowRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *ConductorStartWorkflowRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *ConductorStartWorkflowRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetInput

`func (o *ConductorStartWorkflowRequest) GetInput() map[string]interface{}`

GetInput returns the Input field if non-nil, zero value otherwise.

### GetInputOk

`func (o *ConductorStartWorkflowRequest) GetInputOk() (*map[string]interface{}, bool)`

GetInputOk returns a tuple with the Input field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInput

`func (o *ConductorStartWorkflowRequest) SetInput(v map[string]interface{})`

SetInput sets Input field to given value.

### HasInput

`func (o *ConductorStartWorkflowRequest) HasInput() bool`

HasInput returns a boolean if a field has been set.

### GetCorrelationId

`func (o *ConductorStartWorkflowRequest) GetCorrelationId() string`

GetCorrelationId returns the CorrelationId field if non-nil, zero value otherwise.

### GetCorrelationIdOk

`func (o *ConductorStartWorkflowRequest) GetCorrelationIdOk() (*string, bool)`

GetCorrelationIdOk returns a tuple with the CorrelationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCorrelationId

`func (o *ConductorStartWorkflowRequest) SetCorrelationId(v string)`

SetCorrelationId sets CorrelationId field to given value.

### HasCorrelationId

`func (o *ConductorStartWorkflowRequest) HasCorrelationId() bool`

HasCorrelationId returns a boolean if a field has been set.

### GetTaskToDomain

`func (o *ConductorStartWorkflowRequest) GetTaskToDomain() map[string]string`

GetTaskToDomain returns the TaskToDomain field if non-nil, zero value otherwise.

### GetTaskToDomainOk

`func (o *ConductorStartWorkflowRequest) GetTaskToDomainOk() (*map[string]string, bool)`

GetTaskToDomainOk returns a tuple with the TaskToDomain field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskToDomain

`func (o *ConductorStartWorkflowRequest) SetTaskToDomain(v map[string]string)`

SetTaskToDomain sets TaskToDomain field to given value.

### HasTaskToDomain

`func (o *ConductorStartWorkflowRequest) HasTaskToDomain() bool`

HasTaskToDomain returns a boolean if a field has been set.

### GetPriority

`func (o *ConductorStartWorkflowRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *ConductorStartWorkflowRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *ConductorStartWorkflowRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *ConductorStartWorkflowRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.

### GetIdempotencyKey

`func (o *ConductorStartWorkflowRequest) GetIdempotencyKey() string`

GetIdempotencyKey returns the IdempotencyKey field if non-nil, zero value otherwise.

### GetIdempotencyKeyOk

`func (o *ConductorStartWorkflowRequest) GetIdempotencyKeyOk() (*string, bool)`

GetIdempotencyKeyOk returns a tuple with the IdempotencyKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyKey

`func (o *ConductorStartWorkflowRequest) SetIdempotencyKey(v string)`

SetIdempotencyKey sets IdempotencyKey field to given value.

### HasIdempotencyKey

`func (o *ConductorStartWorkflowRequest) HasIdempotencyKey() bool`

HasIdempotencyKey returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


