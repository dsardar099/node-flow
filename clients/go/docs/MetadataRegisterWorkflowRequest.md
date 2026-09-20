# MetadataRegisterWorkflowRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Version** | Pointer to **int32** |  | [optional] [default to 1]
**Description** | Pointer to **string** |  | [optional] 
**Tasks** | [**[]Shared2d711327d8**](Shared2d711327d8.md) |  | 
**InputParameters** | Pointer to **[]string** |  | [optional] 
**OutputParameters** | Pointer to **map[string]interface{}** |  | [optional] 
**Variables** | Pointer to **map[string]interface{}** |  | [optional] 
**InputSchema** | Pointer to **interface{}** |  | [optional] 
**OutputSchema** | Pointer to **interface{}** |  | [optional] 
**FailureWorkflow** | Pointer to **string** |  | [optional] 
**FailureWorkflowVersion** | Pointer to **int32** |  | [optional] 
**Restartable** | Pointer to **bool** |  | [optional] [default to true]
**TimeoutSeconds** | Pointer to **float32** |  | [optional] [default to 0]
**TimeoutPolicy** | Pointer to **string** |  | [optional] [default to "TIME_OUT_WF"]
**MaxConcurrentExecutions** | Pointer to **int32** |  | [optional] [default to 0]
**RateLimitConfig** | Pointer to [**MetadataRegisterWorkflowRequestRateLimitConfig**](MetadataRegisterWorkflowRequestRateLimitConfig.md) |  | [optional] 
**MaskedFields** | Pointer to **[]string** |  | [optional] 
**MaxConcurrentTasks** | Pointer to **int32** |  | [optional] [default to 0]
**OwnerEmail** | Pointer to **string** |  | [optional] 
**Tags** | Pointer to **[]string** |  | [optional] [default to []]

## Methods

### NewMetadataRegisterWorkflowRequest

`func NewMetadataRegisterWorkflowRequest(name string, tasks []Shared2d711327d8, ) *MetadataRegisterWorkflowRequest`

NewMetadataRegisterWorkflowRequest instantiates a new MetadataRegisterWorkflowRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMetadataRegisterWorkflowRequestWithDefaults

`func NewMetadataRegisterWorkflowRequestWithDefaults() *MetadataRegisterWorkflowRequest`

