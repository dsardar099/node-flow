# ExecutionBulkRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**WorkflowIds** | **[]string** |  | 
**Reason** | Pointer to **string** |  | [optional] 

## Methods

### NewExecutionBulkRequest

`func NewExecutionBulkRequest(workflowIds []string, ) *ExecutionBulkRequest`

NewExecutionBulkRequest instantiates a new ExecutionBulkRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecutionBulkRequestWithDefaults

`func NewExecutionBulkRequestWithDefaults() *ExecutionBulkRequest`

NewExecutionBulkRequestWithDefaults instantiates a new ExecutionBulkRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWorkflowIds

`func (o *ExecutionBulkRequest) GetWorkflowIds() []string`

GetWorkflowIds returns the WorkflowIds field if non-nil, zero value otherwise.

### GetWorkflowIdsOk

`func (o *ExecutionBulkRequest) GetWorkflowIdsOk() (*[]string, bool)`

GetWorkflowIdsOk returns a tuple with the WorkflowIds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowIds

`func (o *ExecutionBulkRequest) SetWorkflowIds(v []string)`

SetWorkflowIds sets WorkflowIds field to given value.


### GetReason

`func (o *ExecutionBulkRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *ExecutionBulkRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *ExecutionBulkRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *ExecutionBulkRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


