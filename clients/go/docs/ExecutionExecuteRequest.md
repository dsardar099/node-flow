# ExecutionExecuteRequest

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
**WaitForSeconds** | Pointer to **float32** |  | [optional] [default to 10]
**WaitUntilTaskRef** | Pointer to **string** |  | [optional] 

## Methods

### NewExecutionExecuteRequest

`func NewExecutionExecuteRequest() *ExecutionExecuteRequest`

NewExecutionExecuteRequest instantiates a new ExecutionExecuteRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecutionExecuteRequestWithDefaults

`func NewExecutionExecuteRequestWithDefaults() *ExecutionExecuteRequest`

NewExecutionExecuteRequestWithDefaults instantiates a new ExecutionExecuteRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVersion

`func (o *ExecutionExecuteRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *ExecutionExecuteRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *ExecutionExecuteRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *ExecutionExecuteRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetInput

`func (o *ExecutionExecuteRequest) GetInput() map[string]interface{}`

GetInput returns the Input field if non-nil, zero value otherwise.

### GetInputOk

`func (o *ExecutionExecuteRequest) GetInputOk() (*map[string]interface{}, bool)`

GetInputOk returns a tuple with the Input field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInput

`func (o *ExecutionExecuteRequest) SetInput(v map[string]interface{})`

SetInput sets Input field to given value.

### HasInput

`func (o *ExecutionExecuteRequest) HasInput() bool`

HasInput returns a boolean if a field has been set.

### GetTaskToDomain

`func (o *ExecutionExecuteRequest) GetTaskToDomain() map[string]string`

GetTaskToDomain returns the TaskToDomain field if non-nil, zero value otherwise.

### GetTaskToDomainOk

`func (o *ExecutionExecuteRequest) GetTaskToDomainOk() (*map[string]string, bool)`

GetTaskToDomainOk returns a tuple with the TaskToDomain field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskToDomain

`func (o *ExecutionExecuteRequest) SetTaskToDomain(v map[string]string)`

SetTaskToDomain sets TaskToDomain field to given value.

### HasTaskToDomain

`func (o *ExecutionExecuteRequest) HasTaskToDomain() bool`

HasTaskToDomain returns a boolean if a field has been set.

### GetCorrelationId

`func (o *ExecutionExecuteRequest) GetCorrelationId() string`

GetCorrelationId returns the CorrelationId field if non-nil, zero value otherwise.

### GetCorrelationIdOk

`func (o *ExecutionExecuteRequest) GetCorrelationIdOk() (*string, bool)`

GetCorrelationIdOk returns a tuple with the CorrelationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCorrelationId

`func (o *ExecutionExecuteRequest) SetCorrelationId(v string)`

SetCorrelationId sets CorrelationId field to given value.

### HasCorrelationId

`func (o *ExecutionExecuteRequest) HasCorrelationId() bool`

HasCorrelationId returns a boolean if a field has been set.

### GetIdempotencyKey

`func (o *ExecutionExecuteRequest) GetIdempotencyKey() string`

GetIdempotencyKey returns the IdempotencyKey field if non-nil, zero value otherwise.

### GetIdempotencyKeyOk

`func (o *ExecutionExecuteRequest) GetIdempotencyKeyOk() (*string, bool)`

GetIdempotencyKeyOk returns a tuple with the IdempotencyKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyKey

`func (o *ExecutionExecuteRequest) SetIdempotencyKey(v string)`

SetIdempotencyKey sets IdempotencyKey field to given value.

### HasIdempotencyKey

`func (o *ExecutionExecuteRequest) HasIdempotencyKey() bool`

HasIdempotencyKey returns a boolean if a field has been set.

### GetIdempotencyStrategy

`func (o *ExecutionExecuteRequest) GetIdempotencyStrategy() string`

GetIdempotencyStrategy returns the IdempotencyStrategy field if non-nil, zero value otherwise.

### GetIdempotencyStrategyOk

`func (o *ExecutionExecuteRequest) GetIdempotencyStrategyOk() (*string, bool)`

GetIdempotencyStrategyOk returns a tuple with the IdempotencyStrategy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyStrategy

`func (o *ExecutionExecuteRequest) SetIdempotencyStrategy(v string)`

SetIdempotencyStrategy sets IdempotencyStrategy field to given value.

### HasIdempotencyStrategy

`func (o *ExecutionExecuteRequest) HasIdempotencyStrategy() bool`

HasIdempotencyStrategy returns a boolean if a field has been set.

### GetPriority

`func (o *ExecutionExecuteRequest) GetPriority() int32`

GetPriority returns the Priority field if non-nil, zero value otherwise.

### GetPriorityOk

`func (o *ExecutionExecuteRequest) GetPriorityOk() (*int32, bool)`

GetPriorityOk returns a tuple with the Priority field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPriority

`func (o *ExecutionExecuteRequest) SetPriority(v int32)`

SetPriority sets Priority field to given value.

### HasPriority

`func (o *ExecutionExecuteRequest) HasPriority() bool`

HasPriority returns a boolean if a field has been set.

### GetVariables

`func (o *ExecutionExecuteRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *ExecutionExecuteRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *ExecutionExecuteRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *ExecutionExecuteRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.

### GetWaitForSeconds

`func (o *ExecutionExecuteRequest) GetWaitForSeconds() float32`

GetWaitForSeconds returns the WaitForSeconds field if non-nil, zero value otherwise.

### GetWaitForSecondsOk

`func (o *ExecutionExecuteRequest) GetWaitForSecondsOk() (*float32, bool)`

GetWaitForSecondsOk returns a tuple with the WaitForSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWaitForSeconds

`func (o *ExecutionExecuteRequest) SetWaitForSeconds(v float32)`

SetWaitForSeconds sets WaitForSeconds field to given value.

### HasWaitForSeconds

`func (o *ExecutionExecuteRequest) HasWaitForSeconds() bool`

HasWaitForSeconds returns a boolean if a field has been set.

### GetWaitUntilTaskRef

`func (o *ExecutionExecuteRequest) GetWaitUntilTaskRef() string`

GetWaitUntilTaskRef returns the WaitUntilTaskRef field if non-nil, zero value otherwise.

### GetWaitUntilTaskRefOk

`func (o *ExecutionExecuteRequest) GetWaitUntilTaskRefOk() (*string, bool)`

GetWaitUntilTaskRefOk returns a tuple with the WaitUntilTaskRef field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWaitUntilTaskRef

`func (o *ExecutionExecuteRequest) SetWaitUntilTaskRef(v string)`

SetWaitUntilTaskRef sets WaitUntilTaskRef field to given value.

### HasWaitUntilTaskRef

`func (o *ExecutionExecuteRequest) HasWaitUntilTaskRef() bool`

HasWaitUntilTaskRef returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