NewMetadataRegisterWorkflowRequestWithDefaults instantiates a new MetadataRegisterWorkflowRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *MetadataRegisterWorkflowRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *MetadataRegisterWorkflowRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *MetadataRegisterWorkflowRequest) SetName(v string)`

SetName sets Name field to given value.


### GetVersion

`func (o *MetadataRegisterWorkflowRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *MetadataRegisterWorkflowRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *MetadataRegisterWorkflowRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *MetadataRegisterWorkflowRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetDescription

`func (o *MetadataRegisterWorkflowRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *MetadataRegisterWorkflowRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *MetadataRegisterWorkflowRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *MetadataRegisterWorkflowRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetTasks

`func (o *MetadataRegisterWorkflowRequest) GetTasks() []Shared2d711327d8`

GetTasks returns the Tasks field if non-nil, zero value otherwise.

### GetTasksOk

`func (o *MetadataRegisterWorkflowRequest) GetTasksOk() (*[]Shared2d711327d8, bool)`

GetTasksOk returns a tuple with the Tasks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTasks

`func (o *MetadataRegisterWorkflowRequest) SetTasks(v []Shared2d711327d8)`

SetTasks sets Tasks field to given value.


### GetInputParameters

`func (o *MetadataRegisterWorkflowRequest) GetInputParameters() []string`

GetInputParameters returns the InputParameters field if non-nil, zero value otherwise.

### GetInputParametersOk

`func (o *MetadataRegisterWorkflowRequest) GetInputParametersOk() (*[]string, bool)`

GetInputParametersOk returns a tuple with the InputParameters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInputParameters

`func (o *MetadataRegisterWorkflowRequest) SetInputParameters(v []string)`

SetInputParameters sets InputParameters field to given value.

### HasInputParameters

`func (o *MetadataRegisterWorkflowRequest) HasInputParameters() bool`

HasInputParameters returns a boolean if a field has been set.

### GetOutputParameters

`func (o *MetadataRegisterWorkflowRequest) GetOutputParameters() map[string]interface{}`

GetOutputParameters returns the OutputParameters field if non-nil, zero value otherwise.

### GetOutputParametersOk

`func (o *MetadataRegisterWorkflowRequest) GetOutputParametersOk() (*map[string]interface{}, bool)`

GetOutputParametersOk returns a tuple with the OutputParameters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutputParameters

`func (o *MetadataRegisterWorkflowRequest) SetOutputParameters(v map[string]interface{})`

SetOutputParameters sets OutputParameters field to given value.

### HasOutputParameters

`func (o *MetadataRegisterWorkflowRequest) HasOutputParameters() bool`

HasOutputParameters returns a boolean if a field has been set.

### GetVariables

`func (o *MetadataRegisterWorkflowRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *MetadataRegisterWorkflowRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *MetadataRegisterWorkflowRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *MetadataRegisterWorkflowRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.

### GetInputSchema

`func (o *MetadataRegisterWorkflowRequest) GetInputSchema() interface{}`

GetInputSchema returns the InputSchema field if non-nil, zero value otherwise.

### GetInputSchemaOk

`func (o *MetadataRegisterWorkflowRequest) GetInputSchemaOk() (*interface{}, bool)`

GetInputSchemaOk returns a tuple with the InputSchema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInputSchema

`func (o *MetadataRegisterWorkflowRequest) SetInputSchema(v interface{})`

SetInputSchema sets InputSchema field to given value.

### HasInputSchema

`func (o *MetadataRegisterWorkflowRequest) HasInputSchema() bool`

HasInputSchema returns a boolean if a field has been set.

### SetInputSchemaNil

`func (o *MetadataRegisterWorkflowRequest) SetInputSchemaNil(b bool)`

 SetInputSchemaNil sets the value for InputSchema to be an explicit nil

### UnsetInputSchema
`func (o *MetadataRegisterWorkflowRequest) UnsetInputSchema()`

UnsetInputSchema ensures that no value is present for InputSchema, not even an explicit nil
### GetOutputSchema

`func (o *MetadataRegisterWorkflowRequest) GetOutputSchema() interface{}`

GetOutputSchema returns the OutputSchema field if non-nil, zero value otherwise.

### GetOutputSchemaOk

`func (o *MetadataRegisterWorkflowRequest) GetOutputSchemaOk() (*interface{}, bool)`

GetOutputSchemaOk returns a tuple with the OutputSchema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutputSchema

`func (o *MetadataRegisterWorkflowRequest) SetOutputSchema(v interface{})`

SetOutputSchema sets OutputSchema field to given value.

### HasOutputSchema

`func (o *MetadataRegisterWorkflowRequest) HasOutputSchema() bool`

HasOutputSchema returns a boolean if a field has been set.

### SetOutputSchemaNil

`func (o *MetadataRegisterWorkflowRequest) SetOutputSchemaNil(b bool)`

 SetOutputSchemaNil sets the value for OutputSchema to be an explicit nil

### UnsetOutputSchema
`func (o *MetadataRegisterWorkflowRequest) UnsetOutputSchema()`

UnsetOutputSchema ensures that no value is present for OutputSchema, not even an explicit nil
### GetFailureWorkflow

`func (o *MetadataRegisterWorkflowRequest) GetFailureWorkflow() string`

GetFailureWorkflow returns the FailureWorkflow field if non-nil, zero value otherwise.

### GetFailureWorkflowOk

`func (o *MetadataRegisterWorkflowRequest) GetFailureWorkflowOk() (*string, bool)`

GetFailureWorkflowOk returns a tuple with the FailureWorkflow field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFailureWorkflow

`func (o *MetadataRegisterWorkflowRequest) SetFailureWorkflow(v string)`

SetFailureWorkflow sets FailureWorkflow field to given value.

### HasFailureWorkflow

`func (o *MetadataRegisterWorkflowRequest) HasFailureWorkflow() bool`

HasFailureWorkflow returns a boolean if a field has been set.

### GetFailureWorkflowVersion

`func (o *MetadataRegisterWorkflowRequest) GetFailureWorkflowVersion() int32`

GetFailureWorkflowVersion returns the FailureWorkflowVersion field if non-nil, zero value otherwise.

### GetFailureWorkflowVersionOk

`func (o *MetadataRegisterWorkflowRequest) GetFailureWorkflowVersionOk() (*int32, bool)`

GetFailureWorkflowVersionOk returns a tuple with the FailureWorkflowVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFailureWorkflowVersion

`func (o *MetadataRegisterWorkflowRequest) SetFailureWorkflowVersion(v int32)`

SetFailureWorkflowVersion sets FailureWorkflowVersion field to given value.

### HasFailureWorkflowVersion

`func (o *MetadataRegisterWorkflowRequest) HasFailureWorkflowVersion() bool`

HasFailureWorkflowVersion returns a boolean if a field has been set.

### GetRestartable

`func (o *MetadataRegisterWorkflowRequest) GetRestartable() bool`

GetRestartable returns the Restartable field if non-nil, zero value otherwise.

### GetRestartableOk

`func (o *MetadataRegisterWorkflowRequest) GetRestartableOk() (*bool, bool)`

GetRestartableOk returns a tuple with the Restartable field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRestartable

`func (o *MetadataRegisterWorkflowRequest) SetRestartable(v bool)`

SetRestartable sets Restartable field to given value.

### HasRestartable

`func (o *MetadataRegisterWorkflowRequest) HasRestartable() bool`

HasRestartable returns a boolean if a field has been set.

### GetTimeoutSeconds

`func (o *MetadataRegisterWorkflowRequest) GetTimeoutSeconds() float32`

GetTimeoutSeconds returns the TimeoutSeconds field if non-nil, zero value otherwise.

### GetTimeoutSecondsOk

`func (o *MetadataRegisterWorkflowRequest) GetTimeoutSecondsOk() (*float32, bool)`

GetTimeoutSecondsOk returns a tuple with the TimeoutSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutSeconds

`func (o *MetadataRegisterWorkflowRequest) SetTimeoutSeconds(v float32)`

SetTimeoutSeconds sets TimeoutSeconds field to given value.

### HasTimeoutSeconds

`func (o *MetadataRegisterWorkflowRequest) HasTimeoutSeconds() bool`

HasTimeoutSeconds returns a boolean if a field has been set.

### GetTimeoutPolicy

`func (o *MetadataRegisterWorkflowRequest) GetTimeoutPolicy() string`

GetTimeoutPolicy returns the TimeoutPolicy field if non-nil, zero value otherwise.

### GetTimeoutPolicyOk

`func (o *MetadataRegisterWorkflowRequest) GetTimeoutPolicyOk() (*string, bool)`

GetTimeoutPolicyOk returns a tuple with the TimeoutPolicy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutPolicy

`func (o *MetadataRegisterWorkflowRequest) SetTimeoutPolicy(v string)`

SetTimeoutPolicy sets TimeoutPolicy field to given value.

### HasTimeoutPolicy

`func (o *MetadataRegisterWorkflowRequest) HasTimeoutPolicy() bool`

HasTimeoutPolicy returns a boolean if a field has been set.

### GetMaxConcurrentExecutions

`func (o *MetadataRegisterWorkflowRequest) GetMaxConcurrentExecutions() int32`

GetMaxConcurrentExecutions returns the MaxConcurrentExecutions field if non-nil, zero value otherwise.

### GetMaxConcurrentExecutionsOk

`func (o *MetadataRegisterWorkflowRequest) GetMaxConcurrentExecutionsOk() (*int32, bool)`

GetMaxConcurrentExecutionsOk returns a tuple with the MaxConcurrentExecutions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMaxConcurrentExecutions

`func (o *MetadataRegisterWorkflowRequest) SetMaxConcurrentExecutions(v int32)`

SetMaxConcurrentExecutions sets MaxConcurrentExecutions field to given value.

### HasMaxConcurrentExecutions

`func (o *MetadataRegisterWorkflowRequest) HasMaxConcurrentExecutions() bool`

HasMaxConcurrentExecutions returns a boolean if a field has been set.

### GetRateLimitConfig

`func (o *MetadataRegisterWorkflowRequest) GetRateLimitConfig() MetadataRegisterWorkflowRequestRateLimitConfig`

GetRateLimitConfig returns the RateLimitConfig field if non-nil, zero value otherwise.

### GetRateLimitConfigOk

`func (o *MetadataRegisterWorkflowRequest) GetRateLimitConfigOk() (*MetadataRegisterWorkflowRequestRateLimitConfig, bool)`

GetRateLimitConfigOk returns a tuple with the RateLimitConfig field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRateLimitConfig

`func (o *MetadataRegisterWorkflowRequest) SetRateLimitConfig(v MetadataRegisterWorkflowRequestRateLimitConfig)`

SetRateLimitConfig sets RateLimitConfig field to given value.

### HasRateLimitConfig

`func (o *MetadataRegisterWorkflowRequest) HasRateLimitConfig() bool`

HasRateLimitConfig returns a boolean if a field has been set.

### GetMaskedFields

`func (o *MetadataRegisterWorkflowRequest) GetMaskedFields() []string`

GetMaskedFields returns the MaskedFields field if non-nil, zero value otherwise.

### GetMaskedFieldsOk

`func (o *MetadataRegisterWorkflowRequest) GetMaskedFieldsOk() (*[]string, bool)`

GetMaskedFieldsOk returns a tuple with the MaskedFields field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMaskedFields

`func (o *MetadataRegisterWorkflowRequest) SetMaskedFields(v []string)`

SetMaskedFields sets MaskedFields field to given value.

### HasMaskedFields

`func (o *MetadataRegisterWorkflowRequest) HasMaskedFields() bool`

HasMaskedFields returns a boolean if a field has been set.

### GetMaxConcurrentTasks

`func (o *MetadataRegisterWorkflowRequest) GetMaxConcurrentTasks() int32`

GetMaxConcurrentTasks returns the MaxConcurrentTasks field if non-nil, zero value otherwise.

### GetMaxConcurrentTasksOk

`func (o *MetadataRegisterWorkflowRequest) GetMaxConcurrentTasksOk() (*int32, bool)`

GetMaxConcurrentTasksOk returns a tuple with the MaxConcurrentTasks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMaxConcurrentTasks

`func (o *MetadataRegisterWorkflowRequest) SetMaxConcurrentTasks(v int32)`

SetMaxConcurrentTasks sets MaxConcurrentTasks field to given value.

### HasMaxConcurrentTasks

`func (o *MetadataRegisterWorkflowRequest) HasMaxConcurrentTasks() bool`

HasMaxConcurrentTasks returns a boolean if a field has been set.

### GetOwnerEmail

`func (o *MetadataRegisterWorkflowRequest) GetOwnerEmail() string`

GetOwnerEmail returns the OwnerEmail field if non-nil, zero value otherwise.

### GetOwnerEmailOk

`func (o *MetadataRegisterWorkflowRequest) GetOwnerEmailOk() (*string, bool)`

GetOwnerEmailOk returns a tuple with the OwnerEmail field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerEmail

`func (o *MetadataRegisterWorkflowRequest) SetOwnerEmail(v string)`

SetOwnerEmail sets OwnerEmail field to given value.

### HasOwnerEmail

`func (o *MetadataRegisterWorkflowRequest) HasOwnerEmail() bool`

HasOwnerEmail returns a boolean if a field has been set.

### GetTags

`func (o *MetadataRegisterWorkflowRequest) GetTags() []string`

GetTags returns the Tags field if non-nil, zero value otherwise.

### GetTagsOk

`func (o *MetadataRegisterWorkflowRequest) GetTagsOk() (*[]string, bool)`

GetTagsOk returns a tuple with the Tags field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTags

`func (o *MetadataRegisterWorkflowRequest) SetTags(v []string)`

SetTags sets Tags field to given value.

### HasTags

`func (o *MetadataRegisterWorkflowRequest) HasTags() bool`

HasTags returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


