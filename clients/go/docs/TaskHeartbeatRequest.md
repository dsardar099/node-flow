# TaskHeartbeatRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**QueueName** | **string** |  | 
**LeaseToken** | **string** |  | 
**LeaseSeconds** | Pointer to **int32** |  | [optional] 

## Methods

### NewTaskHeartbeatRequest

`func NewTaskHeartbeatRequest(queueName string, leaseToken string, ) *TaskHeartbeatRequest`

NewTaskHeartbeatRequest instantiates a new TaskHeartbeatRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewTaskHeartbeatRequestWithDefaults

`func NewTaskHeartbeatRequestWithDefaults() *TaskHeartbeatRequest`

NewTaskHeartbeatRequestWithDefaults instantiates a new TaskHeartbeatRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQueueName

`func (o *TaskHeartbeatRequest) GetQueueName() string`

GetQueueName returns the QueueName field if non-nil, zero value otherwise.

### GetQueueNameOk

`func (o *TaskHeartbeatRequest) GetQueueNameOk() (*string, bool)`

GetQueueNameOk returns a tuple with the QueueName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQueueName

`func (o *TaskHeartbeatRequest) SetQueueName(v string)`

SetQueueName sets QueueName field to given value.


### GetLeaseToken

`func (o *TaskHeartbeatRequest) GetLeaseToken() string`

GetLeaseToken returns the LeaseToken field if non-nil, zero value otherwise.

### GetLeaseTokenOk

`func (o *TaskHeartbeatRequest) GetLeaseTokenOk() (*string, bool)`

GetLeaseTokenOk returns a tuple with the LeaseToken field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLeaseToken

`func (o *TaskHeartbeatRequest) SetLeaseToken(v string)`

SetLeaseToken sets LeaseToken field to given value.


### GetLeaseSeconds

`func (o *TaskHeartbeatRequest) GetLeaseSeconds() int32`

GetLeaseSeconds returns the LeaseSeconds field if non-nil, zero value otherwise.

### GetLeaseSecondsOk

`func (o *TaskHeartbeatRequest) GetLeaseSecondsOk() (*int32, bool)`

GetLeaseSecondsOk returns a tuple with the LeaseSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLeaseSeconds

`func (o *TaskHeartbeatRequest) SetLeaseSeconds(v int32)`

SetLeaseSeconds sets LeaseSeconds field to given value.

### HasLeaseSeconds

`func (o *TaskHeartbeatRequest) HasLeaseSeconds() bool`

HasLeaseSeconds returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


