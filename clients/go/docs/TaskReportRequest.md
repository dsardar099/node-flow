# TaskReportRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**QueueName** | **string** |  | 
**WorkflowId** | **string** |  | 
**LeaseToken** | **string** |  | 
**Status** | **string** |  | 
**Output** | Pointer to **map[string]interface{}** |  | [optional] 
**Reason** | Pointer to **string** |  | [optional] 

## Methods

### NewTaskReportRequest

`func NewTaskReportRequest(queueName string, workflowId string, leaseToken string, status string, ) *TaskReportRequest`

NewTaskReportRequest instantiates a new TaskReportRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTaskReportRequestWithDefaults

`func NewTaskReportRequestWithDefaults() *TaskReportRequest`

NewTaskReportRequestWithDefaults instantiates a new TaskReportRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQueueName

`func (o *TaskReportRequest) GetQueueName() string`

GetQueueName returns the QueueName field if non-nil, zero value otherwise.

### GetQueueNameOk

`func (o *TaskReportRequest) GetQueueNameOk() (*string, bool)`

GetQueueNameOk returns a tuple with the QueueName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQueueName

`func (o *TaskReportRequest) SetQueueName(v string)`

SetQueueName sets QueueName field to given value.


### GetWorkflowId

`func (o *TaskReportRequest) GetWorkflowId() string`

GetWorkflowId returns the WorkflowId field if non-nil, zero value otherwise.

### GetWorkflowIdOk

`func (o *TaskReportRequest) GetWorkflowIdOk() (*string, bool)`

GetWorkflowIdOk returns a tuple with the WorkflowId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowId

`func (o *TaskReportRequest) SetWorkflowId(v string)`

SetWorkflowId sets WorkflowId field to given value.


### GetLeaseToken

`func (o *TaskReportRequest) GetLeaseToken() string`

GetLeaseToken returns the LeaseToken field if non-nil, zero value otherwise.

### GetLeaseTokenOk

`func (o *TaskReportRequest) GetLeaseTokenOk() (*string, bool)`

GetLeaseTokenOk returns a tuple with the LeaseToken field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLeaseToken

`func (o *TaskReportRequest) SetLeaseToken(v string)`

SetLeaseToken sets LeaseToken field to given value.


### GetStatus

`func (o *TaskReportRequest) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *TaskReportRequest) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *TaskReportRequest) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetOutput

`func (o *TaskReportRequest) GetOutput() map[string]interface{}`

GetOutput returns the Output field if non-nil, zero value otherwise.

### GetOutputOk

`func (o *TaskReportRequest) GetOutputOk() (*map[string]interface{}, bool)`

GetOutputOk returns a tuple with the Output field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutput

`func (o *TaskReportRequest) SetOutput(v map[string]interface{})`

SetOutput sets Output field to given value.

### HasOutput

`func (o *TaskReportRequest) HasOutput() bool`

HasOutput returns a boolean if a field has been set.

### GetReason

`func (o *TaskReportRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *TaskReportRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *TaskReportRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *TaskReportRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


