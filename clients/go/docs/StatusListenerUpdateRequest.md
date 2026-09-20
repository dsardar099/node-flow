# StatusListenerUpdateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Description** | Pointer to **string** |  | [optional] 
**Enabled** | Pointer to **bool** |  | [optional] 
**WorkflowNames** | Pointer to **[]string** |  | [optional] 
**Events** | Pointer to **[]string** |  | [optional] 
**Sink** | **string** |  | 
**Config** | [**StatusListenerCreateRequestConfig**](StatusListenerCreateRequestConfig.md) |  | 
**IncludeOutput** | Pointer to **bool** |  | [optional] 

## Methods

### NewStatusListenerUpdateRequest

`func NewStatusListenerUpdateRequest(sink string, config StatusListenerCreateRequestConfig, ) *StatusListenerUpdateRequest`

NewStatusListenerUpdateRequest instantiates a new StatusListenerUpdateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewStatusListenerUpdateRequestWithDefaults

`func NewStatusListenerUpdateRequestWithDefaults() *StatusListenerUpdateRequest`

NewStatusListenerUpdateRequestWithDefaults instantiates a new StatusListenerUpdateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetDescription

`func (o *StatusListenerUpdateRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *StatusListenerUpdateRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *StatusListenerUpdateRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *StatusListenerUpdateRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetEnabled

`func (o *StatusListenerUpdateRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *StatusListenerUpdateRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *StatusListenerUpdateRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *StatusListenerUpdateRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetWorkflowNames

`func (o *StatusListenerUpdateRequest) GetWorkflowNames() []string`

GetWorkflowNames returns the WorkflowNames field if non-nil, zero value otherwise.

### GetWorkflowNamesOk

`func (o *StatusListenerUpdateRequest) GetWorkflowNamesOk() (*[]string, bool)`

GetWorkflowNamesOk returns a tuple with the WorkflowNames field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowNames

`func (o *StatusListenerUpdateRequest) SetWorkflowNames(v []string)`

SetWorkflowNames sets WorkflowNames field to given value.

### HasWorkflowNames

`func (o *StatusListenerUpdateRequest) HasWorkflowNames() bool`

HasWorkflowNames returns a boolean if a field has been set.

### GetEvents

`func (o *StatusListenerUpdateRequest) GetEvents() []string`

GetEvents returns the Events field if non-nil, zero value otherwise.

### GetEventsOk

`func (o *StatusListenerUpdateRequest) GetEventsOk() (*[]string, bool)`

GetEventsOk returns a tuple with the Events field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvents

`func (o *StatusListenerUpdateRequest) SetEvents(v []string)`

SetEvents sets Events field to given value.

### HasEvents

`func (o *StatusListenerUpdateRequest) HasEvents() bool`

HasEvents returns a boolean if a field has been set.

### GetSink

`func (o *StatusListenerUpdateRequest) GetSink() string`

GetSink returns the Sink field if non-nil, zero value otherwise.

### GetSinkOk

`func (o *StatusListenerUpdateRequest) GetSinkOk() (*string, bool)`

GetSinkOk returns a tuple with the Sink field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSink

`func (o *StatusListenerUpdateRequest) SetSink(v string)`

SetSink sets Sink field to given value.


### GetConfig

`func (o *StatusListenerUpdateRequest) GetConfig() StatusListenerCreateRequestConfig`

GetConfig returns the Config field if non-nil, zero value otherwise.

### GetConfigOk

`func (o *StatusListenerUpdateRequest) GetConfigOk() (*StatusListenerCreateRequestConfig, bool)`

GetConfigOk returns a tuple with the Config field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConfig

`func (o *StatusListenerUpdateRequest) SetConfig(v StatusListenerCreateRequestConfig)`

SetConfig sets Config field to given value.


### GetIncludeOutput

`func (o *StatusListenerUpdateRequest) GetIncludeOutput() bool`

GetIncludeOutput returns the IncludeOutput field if non-nil, zero value otherwise.

### GetIncludeOutputOk

`func (o *StatusListenerUpdateRequest) GetIncludeOutputOk() (*bool, bool)`

GetIncludeOutputOk returns a tuple with the IncludeOutput field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIncludeOutput

`func (o *StatusListenerUpdateRequest) SetIncludeOutput(v bool)`

SetIncludeOutput sets IncludeOutput field to given value.

### HasIncludeOutput

`func (o *StatusListenerUpdateRequest) HasIncludeOutput() bool`

HasIncludeOutput returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


