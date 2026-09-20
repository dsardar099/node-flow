# PromptTestRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**LlmProvider** | **string** |  | 
**Model** | Pointer to **string** |  | [optional] 
**Temperature** | Pointer to **float32** |  | [optional] 
**MaxTokens** | Pointer to **int32** |  | [optional] 
**Template** | Pointer to **string** |  | [optional] 
**Name** | Pointer to **string** |  | [optional] 
**Version** | Pointer to **int32** |  | [optional] 
**Variables** | Pointer to **map[string]interface{}** |  | [optional] 
**Instructions** | Pointer to **string** |  | [optional] 

## Methods

### NewPromptTestRequest

`func NewPromptTestRequest(llmProvider string, ) *PromptTestRequest`

NewPromptTestRequest instantiates a new PromptTestRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPromptTestRequestWithDefaults

`func NewPromptTestRequestWithDefaults() *PromptTestRequest`

NewPromptTestRequestWithDefaults instantiates a new PromptTestRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetLlmProvider

`func (o *PromptTestRequest) GetLlmProvider() string`

GetLlmProvider returns the LlmProvider field if non-nil, zero value otherwise.

### GetLlmProviderOk

`func (o *PromptTestRequest) GetLlmProviderOk() (*string, bool)`

GetLlmProviderOk returns a tuple with the LlmProvider field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLlmProvider

`func (o *PromptTestRequest) SetLlmProvider(v string)`

SetLlmProvider sets LlmProvider field to given value.


### GetModel

`func (o *PromptTestRequest) GetModel() string`

GetModel returns the Model field if non-nil, zero value otherwise.

### GetModelOk

`func (o *PromptTestRequest) GetModelOk() (*string, bool)`

GetModelOk returns a tuple with the Model field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetModel

`func (o *PromptTestRequest) SetModel(v string)`

SetModel sets Model field to given value.

### HasModel

`func (o *PromptTestRequest) HasModel() bool`

HasModel returns a boolean if a field has been set.

### GetTemperature

`func (o *PromptTestRequest) GetTemperature() float32`

GetTemperature returns the Temperature field if non-nil, zero value otherwise.

### GetTemperatureOk

`func (o *PromptTestRequest) GetTemperatureOk() (*float32, bool)`

GetTemperatureOk returns a tuple with the Temperature field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTemperature

`func (o *PromptTestRequest) SetTemperature(v float32)`

SetTemperature sets Temperature field to given value.

### HasTemperature

`func (o *PromptTestRequest) HasTemperature() bool`

HasTemperature returns a boolean if a field has been set.

### GetMaxTokens

`func (o *PromptTestRequest) GetMaxTokens() int32`

GetMaxTokens returns the MaxTokens field if non-nil, zero value otherwise.

### GetMaxTokensOk

`func (o *PromptTestRequest) GetMaxTokensOk() (*int32, bool)`

GetMaxTokensOk returns a tuple with the MaxTokens field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMaxTokens

`func (o *PromptTestRequest) SetMaxTokens(v int32)`

SetMaxTokens sets MaxTokens field to given value.

### HasMaxTokens

`func (o *PromptTestRequest) HasMaxTokens() bool`

HasMaxTokens returns a boolean if a field has been set.

### GetTemplate

`func (o *PromptTestRequest) GetTemplate() string`

GetTemplate returns the Template field if non-nil, zero value otherwise.

### GetTemplateOk

`func (o *PromptTestRequest) GetTemplateOk() (*string, bool)`

GetTemplateOk returns a tuple with the Template field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTemplate

`func (o *PromptTestRequest) SetTemplate(v string)`

SetTemplate sets Template field to given value.

### HasTemplate

`func (o *PromptTestRequest) HasTemplate() bool`

HasTemplate returns a boolean if a field has been set.

### GetName

`func (o *PromptTestRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *PromptTestRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *PromptTestRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *PromptTestRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetVersion

`func (o *PromptTestRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *PromptTestRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *PromptTestRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *PromptTestRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetVariables

`func (o *PromptTestRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *PromptTestRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *PromptTestRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *PromptTestRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.

### GetInstructions

`func (o *PromptTestRequest) GetInstructions() string`

GetInstructions returns the Instructions field if non-nil, zero value otherwise.

### GetInstructionsOk

`func (o *PromptTestRequest) GetInstructionsOk() (*string, bool)`

GetInstructionsOk returns a tuple with the Instructions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstructions

`func (o *PromptTestRequest) SetInstructions(v string)`

SetInstructions sets Instructions field to given value.

### HasInstructions

`func (o *PromptTestRequest) HasInstructions() bool`

HasInstructions returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


