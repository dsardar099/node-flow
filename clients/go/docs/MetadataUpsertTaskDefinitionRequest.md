# MetadataUpsertTaskDefinitionRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**Description** | Pointer to **NullableString** |  | [optional] 
**InputKeys** | Pointer to **[]string** |  | [optional] [default to []]
**OutputKeys** | Pointer to **[]string** |  | [optional] [default to []]
**InputSchema** | Pointer to **interface{}** |  | [optional] 
**OutputSchema** | Pointer to **interface{}** |  | [optional] 
**SecretOutputFields** | Pointer to **[]string** |  | [optional] [default to []]
**OwnerEmail** | Pointer to **string** |  | [optional] 
**RetryCount** | Pointer to **int32** |  | [optional] [default to 3]
**RetryLogic** | Pointer to **string** |  | [optional] [default to "EXPONENTIAL_BACKOFF"]
**RetryDelaySeconds** | Pointer to **float32** |  | [optional] [default to 1]
**BackoffScaleFactor** | Pointer to **float32** |  | [optional] [default to 2]
**MaxRetryDelaySeconds** | Pointer to **float32** |  | [optional] [default to 3600]
**Jitter** | Pointer to **float32** |  | [optional] [default to 0.2]
**RetryBudget** | Pointer to **float32** |  | [optional] [default to 0.3]
**NonRetryableErrors** | Pointer to **[]string** |  | [optional] [default to []]
**TimeoutSeconds** | Pointer to **float32** |  | [optional] [default to 0]
**ScheduleToStartTimeout** | Pointer to **float32** |  | [optional] [default to 0]
**StartToCloseTimeout** | Pointer to **float32** |  | [optional] [default to 0]
**HeartbeatTimeout** | Pointer to **float32** |  | [optional] [default to 0]
**ResponseTimeoutSeconds** | Pointer to **float32** |  | [optional] [default to 3600]
**PollTimeoutSeconds** | Pointer to **float32** |  | [optional] [default to 30]
**TimeoutPolicy** | Pointer to **string** |  | [optional] [default to "TIME_OUT_WF"]
**ConcurrentExecLimit** | Pointer to **int32** |  | [optional] [default to 0]
**RateLimitPerFrequency** | Pointer to **int32** |  | [optional] [default to 0]
**RateLimitFrequencySeconds** | Pointer to **int32** |  | [optional] [default to 1]
**Semaphores** | Pointer to **[]string** |  | [optional] [default to []]

## Methods

### NewMetadataUpsertTaskDefinitionRequest

`func NewMetadataUpsertTaskDefinitionRequest(name string, ) *MetadataUpsertTaskDefinitionRequest`

NewMetadataUpsertTaskDefinitionRequest instantiates a new MetadataUpsertTaskDefinitionRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMetadataUpsertTaskDefinitionRequestWithDefaults

`func NewMetadataUpsertTaskDefinitionRequestWithDefaults() *MetadataUpsertTaskDefinitionRequest`

NewMetadataUpsertTaskDefinitionRequestWithDefaults instantiates a new MetadataUpsertTaskDefinitionRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *MetadataUpsertTaskDefinitionRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *MetadataUpsertTaskDefinitionRequest) SetName(v string)`

SetName sets Name field to given value.


### GetDescription

`func (o *MetadataUpsertTaskDefinitionRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *MetadataUpsertTaskDefinitionRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *MetadataUpsertTaskDefinitionRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### SetDescriptionNil

`func (o *MetadataUpsertTaskDefinitionRequest) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *MetadataUpsertTaskDefinitionRequest) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetInputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) GetInputKeys() []string`

GetInputKeys returns the InputKeys field if non-nil, zero value otherwise.

### GetInputKeysOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetInputKeysOk() (*[]string, bool)`

GetInputKeysOk returns a tuple with the InputKeys field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) SetInputKeys(v []string)`

SetInputKeys sets InputKeys field to given value.

### HasInputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) HasInputKeys() bool`

HasInputKeys returns a boolean if a field has been set.

### GetOutputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) GetOutputKeys() []string`

GetOutputKeys returns the OutputKeys field if non-nil, zero value otherwise.

### GetOutputKeysOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetOutputKeysOk() (*[]string, bool)`

