# TaskAppendLogsRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**WorkflowId** | **string** |  | 
**LeaseToken** | **string** |  | 
**Logs** | [**[]TaskAppendLogsRequestLogsInner**](TaskAppendLogsRequestLogsInner.md) |  | 

## Methods

### NewTaskAppendLogsRequest

`func NewTaskAppendLogsRequest(workflowId string, leaseToken string, logs []TaskAppendLogsRequestLogsInner, ) *TaskAppendLogsRequest`

NewTaskAppendLogsRequest instantiates a new TaskAppendLogsRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTaskAppendLogsRequestWithDefaults

`func NewTaskAppendLogsRequestWithDefaults() *TaskAppendLogsRequest`

NewTaskAppendLogsRequestWithDefaults instantiates a new TaskAppendLogsRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWorkflowId

`func (o *TaskAppendLogsRequest) GetWorkflowId() string`

GetWorkflowId returns the WorkflowId field if non-nil, zero value otherwise.

### GetWorkflowIdOk

`func (o *TaskAppendLogsRequest) GetWorkflowIdOk() (*string, bool)`

GetWorkflowIdOk returns a tuple with the WorkflowId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowId

`func (o *TaskAppendLogsRequest) SetWorkflowId(v string)`

SetWorkflowId sets WorkflowId field to given value.


### GetLeaseToken

`func (o *TaskAppendLogsRequest) GetLeaseToken() string`

GetLeaseToken returns the LeaseToken field if non-nil, zero value otherwise.

### GetLeaseTokenOk

`func (o *TaskAppendLogsRequest) GetLeaseTokenOk() (*string, bool)`

GetLeaseTokenOk returns a tuple with the LeaseToken field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLeaseToken

`func (o *TaskAppendLogsRequest) SetLeaseToken(v string)`

SetLeaseToken sets LeaseToken field to given value.


### GetLogs

`func (o *TaskAppendLogsRequest) GetLogs() []TaskAppendLogsRequestLogsInner`

GetLogs returns the Logs field if non-nil, zero value otherwise.

### GetLogsOk

`func (o *TaskAppendLogsRequest) GetLogsOk() (*[]TaskAppendLogsRequestLogsInner, bool)`

GetLogsOk returns a tuple with the Logs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLogs

`func (o *TaskAppendLogsRequest) SetLogs(v []TaskAppendLogsRequestLogsInner)`

SetLogs sets Logs field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


