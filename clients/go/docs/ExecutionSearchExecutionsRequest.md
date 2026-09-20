# ExecutionSearchExecutionsRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | Pointer to **[]string** |  | [optional] 
**DefName** | Pointer to **string** |  | [optional] 
**DefVersion** | Pointer to **int32** |  | [optional] 
**CorrelationId** | Pointer to **string** |  | [optional] 
**WorkflowId** | Pointer to **string** |  | [optional] 
**IdempotencyKey** | Pointer to **string** |  | [optional] 
**ExcludeSubWorkflows** | Pointer to **bool** |  | [optional] 
**StartedAfter** | Pointer to **time.Time** |  | [optional] 
**StartedBefore** | Pointer to **time.Time** |  | [optional] 
**Finished** | Pointer to **bool** |  | [optional] 
**Limit** | Pointer to **int32** |  | [optional] 
**Cursor** | Pointer to **string** |  | [optional] 
**Q** | Pointer to **NullableString** |  | [optional] 

## Methods

### NewExecutionSearchExecutionsRequest

`func NewExecutionSearchExecutionsRequest() *ExecutionSearchExecutionsRequest`

NewExecutionSearchExecutionsRequest instantiates a new ExecutionSearchExecutionsRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecutionSearchExecutionsRequestWithDefaults

`func NewExecutionSearchExecutionsRequestWithDefaults() *ExecutionSearchExecutionsRequest`