GetOutputKeysOk returns a tuple with the OutputKeys field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) SetOutputKeys(v []string)`

SetOutputKeys sets OutputKeys field to given value.

### HasOutputKeys

`func (o *MetadataUpsertTaskDefinitionRequest) HasOutputKeys() bool`

HasOutputKeys returns a boolean if a field has been set.

### GetInputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) GetInputSchema() interface{}`

GetInputSchema returns the InputSchema field if non-nil, zero value otherwise.

### GetInputSchemaOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetInputSchemaOk() (*interface{}, bool)`

GetInputSchemaOk returns a tuple with the InputSchema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) SetInputSchema(v interface{})`

SetInputSchema sets InputSchema field to given value.

### HasInputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) HasInputSchema() bool`

HasInputSchema returns a boolean if a field has been set.

### SetInputSchemaNil

`func (o *MetadataUpsertTaskDefinitionRequest) SetInputSchemaNil(b bool)`

 SetInputSchemaNil sets the value for InputSchema to be an explicit nil

### UnsetInputSchema
`func (o *MetadataUpsertTaskDefinitionRequest) UnsetInputSchema()`

UnsetInputSchema ensures that no value is present for InputSchema, not even an explicit nil
### GetOutputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) GetOutputSchema() interface{}`

GetOutputSchema returns the OutputSchema field if non-nil, zero value otherwise.

### GetOutputSchemaOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetOutputSchemaOk() (*interface{}, bool)`

GetOutputSchemaOk returns a tuple with the OutputSchema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOutputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) SetOutputSchema(v interface{})`

SetOutputSchema sets OutputSchema field to given value.

### HasOutputSchema

`func (o *MetadataUpsertTaskDefinitionRequest) HasOutputSchema() bool`

HasOutputSchema returns a boolean if a field has been set.

### SetOutputSchemaNil

`func (o *MetadataUpsertTaskDefinitionRequest) SetOutputSchemaNil(b bool)`

 SetOutputSchemaNil sets the value for OutputSchema to be an explicit nil

### UnsetOutputSchema
`func (o *MetadataUpsertTaskDefinitionRequest) UnsetOutputSchema()`

UnsetOutputSchema ensures that no value is present for OutputSchema, not even an explicit nil
### GetSecretOutputFields

`func (o *MetadataUpsertTaskDefinitionRequest) GetSecretOutputFields() []string`

GetSecretOutputFields returns the SecretOutputFields field if non-nil, zero value otherwise.

### GetSecretOutputFieldsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetSecretOutputFieldsOk() (*[]string, bool)`

GetSecretOutputFieldsOk returns a tuple with the SecretOutputFields field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecretOutputFields

`func (o *MetadataUpsertTaskDefinitionRequest) SetSecretOutputFields(v []string)`

SetSecretOutputFields sets SecretOutputFields field to given value.

### HasSecretOutputFields

`func (o *MetadataUpsertTaskDefinitionRequest) HasSecretOutputFields() bool`

HasSecretOutputFields returns a boolean if a field has been set.

### GetOwnerEmail

`func (o *MetadataUpsertTaskDefinitionRequest) GetOwnerEmail() string`

GetOwnerEmail returns the OwnerEmail field if non-nil, zero value otherwise.

### GetOwnerEmailOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetOwnerEmailOk() (*string, bool)`

GetOwnerEmailOk returns a tuple with the OwnerEmail field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOwnerEmail

`func (o *MetadataUpsertTaskDefinitionRequest) SetOwnerEmail(v string)`

SetOwnerEmail sets OwnerEmail field to given value.

### HasOwnerEmail

`func (o *MetadataUpsertTaskDefinitionRequest) HasOwnerEmail() bool`

HasOwnerEmail returns a boolean if a field has been set.

### GetRetryCount

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryCount() int32`

GetRetryCount returns the RetryCount field if non-nil, zero value otherwise.

### GetRetryCountOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryCountOk() (*int32, bool)`

GetRetryCountOk returns a tuple with the RetryCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryCount

`func (o *MetadataUpsertTaskDefinitionRequest) SetRetryCount(v int32)`

SetRetryCount sets RetryCount field to given value.

### HasRetryCount

`func (o *MetadataUpsertTaskDefinitionRequest) HasRetryCount() bool`

