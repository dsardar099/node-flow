# ExecutionSignalRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | Pointer to **string** |  | [optional] [default to "COMPLETED"]
**Output** | Pointer to **map[string]interface{}** |  | [optional] [default to {}]
**Reason** | Pointer to **string** |  | [optional] 
**TaskRef** | Pointer to **string** |  | [optional] 
**WaitForSeconds** | Pointer to **float32** |  | [optional] 

## Methods

### NewExecutionSignalRequest

`func NewExecutionSignalRequest() *ExecutionSignalRequest`

NewExecutionSignalRequest instantiates a new ExecutionSignalRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecutionSignalRequestWithDefaults

`func NewExecutionSignalRequestWithDefaults() *ExecutionSignalRequest`

NewExecutionSignalRequestWithDefaults instantiates a new ExecutionSignalRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *ExecutionSignalRequest) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *ExecutionSignalRequest) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *ExecutionSignalRequest) SetStatus(v string)`

SetStatus sets Status field to given value.

### HasStatus

`func (o *ExecutionSignalRequest) HasStatus() bool`

HasStatus returns a boolean if a field has been set.

### GetOutput

`func (o *ExecutionSignalRequest) GetOutput() map[string]interface{}`

GetOutput returns the Output field if non-nil, zero value otherwise.

### GetOutputOk

`func (o *ExecutionSignalRequest) GetOutputOk() (*map[string]interface{}, bool)`

GetOutputOk returns a tuple with the Output field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutput

`func (o *ExecutionSignalRequest) SetOutput(v map[string]interface{})`

SetOutput sets Output field to given value.

### HasOutput

`func (o *ExecutionSignalRequest) HasOutput() bool`

HasOutput returns a boolean if a field has been set.

### GetReason

`func (o *ExecutionSignalRequest) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *ExecutionSignalRequest) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *ExecutionSignalRequest) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *ExecutionSignalRequest) HasReason() bool`

HasReason returns a boolean if a field has been set.

### GetTaskRef

`func (o *ExecutionSignalRequest) GetTaskRef() string`

GetTaskRef returns the TaskRef field if non-nil, zero value otherwise.

### GetTaskRefOk

`func (o *ExecutionSignalRequest) GetTaskRefOk() (*string, bool)`

GetTaskRefOk returns a tuple with the TaskRef field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskRef

`func (o *ExecutionSignalRequest) SetTaskRef(v string)`

SetTaskRef sets TaskRef field to given value.

### HasTaskRef

`func (o *ExecutionSignalRequest) HasTaskRef() bool`

HasTaskRef returns a boolean if a field has been set.

### GetWaitForSeconds

`func (o *ExecutionSignalRequest) GetWaitForSeconds() float32`

GetWaitForSeconds returns the WaitForSeconds field if non-nil, zero value otherwise.

### GetWaitForSecondsOk

`func (o *ExecutionSignalRequest) GetWaitForSecondsOk() (*float32, bool)`

GetWaitForSecondsOk returns a tuple with the WaitForSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWaitForSeconds

`func (o *ExecutionSignalRequest) SetWaitForSeconds(v float32)`

SetWaitForSeconds sets WaitForSeconds field to given value.

### HasWaitForSeconds

`func (o *ExecutionSignalRequest) HasWaitForSeconds() bool`

HasWaitForSeconds returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


