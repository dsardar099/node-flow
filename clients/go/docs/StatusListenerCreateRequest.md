# StatusListenerCreateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Description** | Pointer to **string** |  | [optional] 
**Enabled** | Pointer to **bool** |  | [optional] 
**WorkflowNames** | Pointer to **[]string** |  | [optional] 
**Events** | Pointer to **[]string** |  | [optional] 
**Sink** | **string** |  | 
**Config** | [**StatusListenerCreateRequestConfig**](StatusListenerCreateRequestConfig.md) |  | 
**IncludeOutput** | Pointer to **bool** |  | [optional] 

## Methods

### NewStatusListenerCreateRequest

`func NewStatusListenerCreateRequest(name string, sink string, config StatusListenerCreateRequestConfig, ) *StatusListenerCreateRequest`

NewStatusListenerCreateRequest instantiates a new StatusListenerCreateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewStatusListenerCreateRequestWithDefaults

`func NewStatusListenerCreateRequestWithDefaults() *StatusListenerCreateRequest`

NewStatusListenerCreateRequestWithDefaults instantiates a new StatusListenerCreateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *StatusListenerCreateRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *StatusListenerCreateRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *StatusListenerCreateRequest) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *StatusListenerCreateRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *StatusListenerCreateRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *StatusListenerCreateRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *StatusListenerCreateRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetEnabled

`func (o *StatusListenerCreateRequest) GetEnabled() bool`

GetEnabled returns the Enabled field if non-nil, zero value otherwise.

### GetEnabledOk

`func (o *StatusListenerCreateRequest) GetEnabledOk() (*bool, bool)`

GetEnabledOk returns a tuple with the Enabled field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnabled

`func (o *StatusListenerCreateRequest) SetEnabled(v bool)`

SetEnabled sets Enabled field to given value.

### HasEnabled

`func (o *StatusListenerCreateRequest) HasEnabled() bool`

HasEnabled returns a boolean if a field has been set.

### GetWorkflowNames

`func (o *StatusListenerCreateRequest) GetWorkflowNames() []string`

GetWorkflowNames returns the WorkflowNames field if non-nil, zero value otherwise.

### GetWorkflowNamesOk

`func (o *StatusListenerCreateRequest) GetWorkflowNamesOk() (*[]string, bool)`

GetWorkflowNamesOk returns a tuple with the WorkflowNames field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowNames

`func (o *StatusListenerCreateRequest) SetWorkflowNames(v []string)`

SetWorkflowNames sets WorkflowNames field to given value.

### HasWorkflowNames

`func (o *StatusListenerCreateRequest) HasWorkflowNames() bool`

HasWorkflowNames returns a boolean if a field has been set.

### GetEvents

`func (o *StatusListenerCreateRequest) GetEvents() []string`

GetEvents returns the Events field if non-nil, zero value otherwise.

### GetEventsOk

`func (o *StatusListenerCreateRequest) GetEventsOk() (*[]string, bool)`

GetEventsOk returns a tuple with the Events field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvents

`func (o *StatusListenerCreateRequest) SetEvents(v []string)`

SetEvents sets Events field to given value.

### HasEvents

`func (o *StatusListenerCreateRequest) HasEvents() bool`

HasEvents returns a boolean if a field has been set.

### GetSink

`func (o *StatusListenerCreateRequest) GetSink() string`

GetSink returns the Sink field if non-nil, zero value otherwise.

### GetSinkOk

`func (o *StatusListenerCreateRequest) GetSinkOk() (*string, bool)`

GetSinkOk returns a tuple with the Sink field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSink

`func (o *StatusListenerCreateRequest) SetSink(v string)`

SetSink sets Sink field to given value.


### GetConfig

`func (o *StatusListenerCreateRequest) GetConfig() StatusListenerCreateRequestConfig`

GetConfig returns the Config field if non-nil, zero value otherwise.

### GetConfigOk

`func (o *StatusListenerCreateRequest) GetConfigOk() (*StatusListenerCreateRequestConfig, bool)`

GetConfigOk returns a tuple with the Config field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConfig

`func (o *StatusListenerCreateRequest) SetConfig(v StatusListenerCreateRequestConfig)`

SetConfig sets Config field to given value.


### GetIncludeOutput

`func (o *StatusListenerCreateRequest) GetIncludeOutput() bool`

GetIncludeOutput returns the IncludeOutput field if non-nil, zero value otherwise.

### GetIncludeOutputOk

`func (o *StatusListenerCreateRequest) GetIncludeOutputOk() (*bool, bool)`

GetIncludeOutputOk returns a tuple with the IncludeOutput field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIncludeOutput

`func (o *StatusListenerCreateRequest) SetIncludeOutput(v bool)`

SetIncludeOutput sets IncludeOutput field to given value.

### HasIncludeOutput

`func (o *StatusListenerCreateRequest) HasIncludeOutput() bool`

HasIncludeOutput returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


