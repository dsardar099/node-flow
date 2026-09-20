# Shared2d711327d8CompensateWith

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | **string** |  | 
**TaskReferenceName** | **string** |  | 
**Type** | **string** |  | 
**Description** | Pointer to **string** |  | [optional] 
**InputParameters** | Pointer to **map[string]interface{}** |  | [optional] 
**Optional** | Pointer to **bool** |  | [optional] 
**AsyncComplete** | Pointer to **bool** |  | [optional] 
**StartDelaySeconds** | Pointer to **float32** |  | [optional] 
**CacheConfig** | Pointer to [**Shared2d711327d8CacheConfig**](Shared2d711327d8CacheConfig.md) |  | [optional] 
**RetryCount** | Pointer to **int32** |  | [optional] 
**Domain** | Pointer to **string** |  | [optional] 
**EvaluatorType** | Pointer to **string** |  | [optional] 
**Expression** | Pointer to **string** |  | [optional] 
**DecisionCases** | Pointer to [**map[string][]Shared2d711327d8**](array.md) |  | [optional] 
**DefaultCase** | Pointer to [**[]Shared2d711327d8**](Shared2d711327d8.md) |  | [optional] 
**ForkTasks** | Pointer to [**[][]Shared2d711327d8**]([]Shared2d711327d8.md) |  | [optional] 
**DynamicForkTasksParam** | Pointer to **string** |  | [optional] 
**DynamicForkTasksInputParamName** | Pointer to **string** |  | [optional] 
**JoinOn** | Pointer to **[]string** |  | [optional] 
**LoopCondition** | Pointer to **string** |  | [optional] 
**LoopOver** | Pointer to [**[]Shared2d711327d8**](Shared2d711327d8.md) |  | [optional] 
**DynamicTaskNameParam** | Pointer to **string** |  | [optional] 
**SubWorkflowParam** | Pointer to [**Shared2d711327d8SubWorkflowParam**](Shared2d711327d8SubWorkflowParam.md) |  | [optional] 
**CompensateWith** | Pointer to [**Shared2d711327d8CompensateWith**](Shared2d711327d8CompensateWith.md) |  | [optional] 

## Methods

### NewShared2d711327d8CompensateWith

`func NewShared2d711327d8CompensateWith(name string, taskReferenceName string, type_ string, ) *Shared2d711327d8CompensateWith`

NewShared2d711327d8CompensateWith instantiates a new Shared2d711327d8CompensateWith object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewShared2d711327d8CompensateWithWithDefaults

`func NewShared2d711327d8CompensateWithWithDefaults() *Shared2d711327d8CompensateWith`

NewShared2d711327d8CompensateWithWithDefaults instantiates a new Shared2d711327d8CompensateWith object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *Shared2d711327d8CompensateWith) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *Shared2d711327d8CompensateWith) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *Shared2d711327d8CompensateWith) SetName(v string)`

SetName sets Name field to given value.


### GetTaskReferenceName

`func (o *Shared2d711327d8CompensateWith) GetTaskReferenceName() string`

GetTaskReferenceName returns the TaskReferenceName field if non-nil, zero value otherwise.

### GetTaskReferenceNameOk

`func (o *Shared2d711327d8CompensateWith) GetTaskReferenceNameOk() (*string, bool)`

GetTaskReferenceNameOk returns a tuple with the TaskReferenceName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskReferenceName

`func (o *Shared2d711327d8CompensateWith) SetTaskReferenceName(v string)`

SetTaskReferenceName sets TaskReferenceName field to given value.


### GetType

`func (o *Shared2d711327d8CompensateWith) GetType() string`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *Shared2d711327d8CompensateWith) GetTypeOk() (*string, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *Shared2d711327d8CompensateWith) SetType(v string)`

SetType sets Type field to given value.


### GetDescription

