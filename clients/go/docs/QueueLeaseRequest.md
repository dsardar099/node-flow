# QueueLeaseRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**WorkerId** | **string** |  | 
**Count** | Pointer to **int32** |  | [optional] [default to 1]
**LeaseSeconds** | Pointer to **int32** |  | [optional] 
**WaitSeconds** | Pointer to **int32** |  | [optional] 

## Methods

### NewQueueLeaseRequest

`func NewQueueLeaseRequest(workerId string, ) *QueueLeaseRequest`

NewQueueLeaseRequest instantiates a new QueueLeaseRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewQueueLeaseRequestWithDefaults

`func NewQueueLeaseRequestWithDefaults() *QueueLeaseRequest`

NewQueueLeaseRequestWithDefaults instantiates a new QueueLeaseRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWorkerId

`func (o *QueueLeaseRequest) GetWorkerId() string`

GetWorkerId returns the WorkerId field if non-nil, zero value otherwise.

### GetWorkerIdOk

`func (o *QueueLeaseRequest) GetWorkerIdOk() (*string, bool)`

GetWorkerIdOk returns a tuple with the WorkerId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkerId

`func (o *QueueLeaseRequest) SetWorkerId(v string)`

SetWorkerId sets WorkerId field to given value.


### GetCount

`func (o *QueueLeaseRequest) GetCount() int32`

GetCount returns the Count field if non-nil, zero value otherwise.

### GetCountOk

`func (o *QueueLeaseRequest) GetCountOk() (*int32, bool)`

GetCountOk returns a tuple with the Count field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCount

`func (o *QueueLeaseRequest) SetCount(v int32)`

SetCount sets Count field to given value.

### HasCount

`func (o *QueueLeaseRequest) HasCount() bool`

HasCount returns a boolean if a field has been set.

### GetLeaseSeconds

`func (o *QueueLeaseRequest) GetLeaseSeconds() int32`

GetLeaseSeconds returns the LeaseSeconds field if non-nil, zero value otherwise.

### GetLeaseSecondsOk

`func (o *QueueLeaseRequest) GetLeaseSecondsOk() (*int32, bool)`

GetLeaseSecondsOk returns a tuple with the LeaseSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLeaseSeconds

`func (o *QueueLeaseRequest) SetLeaseSeconds(v int32)`

SetLeaseSeconds sets LeaseSeconds field to given value.

### HasLeaseSeconds

`func (o *QueueLeaseRequest) HasLeaseSeconds() bool`

HasLeaseSeconds returns a boolean if a field has been set.

### GetWaitSeconds

`func (o *QueueLeaseRequest) GetWaitSeconds() int32`

GetWaitSeconds returns the WaitSeconds field if non-nil, zero value otherwise.

### GetWaitSecondsOk

`func (o *QueueLeaseRequest) GetWaitSecondsOk() (*int32, bool)`

GetWaitSecondsOk returns a tuple with the WaitSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWaitSeconds

`func (o *QueueLeaseRequest) SetWaitSeconds(v int32)`

SetWaitSeconds sets WaitSeconds field to given value.

### HasWaitSeconds

`func (o *QueueLeaseRequest) HasWaitSeconds() bool`

HasWaitSeconds returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


