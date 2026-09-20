# ConductorUpdateTaskRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**WorkflowInstanceId** | **string** |  | 
**TaskId** | **string** |  | 
**Status** | **string** |  | 
**OutputData** | Pointer to **map[string]interface{}** |  | [optional] 
**ReasonForIncompletion** | Pointer to **string** |  | [optional] 
**WorkerId** | Pointer to **string** |  | [optional] 
**CallbackAfterSeconds** | Pointer to **int32** |  | [optional] 
**Logs** | Pointer to [**[]ConductorUpdateTaskRequestLogsInner**](ConductorUpdateTaskRequestLogsInner.md) |  | [optional] 

## Methods

### NewConductorUpdateTaskRequest

`func NewConductorUpdateTaskRequest(workflowInstanceId string, taskId string, status string, ) *ConductorUpdateTaskRequest`

NewConductorUpdateTaskRequest instantiates a new ConductorUpdateTaskRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewConductorUpdateTaskRequestWithDefaults

`func NewConductorUpdateTaskRequestWithDefaults() *ConductorUpdateTaskRequest`

NewConductorUpdateTaskRequestWithDefaults instantiates a new ConductorUpdateTaskRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWorkflowInstanceId

`func (o *ConductorUpdateTaskRequest) GetWorkflowInstanceId() string`

GetWorkflowInstanceId returns the WorkflowInstanceId field if non-nil, zero value otherwise.

### GetWorkflowInstanceIdOk

`func (o *ConductorUpdateTaskRequest) GetWorkflowInstanceIdOk() (*string, bool)`

GetWorkflowInstanceIdOk returns a tuple with the WorkflowInstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowInstanceId

`func (o *ConductorUpdateTaskRequest) SetWorkflowInstanceId(v string)`

SetWorkflowInstanceId sets WorkflowInstanceId field to given value.


### GetTaskId

`func (o *ConductorUpdateTaskRequest) GetTaskId() string`

GetTaskId returns the TaskId field if non-nil, zero value otherwise.

### GetTaskIdOk

`func (o *ConductorUpdateTaskRequest) GetTaskIdOk() (*string, bool)`

GetTaskIdOk returns a tuple with the TaskId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskId

`func (o *ConductorUpdateTaskRequest) SetTaskId(v string)`

SetTaskId sets TaskId field to given value.


### GetStatus

`func (o *ConductorUpdateTaskRequest) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ConductorUpdateTaskRequest) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ConductorUpdateTaskRequest) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetOutputData

`func (o *ConductorUpdateTaskRequest) GetOutputData() map[string]interface{}`

GetOutputData returns the OutputData field if non-nil, zero value otherwise.

### GetOutputDataOk

`func (o *ConductorUpdateTaskRequest) GetOutputDataOk() (*map[string]interface{}, bool)`

GetOutputDataOk returns a tuple with the OutputData field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutputData

`func (o *ConductorUpdateTaskRequest) SetOutputData(v map[string]interface{})`

SetOutputData sets OutputData field to given value.

### HasOutputData

`func (o *ConductorUpdateTaskRequest) HasOutputData() bool`

HasOutputData returns a boolean if a field has been set.

### GetReasonForIncompletion

`func (o *ConductorUpdateTaskRequest) GetReasonForIncompletion() string`

GetReasonForIncompletion returns the ReasonForIncompletion field if non-nil, zero value otherwise.

### GetReasonForIncompletionOk

`func (o *ConductorUpdateTaskRequest) GetReasonForIncompletionOk() (*string, bool)`

GetReasonForIncompletionOk returns a tuple with the ReasonForIncompletion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReasonForIncompletion

`func (o *ConductorUpdateTaskRequest) SetReasonForIncompletion(v string)`

SetReasonForIncompletion sets ReasonForIncompletion field to given value.

### HasReasonForIncompletion

`func (o *ConductorUpdateTaskRequest) HasReasonForIncompletion() bool`

HasReasonForIncompletion returns a boolean if a field has been set.

### GetWorkerId

`func (o *ConductorUpdateTaskRequest) GetWorkerId() string`

GetWorkerId returns the WorkerId field if non-nil, zero value otherwise.

### GetWorkerIdOk

`func (o *ConductorUpdateTaskRequest) GetWorkerIdOk() (*string, bool)`

GetWorkerIdOk returns a tuple with the WorkerId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkerId

`func (o *ConductorUpdateTaskRequest) SetWorkerId(v string)`

SetWorkerId sets WorkerId field to given value.

### HasWorkerId

`func (o *ConductorUpdateTaskRequest) HasWorkerId() bool`

HasWorkerId returns a boolean if a field has been set.

### GetCallbackAfterSeconds

`func (o *ConductorUpdateTaskRequest) GetCallbackAfterSeconds() int32`

GetCallbackAfterSeconds returns the CallbackAfterSeconds field if non-nil, zero value otherwise.

### GetCallbackAfterSecondsOk

`func (o *ConductorUpdateTaskRequest) GetCallbackAfterSecondsOk() (*int32, bool)`

GetCallbackAfterSecondsOk returns a tuple with the CallbackAfterSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCallbackAfterSeconds

`func (o *ConductorUpdateTaskRequest) SetCallbackAfterSeconds(v int32)`

SetCallbackAfterSeconds sets CallbackAfterSeconds field to given value.

### HasCallbackAfterSeconds

`func (o *ConductorUpdateTaskRequest) HasCallbackAfterSeconds() bool`

HasCallbackAfterSeconds returns a boolean if a field has been set.

### GetLogs

`func (o *ConductorUpdateTaskRequest) GetLogs() []ConductorUpdateTaskRequestLogsInner`

GetLogs returns the Logs field if non-nil, zero value otherwise.

### GetLogsOk

`func (o *ConductorUpdateTaskRequest) GetLogsOk() (*[]ConductorUpdateTaskRequestLogsInner, bool)`

GetLogsOk returns a tuple with the Logs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLogs

`func (o *ConductorUpdateTaskRequest) SetLogs(v []ConductorUpdateTaskRequestLogsInner)`

SetLogs sets Logs field to given value.

### HasLogs

`func (o *ConductorUpdateTaskRequest) HasLogs() bool`

HasLogs returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


