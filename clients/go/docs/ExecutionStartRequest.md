# ExecutionStartRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Version** | Pointer to **int32** |  | [optional] 
**Input** | Pointer to **map[string]interface{}** |  | [optional] [default to {}]
**TaskToDomain** | Pointer to **map[string]string** |  | [optional] 
**CorrelationId** | Pointer to **string** |  | [optional] 
**IdempotencyKey** | Pointer to **string** |  | [optional] 
**IdempotencyStrategy** | Pointer to **string** |  | [optional] 
**Priority** | Pointer to **int32** |  | [optional] 
**Variables** | Pointer to **map[string]interface{}** |  | [optional] [default to {}]

## Methods

### NewExecutionStartRequest

`func NewExecutionStartRequest() *ExecutionStartRequest`

NewExecutionStartRequest instantiates a new ExecutionStartRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecutionStartRequestWithDefaults

`func NewExecutionStartRequestWithDefaults() *ExecutionStartRequest`

NewExecutionStartRequestWithDefaults instantiates a new ExecutionStartRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVersion

`func (o *ExecutionStartRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *ExecutionStartRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *ExecutionStartRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *ExecutionStartRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetInput

`func (o *ExecutionStartRequest) GetInput() map[string]interface{}`

GetInput returns the Input field if non-nil, zero value otherwise.

### GetInputOk

`func (o *ExecutionStartRequest) GetInputOk() (*map[string]interface{}, bool)`

GetInputOk returns a tuple with the Input field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInput

`func (o *ExecutionStartRequest) SetInput(v map[string]interface{})`

SetInput sets Input field to given value.

### HasInput

`func (o *ExecutionStartRequest) HasInput() bool`

HasInput returns a boolean if a field has been set.

### GetTaskToDomain

`func (o *ExecutionStartRequest) GetTaskToDomain() map[string]string`

GetTaskToDomain returns the TaskToDomain field if non-nil, zero value otherwise.

### GetTaskToDomainOk

`func (o *ExecutionStartRequest) GetTaskToDomainOk() (*map[string]string, bool)`

GetTaskToDomainOk returns a tuple with the TaskToDomain field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskToDomain

`func (o *ExecutionStartRequest) SetTaskToDomain(v map[string]string)`

SetTaskToDomain sets TaskToDomain field to given value.

### HasTaskToDomain

`func (o *ExecutionStartRequest) HasTaskToDomain() bool`

HasTaskToDomain returns a boolean if a field has been set.

### GetCorrelationId

`func (o *ExecutionStartRequest) GetCorrelationId() string`

GetCorrelationId returns the CorrelationId field if non-nil, zero value otherwise.

### GetCorrelationIdOk

`func (o *ExecutionStartRequest) GetCorrelationIdOk() (*string, bool)`

GetCorrelationIdOk returns a tuple with the CorrelationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCorrelationId

`func (o *ExecutionStartRequest) SetCorrelationId(v string)`

SetCorrelationId sets CorrelationId field to given value.

### HasCorrelationId

`func (o *ExecutionStartRequest) HasCorrelationId() bool`

HasCorrelationId returns a boolean if a field has been set.

### GetIdempotencyKey

`func (o *ExecutionStartRequest) GetIdempotencyKey() string`

GetIdempotencyKey returns the IdempotencyKey field if non-nil, zero value otherwise.

### GetIdempotencyKeyOk

`func (o *ExecutionStartRequest) GetIdempotencyKeyOk() (*string, bool)`

GetIdempotencyKeyOk returns a tuple with the IdempotencyKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyKey

`func (o *ExecutionStartRequest) SetIdempotencyKey(v string)`

SetIdempotencyKey sets IdempotencyKey field to given value.

### HasIdempotencyKey

`func (o *ExecutionStartRequest) HasIdempotencyKey() bool`

HasIdempotencyKey returns a boolean if a field has been set.

### GetIdempotencyStrategy

`func (o *ExecutionStartRequest) GetIdempotencyStrategy() string`

GetIdempotencyStrategy returns the IdempotencyStrategy field if non-nil, zero value otherwise.

### GetIdempotencyStrategyOk

`func (o *ExecutionStartRequest) GetIdempotencyStrategyOk() (*string, bool)`

GetIdempotencyStrategyOk returns a tuple with the IdempotencyStrategy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyStrategy

`func (o *ExecutionStartRequest) SetIdempotencyStrategy(v string)`

SetIdempotencyStrategy sets IdempotencyStrategy field to given value.

### HasIdempotencyStrategy

`func (o *ExecutionStartRequest) HasIdempotencyStrategy() bool`

HasIdempotencyStrategy returns a boolean if a field has been set.

### GetPriority

`func (o *ExecutionStartRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *ExecutionStartRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *ExecutionStartRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *ExecutionStartRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.

### GetVariables

`func (o *ExecutionStartRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *ExecutionStartRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *ExecutionStartRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *ExecutionStartRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