HasRetryCount returns a boolean if a field has been set.

### GetRetryLogic

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryLogic() string`

GetRetryLogic returns the RetryLogic field if non-nil, zero value otherwise.

### GetRetryLogicOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryLogicOk() (*string, bool)`

GetRetryLogicOk returns a tuple with the RetryLogic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryLogic

`func (o *MetadataUpsertTaskDefinitionRequest) SetRetryLogic(v string)`

SetRetryLogic sets RetryLogic field to given value.

### HasRetryLogic

`func (o *MetadataUpsertTaskDefinitionRequest) HasRetryLogic() bool`

HasRetryLogic returns a boolean if a field has been set.

### GetRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryDelaySeconds() float32`

GetRetryDelaySeconds returns the RetryDelaySeconds field if non-nil, zero value otherwise.

### GetRetryDelaySecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryDelaySecondsOk() (*float32, bool)`

GetRetryDelaySecondsOk returns a tuple with the RetryDelaySeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetRetryDelaySeconds(v float32)`

SetRetryDelaySeconds sets RetryDelaySeconds field to given value.

### HasRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasRetryDelaySeconds() bool`

HasRetryDelaySeconds returns a boolean if a field has been set.

### GetBackoffScaleFactor

`func (o *MetadataUpsertTaskDefinitionRequest) GetBackoffScaleFactor() float32`

GetBackoffScaleFactor returns the BackoffScaleFactor field if non-nil, zero value otherwise.

### GetBackoffScaleFactorOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetBackoffScaleFactorOk() (*float32, bool)`

GetBackoffScaleFactorOk returns a tuple with the BackoffScaleFactor field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBackoffScaleFactor

`func (o *MetadataUpsertTaskDefinitionRequest) SetBackoffScaleFactor(v float32)`

SetBackoffScaleFactor sets BackoffScaleFactor field to given value.

### HasBackoffScaleFactor

`func (o *MetadataUpsertTaskDefinitionRequest) HasBackoffScaleFactor() bool`

HasBackoffScaleFactor returns a boolean if a field has been set.

### GetMaxRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetMaxRetryDelaySeconds() float32`

GetMaxRetryDelaySeconds returns the MaxRetryDelaySeconds field if non-nil, zero value otherwise.

### GetMaxRetryDelaySecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetMaxRetryDelaySecondsOk() (*float32, bool)`

GetMaxRetryDelaySecondsOk returns a tuple with the MaxRetryDelaySeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMaxRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetMaxRetryDelaySeconds(v float32)`

SetMaxRetryDelaySeconds sets MaxRetryDelaySeconds field to given value.

### HasMaxRetryDelaySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasMaxRetryDelaySeconds() bool`

HasMaxRetryDelaySeconds returns a boolean if a field has been set.

### GetJitter

`func (o *MetadataUpsertTaskDefinitionRequest) GetJitter() float32`

GetJitter returns the Jitter field if non-nil, zero value otherwise.

### GetJitterOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetJitterOk() (*float32, bool)`

GetJitterOk returns a tuple with the Jitter field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetJitter

`func (o *MetadataUpsertTaskDefinitionRequest) SetJitter(v float32)`

SetJitter sets Jitter field to given value.

### HasJitter

`func (o *MetadataUpsertTaskDefinitionRequest) HasJitter() bool`

HasJitter returns a boolean if a field has been set.

### GetRetryBudget

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryBudget() float32`

GetRetryBudget returns the RetryBudget field if non-nil, zero value otherwise.

### GetRetryBudgetOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRetryBudgetOk() (*float32, bool)`

GetRetryBudgetOk returns a tuple with the RetryBudget field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryBudget

`func (o *MetadataUpsertTaskDefinitionRequest) SetRetryBudget(v float32)`

SetRetryBudget sets RetryBudget field to given value.

### HasRetryBudget

`func (o *MetadataUpsertTaskDefinitionRequest) HasRetryBudget() bool`

HasRetryBudget returns a boolean if a field has been set.

### GetNonRetryableErrors

`func (o *MetadataUpsertTaskDefinitionRequest) GetNonRetryableErrors() []string`

GetNonRetryableErrors returns the NonRetryableErrors field if non-nil, zero value otherwise.

### GetNonRetryableErrorsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetNonRetryableErrorsOk() (*[]string, bool)`

GetNonRetryableErrorsOk returns a tuple with the NonRetryableErrors field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetNonRetryableErrors

`func (o *MetadataUpsertTaskDefinitionRequest) SetNonRetryableErrors(v []string)`

SetNonRetryableErrors sets NonRetryableErrors field to given value.

### HasNonRetryableErrors

`func (o *MetadataUpsertTaskDefinitionRequest) HasNonRetryableErrors() bool`

HasNonRetryableErrors returns a boolean if a field has been set.

### GetTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetTimeoutSeconds() float32`

GetTimeoutSeconds returns the TimeoutSeconds field if non-nil, zero value otherwise.

### GetTimeoutSecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetTimeoutSecondsOk() (*float32, bool)`

GetTimeoutSecondsOk returns a tuple with the TimeoutSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetTimeoutSeconds(v float32)`

SetTimeoutSeconds sets TimeoutSeconds field to given value.

### HasTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasTimeoutSeconds() bool`

HasTimeoutSeconds returns a boolean if a field has been set.

### GetScheduleToStartTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) GetScheduleToStartTimeout() float32`

GetScheduleToStartTimeout returns the ScheduleToStartTimeout field if non-nil, zero value otherwise.

### GetScheduleToStartTimeoutOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetScheduleToStartTimeoutOk() (*float32, bool)`

GetScheduleToStartTimeoutOk returns a tuple with the ScheduleToStartTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetScheduleToStartTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) SetScheduleToStartTimeout(v float32)`

SetScheduleToStartTimeout sets ScheduleToStartTimeout field to given value.

### HasScheduleToStartTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) HasScheduleToStartTimeout() bool`

HasScheduleToStartTimeout returns a boolean if a field has been set.

### GetStartToCloseTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) GetStartToCloseTimeout() float32`

GetStartToCloseTimeout returns the StartToCloseTimeout field if non-nil, zero value otherwise.

### GetStartToCloseTimeoutOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetStartToCloseTimeoutOk() (*float32, bool)`

GetStartToCloseTimeoutOk returns a tuple with the StartToCloseTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStartToCloseTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) SetStartToCloseTimeout(v float32)`

SetStartToCloseTimeout sets StartToCloseTimeout field to given value.

### HasStartToCloseTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) HasStartToCloseTimeout() bool`

HasStartToCloseTimeout returns a boolean if a field has been set.

### GetHeartbeatTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) GetHeartbeatTimeout() float32`

GetHeartbeatTimeout returns the HeartbeatTimeout field if non-nil, zero value otherwise.

### GetHeartbeatTimeoutOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetHeartbeatTimeoutOk() (*float32, bool)`

GetHeartbeatTimeoutOk returns a tuple with the HeartbeatTimeout field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHeartbeatTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) SetHeartbeatTimeout(v float32)`

SetHeartbeatTimeout sets HeartbeatTimeout field to given value.

### HasHeartbeatTimeout

`func (o *MetadataUpsertTaskDefinitionRequest) HasHeartbeatTimeout() bool`

HasHeartbeatTimeout returns a boolean if a field has been set.

### GetResponseTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetResponseTimeoutSeconds() float32`

GetResponseTimeoutSeconds returns the ResponseTimeoutSeconds field if non-nil, zero value otherwise.

### GetResponseTimeoutSecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetResponseTimeoutSecondsOk() (*float32, bool)`

GetResponseTimeoutSecondsOk returns a tuple with the ResponseTimeoutSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResponseTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetResponseTimeoutSeconds(v float32)`

SetResponseTimeoutSeconds sets ResponseTimeoutSeconds field to given value.

### HasResponseTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasResponseTimeoutSeconds() bool`

HasResponseTimeoutSeconds returns a boolean if a field has been set.

### GetPollTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetPollTimeoutSeconds() float32`

GetPollTimeoutSeconds returns the PollTimeoutSeconds field if non-nil, zero value otherwise.

### GetPollTimeoutSecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetPollTimeoutSecondsOk() (*float32, bool)`

GetPollTimeoutSecondsOk returns a tuple with the PollTimeoutSeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPollTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetPollTimeoutSeconds(v float32)`

SetPollTimeoutSeconds sets PollTimeoutSeconds field to given value.

### HasPollTimeoutSeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasPollTimeoutSeconds() bool`