NewExecutionSearchExecutionsRequestWithDefaults instantiates a new ExecutionSearchExecutionsRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *ExecutionSearchExecutionsRequest) GetStatus() []string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ExecutionSearchExecutionsRequest) GetStatusOk() (*[]string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ExecutionSearchExecutionsRequest) SetStatus(v []string)`

SetStatus sets Status field to given value.

### HasStatus

`func (o *ExecutionSearchExecutionsRequest) HasStatus() bool`

HasStatus returns a boolean if a field has been set.

### GetDefName

`func (o *ExecutionSearchExecutionsRequest) GetDefName() string`

GetDefName returns the DefName field if non-nil, zero value otherwise.

### GetDefNameOk

`func (o *ExecutionSearchExecutionsRequest) GetDefNameOk() (*string, bool)`

GetDefNameOk returns a tuple with the DefName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefName

`func (o *ExecutionSearchExecutionsRequest) SetDefName(v string)`

SetDefName sets DefName field to given value.

### HasDefName

`func (o *ExecutionSearchExecutionsRequest) HasDefName() bool`

HasDefName returns a boolean if a field has been set.

### GetDefVersion

`func (o *ExecutionSearchExecutionsRequest) GetDefVersion() int32`

GetDefVersion returns the DefVersion field if non-nil, zero value otherwise.

### GetDefVersionOk

`func (o *ExecutionSearchExecutionsRequest) GetDefVersionOk() (*int32, bool)`

GetDefVersionOk returns a tuple with the DefVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefVersion

`func (o *ExecutionSearchExecutionsRequest) SetDefVersion(v int32)`

SetDefVersion sets DefVersion field to given value.

### HasDefVersion

`func (o *ExecutionSearchExecutionsRequest) HasDefVersion() bool`

HasDefVersion returns a boolean if a field has been set.

### GetCorrelationId

`func (o *ExecutionSearchExecutionsRequest) GetCorrelationId() string`

GetCorrelationId returns the CorrelationId field if non-nil, zero value otherwise.

### GetCorrelationIdOk

`func (o *ExecutionSearchExecutionsRequest) GetCorrelationIdOk() (*string, bool)`

GetCorrelationIdOk returns a tuple with the CorrelationId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCorrelationId

`func (o *ExecutionSearchExecutionsRequest) SetCorrelationId(v string)`

SetCorrelationId sets CorrelationId field to given value.

### HasCorrelationId

`func (o *ExecutionSearchExecutionsRequest) HasCorrelationId() bool`

HasCorrelationId returns a boolean if a field has been set.

### GetWorkflowId

`func (o *ExecutionSearchExecutionsRequest) GetWorkflowId() string`

GetWorkflowId returns the WorkflowId field if non-nil, zero value otherwise.

### GetWorkflowIdOk

`func (o *ExecutionSearchExecutionsRequest) GetWorkflowIdOk() (*string, bool)`

GetWorkflowIdOk returns a tuple with the WorkflowId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowId

`func (o *ExecutionSearchExecutionsRequest) SetWorkflowId(v string)`

SetWorkflowId sets WorkflowId field to given value.

### HasWorkflowId

`func (o *ExecutionSearchExecutionsRequest) HasWorkflowId() bool`

HasWorkflowId returns a boolean if a field has been set.

### GetIdempotencyKey

`func (o *ExecutionSearchExecutionsRequest) GetIdempotencyKey() string`

GetIdempotencyKey returns the IdempotencyKey field if non-nil, zero value otherwise.

### GetIdempotencyKeyOk

`func (o *ExecutionSearchExecutionsRequest) GetIdempotencyKeyOk() (*string, bool)`

GetIdempotencyKeyOk returns a tuple with the IdempotencyKey field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdempotencyKey

`func (o *ExecutionSearchExecutionsRequest) SetIdempotencyKey(v string)`

SetIdempotencyKey sets IdempotencyKey field to given value.

### HasIdempotencyKey

`func (o *ExecutionSearchExecutionsRequest) HasIdempotencyKey() bool`

HasIdempotencyKey returns a boolean if a field has been set.

### GetExcludeSubWorkflows

`func (o *ExecutionSearchExecutionsRequest) GetExcludeSubWorkflows() bool`

GetExcludeSubWorkflows returns the ExcludeSubWorkflows field if non-nil, zero value otherwise.

### GetExcludeSubWorkflowsOk

`func (o *ExecutionSearchExecutionsRequest) GetExcludeSubWorkflowsOk() (*bool, bool)`

GetExcludeSubWorkflowsOk returns a tuple with the ExcludeSubWorkflows field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExcludeSubWorkflows

`func (o *ExecutionSearchExecutionsRequest) SetExcludeSubWorkflows(v bool)`

SetExcludeSubWorkflows sets ExcludeSubWorkflows field to given value.

### HasExcludeSubWorkflows

`func (o *ExecutionSearchExecutionsRequest) HasExcludeSubWorkflows() bool`

HasExcludeSubWorkflows returns a boolean if a field has been set.

### GetStartedAfter

`func (o *ExecutionSearchExecutionsRequest) GetStartedAfter() time.Time`

GetStartedAfter returns the StartedAfter field if non-nil, zero value otherwise.

### GetStartedAfterOk

`func (o *ExecutionSearchExecutionsRequest) GetStartedAfterOk() (*time.Time, bool)`

GetStartedAfterOk returns a tuple with the StartedAfter field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStartedAfter

`func (o *ExecutionSearchExecutionsRequest) SetStartedAfter(v time.Time)`

SetStartedAfter sets StartedAfter field to given value.

### HasStartedAfter

`func (o *ExecutionSearchExecutionsRequest) HasStartedAfter() bool`

HasStartedAfter returns a boolean if a field has been set.

### GetStartedBefore

`func (o *ExecutionSearchExecutionsRequest) GetStartedBefore() time.Time`

GetStartedBefore returns the StartedBefore field if non-nil, zero value otherwise.

### GetStartedBeforeOk

`func (o *ExecutionSearchExecutionsRequest) GetStartedBeforeOk() (*time.Time, bool)`

GetStartedBeforeOk returns a tuple with the StartedBefore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStartedBefore

`func (o *ExecutionSearchExecutionsRequest) SetStartedBefore(v time.Time)`

SetStartedBefore sets StartedBefore field to given value.

### HasStartedBefore

`func (o *ExecutionSearchExecutionsRequest) HasStartedBefore() bool`

HasStartedBefore returns a boolean if a field has been set.

### GetFinished

`func (o *ExecutionSearchExecutionsRequest) GetFinished() bool`

GetFinished returns the Finished field if non-nil, zero value otherwise.

### GetFinishedOk

`func (o *ExecutionSearchExecutionsRequest) GetFinishedOk() (*bool, bool)`

GetFinishedOk returns a tuple with the Finished field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFinished

`func (o *ExecutionSearchExecutionsRequest) SetFinished(v bool)`

SetFinished sets Finished field to given value.

### HasFinished

`func (o *ExecutionSearchExecutionsRequest) HasFinished() bool`

HasFinished returns a boolean if a field has been set.

### GetLimit

`func (o *ExecutionSearchExecutionsRequest) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *ExecutionSearchExecutionsRequest) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *ExecutionSearchExecutionsRequest) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *ExecutionSearchExecutionsRequest) HasLimit() bool`

HasLimit returns a boolean if a field has been set.

### GetCursor

`func (o *ExecutionSearchExecutionsRequest) GetCursor() string`

GetCursor returns the Cursor field if non-nil, zero value otherwise.

### GetCursorOk

`func (o *ExecutionSearchExecutionsRequest) GetCursorOk() (*string, bool)`

GetCursorOk returns a tuple with the Cursor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCursor

`func (o *ExecutionSearchExecutionsRequest) SetCursor(v string)`

SetCursor sets Cursor field to given value.

### HasCursor

`func (o *ExecutionSearchExecutionsRequest) HasCursor() bool`

HasCursor returns a boolean if a field has been set.

### GetQ

`func (o *ExecutionSearchExecutionsRequest) GetQ() string`

GetQ returns the Q field if non-nil, zero value otherwise.

### GetQOk

`func (o *ExecutionSearchExecutionsRequest) GetQOk() (*string, bool)`

GetQOk returns a tuple with the Q field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQ

`func (o *ExecutionSearchExecutionsRequest) SetQ(v string)`

SetQ sets Q field to given value.

### HasQ

`func (o *ExecutionSearchExecutionsRequest) HasQ() bool`

HasQ returns a boolean if a field has been set.

### SetQNil

`func (o *ExecutionSearchExecutionsRequest) SetQNil(b bool)`

 SetQNil sets the value for Q to be an explicit nil

### UnsetQ
`func (o *ExecutionSearchExecutionsRequest) UnsetQ()`

UnsetQ ensures that no value is present for Q, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


