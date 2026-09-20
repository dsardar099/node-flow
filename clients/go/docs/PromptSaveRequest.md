# PromptSaveRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Template** | **string** |  | 
**Description** | Pointer to **NullableString** |  | [optional] 
**Models** | Pointer to **[]string** |  | [optional] 

## Methods

### NewPromptSaveRequest

`func NewPromptSaveRequest(template string, ) *PromptSaveRequest`

NewPromptSaveRequest instantiates a new PromptSaveRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPromptSaveRequestWithDefaults

`func NewPromptSaveRequestWithDefaults() *PromptSaveRequest`

NewPromptSaveRequestWithDefaults instantiates a new PromptSaveRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTemplate

`func (o *PromptSaveRequest) GetTemplate() string`

GetTemplate returns the Template field if non-nil, zero value otherwise.

### GetTemplateOk

`func (o *PromptSaveRequest) GetTemplateOk() (*string, bool)`

GetTemplateOk returns a tuple with the Template field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTemplate

`func (o *PromptSaveRequest) SetTemplate(v string)`

SetTemplate sets Template field to given value.


### GetDescription

`func (o *PromptSaveRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *PromptSaveRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *PromptSaveRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *PromptSaveRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.

### SetDescriptionNil

`func (o *PromptSaveRequest) SetDescriptionNil(b bool)`

 SetDescriptionNil sets the value for Description to be an explicit nil

### UnsetDescription
`func (o *PromptSaveRequest) UnsetDescription()`

UnsetDescription ensures that no value is present for Description, not even an explicit nil
### GetModels

`func (o *PromptSaveRequest) GetModels() []string`

GetModels returns the Models field if non-nil, zero value otherwise.

### GetModelsOk

`func (o *PromptSaveRequest) GetModelsOk() (*[]string, bool)`

GetModelsOk returns a tuple with the Models field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetModels

`func (o *PromptSaveRequest) SetModels(v []string)`

SetModels sets Models field to given value.

### HasModels

`func (o *PromptSaveRequest) HasModels() bool`

HasModels returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