HasPollTimeoutSeconds returns a boolean if a field has been set.

### GetTimeoutPolicy

`func (o *MetadataUpsertTaskDefinitionRequest) GetTimeoutPolicy() string`

GetTimeoutPolicy returns the TimeoutPolicy field if non-nil, zero value otherwise.

### GetTimeoutPolicyOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetTimeoutPolicyOk() (*string, bool)`

GetTimeoutPolicyOk returns a tuple with the TimeoutPolicy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimeoutPolicy

`func (o *MetadataUpsertTaskDefinitionRequest) SetTimeoutPolicy(v string)`

SetTimeoutPolicy sets TimeoutPolicy field to given value.

### HasTimeoutPolicy

`func (o *MetadataUpsertTaskDefinitionRequest) HasTimeoutPolicy() bool`

HasTimeoutPolicy returns a boolean if a field has been set.

### GetConcurrentExecLimit

`func (o *MetadataUpsertTaskDefinitionRequest) GetConcurrentExecLimit() int32`

GetConcurrentExecLimit returns the ConcurrentExecLimit field if non-nil, zero value otherwise.

### GetConcurrentExecLimitOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetConcurrentExecLimitOk() (*int32, bool)`

GetConcurrentExecLimitOk returns a tuple with the ConcurrentExecLimit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConcurrentExecLimit

`func (o *MetadataUpsertTaskDefinitionRequest) SetConcurrentExecLimit(v int32)`

SetConcurrentExecLimit sets ConcurrentExecLimit field to given value.

### HasConcurrentExecLimit

`func (o *MetadataUpsertTaskDefinitionRequest) HasConcurrentExecLimit() bool`

HasConcurrentExecLimit returns a boolean if a field has been set.

### GetRateLimitPerFrequency

`func (o *MetadataUpsertTaskDefinitionRequest) GetRateLimitPerFrequency() int32`

GetRateLimitPerFrequency returns the RateLimitPerFrequency field if non-nil, zero value otherwise.

### GetRateLimitPerFrequencyOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRateLimitPerFrequencyOk() (*int32, bool)`

GetRateLimitPerFrequencyOk returns a tuple with the RateLimitPerFrequency field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRateLimitPerFrequency

`func (o *MetadataUpsertTaskDefinitionRequest) SetRateLimitPerFrequency(v int32)`

SetRateLimitPerFrequency sets RateLimitPerFrequency field to given value.

### HasRateLimitPerFrequency

`func (o *MetadataUpsertTaskDefinitionRequest) HasRateLimitPerFrequency() bool`

HasRateLimitPerFrequency returns a boolean if a field has been set.

### GetRateLimitFrequencySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) GetRateLimitFrequencySeconds() int32`

GetRateLimitFrequencySeconds returns the RateLimitFrequencySeconds field if non-nil, zero value otherwise.

### GetRateLimitFrequencySecondsOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetRateLimitFrequencySecondsOk() (*int32, bool)`

GetRateLimitFrequencySecondsOk returns a tuple with the RateLimitFrequencySeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRateLimitFrequencySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) SetRateLimitFrequencySeconds(v int32)`

SetRateLimitFrequencySeconds sets RateLimitFrequencySeconds field to given value.

### HasRateLimitFrequencySeconds

`func (o *MetadataUpsertTaskDefinitionRequest) HasRateLimitFrequencySeconds() bool`

HasRateLimitFrequencySeconds returns a boolean if a field has been set.

### GetSemaphores

`func (o *MetadataUpsertTaskDefinitionRequest) GetSemaphores() []string`

GetSemaphores returns the Semaphores field if non-nil, zero value otherwise.

### GetSemaphoresOk

`func (o *MetadataUpsertTaskDefinitionRequest) GetSemaphoresOk() (*[]string, bool)`

GetSemaphoresOk returns a tuple with the Semaphores field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSemaphores

`func (o *MetadataUpsertTaskDefinitionRequest) SetSemaphores(v []string)`

SetSemaphores sets Semaphores field to given value.

### HasSemaphores

`func (o *MetadataUpsertTaskDefinitionRequest) HasSemaphores() bool`

HasSemaphores returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