`func (o *Shared2d711327d8CompensateWith) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *Shared2d711327d8CompensateWith) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *Shared2d711327d8CompensateWith) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *Shared2d711327d8CompensateWith) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### GetInputParameters

`func (o *Shared2d711327d8CompensateWith) GetInputParameters() map[string]interface{}`

GetInputParameters returns the InputParameters field if non-nil, zero value otherwise.

### GetInputParametersOk

`func (o *Shared2d711327d8CompensateWith) GetInputParametersOk() (*map[string]interface{}, bool)`

GetInputParametersOk returns a tuple with the InputParameters field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInputParameters

`func (o *Shared2d711327d8CompensateWith) SetInputParameters(v map[string]interface{})`

SetInputParameters sets InputParameters field to given value.

### HasInputParameters

`func (o *Shared2d711327d8CompensateWith) HasInputParameters() bool`

HasInputParameters returns a boolean if a field has been set.

### GetOptional

`func (o *Shared2d711327d8CompensateWith) GetOptional() bool`

GetOptional returns the Optional field if non-nil, zero value otherwise.

### GetOptionalOk

`func (o *Shared2d711327d8CompensateWith) GetOptionalOk() (*bool, bool)`

GetOptionalOk returns a tuple with the Optional field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOptional

`func (o *Shared2d711327d8CompensateWith) SetOptional(v bool)`

SetOptional sets Optional field to given value.

### HasOptional

`func (o *Shared2d711327d8CompensateWith) HasOptional() bool`

HasOptional returns a boolean if a field has been set.

### GetAsyncComplete

`func (o *Shared2d711327d8CompensateWith) GetAsyncComplete() bool`

GetAsyncComplete returns the AsyncComplete field if non-nil, zero value otherwise.

### GetAsyncCompleteOk

`func (o *Shared2d711327d8CompensateWith) GetAsyncCompleteOk() (*bool, bool)`

GetAsyncCompleteOk returns a tuple with the AsyncComplete field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAsyncComplete

`func (o *Shared2d711327d8CompensateWith) SetAsyncComplete(v bool)`

SetAsyncComplete sets AsyncComplete field to given value.

### HasAsyncComplete

`func (o *Shared2d711327d8CompensateWith) HasAsyncComplete() bool`

HasAsyncComplete returns a boolean if a field has been set.

### GetStartDelaySeconds

`func (o *Shared2d711327d8CompensateWith) GetStartDelaySeconds() float32`

GetStartDelaySeconds returns the StartDelaySeconds field if non-nil, zero value otherwise.

### GetStartDelaySecondsOk

`func (o *Shared2d711327d8CompensateWith) GetStartDelaySecondsOk() (*float32, bool)`

GetStartDelaySecondsOk returns a tuple with the StartDelaySeconds field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStartDelaySeconds

`func (o *Shared2d711327d8CompensateWith) SetStartDelaySeconds(v float32)`

SetStartDelaySeconds sets StartDelaySeconds field to given value.

### HasStartDelaySeconds

`func (o *Shared2d711327d8CompensateWith) HasStartDelaySeconds() bool`

HasStartDelaySeconds returns a boolean if a field has been set.

### GetCacheConfig

`func (o *Shared2d711327d8CompensateWith) GetCacheConfig() Shared2d711327d8CacheConfig`

GetCacheConfig returns the CacheConfig field if non-nil, zero value otherwise.

### GetCacheConfigOk

`func (o *Shared2d711327d8CompensateWith) GetCacheConfigOk() (*Shared2d711327d8CacheConfig, bool)`

GetCacheConfigOk returns a tuple with the CacheConfig field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCacheConfig

`func (o *Shared2d711327d8CompensateWith) SetCacheConfig(v Shared2d711327d8CacheConfig)`

SetCacheConfig sets CacheConfig field to given value.

### HasCacheConfig

`func (o *Shared2d711327d8CompensateWith) HasCacheConfig() bool`

HasCacheConfig returns a boolean if a field has been set.

### GetRetryCount

`func (o *Shared2d711327d8CompensateWith) GetRetryCount() int32`

GetRetryCount returns the RetryCount field if non-nil, zero value otherwise.

### GetRetryCountOk

`func (o *Shared2d711327d8CompensateWith) GetRetryCountOk() (*int32, bool)`

GetRetryCountOk returns a tuple with the RetryCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRetryCount

`func (o *Shared2d711327d8CompensateWith) SetRetryCount(v int32)`

SetRetryCount sets RetryCount field to given value.

### HasRetryCount

`func (o *Shared2d711327d8CompensateWith) HasRetryCount() bool`

HasRetryCount returns a boolean if a field has been set.

### GetDomain

`func (o *Shared2d711327d8CompensateWith) GetDomain() string`

GetDomain returns the Domain field if non-nil, zero value otherwise.

### GetDomainOk

`func (o *Shared2d711327d8CompensateWith) GetDomainOk() (*string, bool)`

GetDomainOk returns a tuple with the Domain field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDomain

`func (o *Shared2d711327d8CompensateWith) SetDomain(v string)`

SetDomain sets Domain field to given value.

### HasDomain

`func (o *Shared2d711327d8CompensateWith) HasDomain() bool`

HasDomain returns a boolean if a field has been set.

### GetEvaluatorType

`func (o *Shared2d711327d8CompensateWith) GetEvaluatorType() string`

GetEvaluatorType returns the EvaluatorType field if non-nil, zero value otherwise.

### GetEvaluatorTypeOk

`func (o *Shared2d711327d8CompensateWith) GetEvaluatorTypeOk() (*string, bool)`

GetEvaluatorTypeOk returns a tuple with the EvaluatorType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvaluatorType

`func (o *Shared2d711327d8CompensateWith) SetEvaluatorType(v string)`

SetEvaluatorType sets EvaluatorType field to given value.

### HasEvaluatorType

`func (o *Shared2d711327d8CompensateWith) HasEvaluatorType() bool`

HasEvaluatorType returns a boolean if a field has been set.

### GetExpression

`func (o *Shared2d711327d8CompensateWith) GetExpression() string`

GetExpression returns the Expression field if non-nil, zero value otherwise.

### GetExpressionOk

`func (o *Shared2d711327d8CompensateWith) GetExpressionOk() (*string, bool)`

GetExpressionOk returns a tuple with the Expression field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpression

`func (o *Shared2d711327d8CompensateWith) SetExpression(v string)`

SetExpression sets Expression field to given value.

### HasExpression

`func (o *Shared2d711327d8CompensateWith) HasExpression() bool`

HasExpression returns a boolean if a field has been set.

### GetDecisionCases

`func (o *Shared2d711327d8CompensateWith) GetDecisionCases() map[string][]Shared2d711327d8`

GetDecisionCases returns the DecisionCases field if non-nil, zero value otherwise.

### GetDecisionCasesOk

`func (o *Shared2d711327d8CompensateWith) GetDecisionCasesOk() (*map[string][]Shared2d711327d8, bool)`

GetDecisionCasesOk returns a tuple with the DecisionCases field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDecisionCases

`func (o *Shared2d711327d8CompensateWith) SetDecisionCases(v map[string][]Shared2d711327d8)`

SetDecisionCases sets DecisionCases field to given value.

### HasDecisionCases

`func (o *Shared2d711327d8CompensateWith) HasDecisionCases() bool`

HasDecisionCases returns a boolean if a field has been set.

### GetDefaultCase

`func (o *Shared2d711327d8CompensateWith) GetDefaultCase() []Shared2d711327d8`

GetDefaultCase returns the DefaultCase field if non-nil, zero value otherwise.

### GetDefaultCaseOk

`func (o *Shared2d711327d8CompensateWith) GetDefaultCaseOk() (*[]Shared2d711327d8, bool)`

GetDefaultCaseOk returns a tuple with the DefaultCase field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultCase

`func (o *Shared2d711327d8CompensateWith) SetDefaultCase(v []Shared2d711327d8)`

SetDefaultCase sets DefaultCase field to given value.

### HasDefaultCase

`func (o *Shared2d711327d8CompensateWith) HasDefaultCase() bool`

HasDefaultCase returns a boolean if a field has been set.

### GetForkTasks

`func (o *Shared2d711327d8CompensateWith) GetForkTasks() [][]Shared2d711327d8`

GetForkTasks returns the ForkTasks field if non-nil, zero value otherwise.

### GetForkTasksOk

`func (o *Shared2d711327d8CompensateWith) GetForkTasksOk() (*[][]Shared2d711327d8, bool)`

GetForkTasksOk returns a tuple with the ForkTasks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetForkTasks

`func (o *Shared2d711327d8CompensateWith) SetForkTasks(v [][]Shared2d711327d8)`

SetForkTasks sets ForkTasks field to given value.

### HasForkTasks

`func (o *Shared2d711327d8CompensateWith) HasForkTasks() bool`

HasForkTasks returns a boolean if a field has been set.

### GetDynamicForkTasksParam

`func (o *Shared2d711327d8CompensateWith) GetDynamicForkTasksParam() string`

GetDynamicForkTasksParam returns the DynamicForkTasksParam field if non-nil, zero value otherwise.

### GetDynamicForkTasksParamOk

`func (o *Shared2d711327d8CompensateWith) GetDynamicForkTasksParamOk() (*string, bool)`

GetDynamicForkTasksParamOk returns a tuple with the DynamicForkTasksParam field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDynamicForkTasksParam

`func (o *Shared2d711327d8CompensateWith) SetDynamicForkTasksParam(v string)`

SetDynamicForkTasksParam sets DynamicForkTasksParam field to given value.

### HasDynamicForkTasksParam

`func (o *Shared2d711327d8CompensateWith) HasDynamicForkTasksParam() bool`

HasDynamicForkTasksParam returns a boolean if a field has been set.

### GetDynamicForkTasksInputParamName

`func (o *Shared2d711327d8CompensateWith) GetDynamicForkTasksInputParamName() string`

GetDynamicForkTasksInputParamName returns the DynamicForkTasksInputParamName field if non-nil, zero value otherwise.

### GetDynamicForkTasksInputParamNameOk

`func (o *Shared2d711327d8CompensateWith) GetDynamicForkTasksInputParamNameOk() (*string, bool)`

GetDynamicForkTasksInputParamNameOk returns a tuple with the DynamicForkTasksInputParamName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDynamicForkTasksInputParamName

`func (o *Shared2d711327d8CompensateWith) SetDynamicForkTasksInputParamName(v string)`

SetDynamicForkTasksInputParamName sets DynamicForkTasksInputParamName field to given value.

### HasDynamicForkTasksInputParamName

`func (o *Shared2d711327d8CompensateWith) HasDynamicForkTasksInputParamName() bool`

HasDynamicForkTasksInputParamName returns a boolean if a field has been set.

### GetJoinOn

`func (o *Shared2d711327d8CompensateWith) GetJoinOn() []string`

GetJoinOn returns the JoinOn field if non-nil, zero value otherwise.

### GetJoinOnOk

`func (o *Shared2d711327d8CompensateWith) GetJoinOnOk() (*[]string, bool)`

GetJoinOnOk returns a tuple with the JoinOn field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetJoinOn

`func (o *Shared2d711327d8CompensateWith) SetJoinOn(v []string)`

SetJoinOn sets JoinOn field to given value.

### HasJoinOn

`func (o *Shared2d711327d8CompensateWith) HasJoinOn() bool`

HasJoinOn returns a boolean if a field has been set.

### GetLoopCondition

`func (o *Shared2d711327d8CompensateWith) GetLoopCondition() string`

GetLoopCondition returns the LoopCondition field if non-nil, zero value otherwise.

### GetLoopConditionOk

`func (o *Shared2d711327d8CompensateWith) GetLoopConditionOk() (*string, bool)`

GetLoopConditionOk returns a tuple with the LoopCondition field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLoopCondition

`func (o *Shared2d711327d8CompensateWith) SetLoopCondition(v string)`

SetLoopCondition sets LoopCondition field to given value.

### HasLoopCondition

`func (o *Shared2d711327d8CompensateWith) HasLoopCondition() bool`

HasLoopCondition returns a boolean if a field has been set.

### GetLoopOver

`func (o *Shared2d711327d8CompensateWith) GetLoopOver() []Shared2d711327d8`

GetLoopOver returns the LoopOver field if non-nil, zero value otherwise.

### GetLoopOverOk

`func (o *Shared2d711327d8CompensateWith) GetLoopOverOk() (*[]Shared2d711327d8, bool)`

GetLoopOverOk returns a tuple with the LoopOver field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLoopOver

`func (o *Shared2d711327d8CompensateWith) SetLoopOver(v []Shared2d711327d8)`

SetLoopOver sets LoopOver field to given value.

### HasLoopOver

`func (o *Shared2d711327d8CompensateWith) HasLoopOver() bool`

HasLoopOver returns a boolean if a field has been set.

### GetDynamicTaskNameParam

`func (o *Shared2d711327d8CompensateWith) GetDynamicTaskNameParam() string`

GetDynamicTaskNameParam returns the DynamicTaskNameParam field if non-nil, zero value otherwise.

### GetDynamicTaskNameParamOk

`func (o *Shared2d711327d8CompensateWith) GetDynamicTaskNameParamOk() (*string, bool)`

GetDynamicTaskNameParamOk returns a tuple with the DynamicTaskNameParam field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDynamicTaskNameParam

`func (o *Shared2d711327d8CompensateWith) SetDynamicTaskNameParam(v string)`

SetDynamicTaskNameParam sets DynamicTaskNameParam field to given value.

### HasDynamicTaskNameParam

`func (o *Shared2d711327d8CompensateWith) HasDynamicTaskNameParam() bool`

HasDynamicTaskNameParam returns a boolean if a field has been set.

### GetSubWorkflowParam

`func (o *Shared2d711327d8CompensateWith) GetSubWorkflowParam() Shared2d711327d8SubWorkflowParam`

GetSubWorkflowParam returns the SubWorkflowParam field if non-nil, zero value otherwise.

### GetSubWorkflowParamOk

`func (o *Shared2d711327d8CompensateWith) GetSubWorkflowParamOk() (*Shared2d711327d8SubWorkflowParam, bool)`

GetSubWorkflowParamOk returns a tuple with the SubWorkflowParam field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubWorkflowParam

`func (o *Shared2d711327d8CompensateWith) SetSubWorkflowParam(v Shared2d711327d8SubWorkflowParam)`

SetSubWorkflowParam sets SubWorkflowParam field to given value.

### HasSubWorkflowParam

`func (o *Shared2d711327d8CompensateWith) HasSubWorkflowParam() bool`

HasSubWorkflowParam returns a boolean if a field has been set.

### GetCompensateWith

`func (o *Shared2d711327d8CompensateWith) GetCompensateWith() Shared2d711327d8CompensateWith`

GetCompensateWith returns the CompensateWith field if non-nil, zero value otherwise.

### GetCompensateWithOk

`func (o *Shared2d711327d8CompensateWith) GetCompensateWithOk() (*Shared2d711327d8CompensateWith, bool)`

GetCompensateWithOk returns a tuple with the CompensateWith field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCompensateWith

`func (o *Shared2d711327d8CompensateWith) SetCompensateWith(v Shared2d711327d8CompensateWith)`

SetCompensateWith sets CompensateWith field to given value.

### HasCompensateWith

`func (o *Shared2d711327d8CompensateWith) HasCompensateWith() bool`

HasCompensateWith returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


