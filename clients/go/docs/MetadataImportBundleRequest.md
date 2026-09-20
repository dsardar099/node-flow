# MetadataImportBundleRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Bundle** | **map[string]interface{}** |  | 
**WorkflowConflicts** | Pointer to **string** |  | [optional] 
**TaskDefinitionConflicts** | Pointer to **string** |  | [optional] 
**DryRun** | Pointer to **bool** |  | [optional] 

## Methods

### NewMetadataImportBundleRequest

`func NewMetadataImportBundleRequest(bundle map[string]interface{}, ) *MetadataImportBundleRequest`

NewMetadataImportBundleRequest instantiates a new MetadataImportBundleRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMetadataImportBundleRequestWithDefaults

`func NewMetadataImportBundleRequestWithDefaults() *MetadataImportBundleRequest`

NewMetadataImportBundleRequestWithDefaults instantiates a new MetadataImportBundleRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetBundle

`func (o *MetadataImportBundleRequest) GetBundle() map[string]interface{}`

GetBundle returns the Bundle field if non-nil, zero value otherwise.

### GetBundleOk

`func (o *MetadataImportBundleRequest) GetBundleOk() (*map[string]interface{}, bool)`

GetBundleOk returns a tuple with the Bundle field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetBundle

`func (o *MetadataImportBundleRequest) SetBundle(v map[string]interface{})`

SetBundle sets Bundle field to given value.


### GetWorkflowConflicts

`func (o *MetadataImportBundleRequest) GetWorkflowConflicts() string`

GetWorkflowConflicts returns the WorkflowConflicts field if non-nil, zero value otherwise.

### GetWorkflowConflictsOk

`func (o *MetadataImportBundleRequest) GetWorkflowConflictsOk() (*string, bool)`

GetWorkflowConflictsOk returns a tuple with the WorkflowConflicts field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflowConflicts

`func (o *MetadataImportBundleRequest) SetWorkflowConflicts(v string)`

SetWorkflowConflicts sets WorkflowConflicts field to given value.

### HasWorkflowConflicts

`func (o *MetadataImportBundleRequest) HasWorkflowConflicts() bool`

HasWorkflowConflicts returns a boolean if a field has been set.

### GetTaskDefinitionConflicts

`func (o *MetadataImportBundleRequest) GetTaskDefinitionConflicts() string`

GetTaskDefinitionConflicts returns the TaskDefinitionConflicts field if non-nil, zero value otherwise.

### GetTaskDefinitionConflictsOk

`func (o *MetadataImportBundleRequest) GetTaskDefinitionConflictsOk() (*string, bool)`

GetTaskDefinitionConflictsOk returns a tuple with the TaskDefinitionConflicts field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTaskDefinitionConflicts

`func (o *MetadataImportBundleRequest) SetTaskDefinitionConflicts(v string)`

SetTaskDefinitionConflicts sets TaskDefinitionConflicts field to given value.

### HasTaskDefinitionConflicts

`func (o *MetadataImportBundleRequest) HasTaskDefinitionConflicts() bool`

HasTaskDefinitionConflicts returns a boolean if a field has been set.

### GetDryRun

`func (o *MetadataImportBundleRequest) GetDryRun() bool`

GetDryRun returns the DryRun field if non-nil, zero value otherwise.

### GetDryRunOk

`func (o *MetadataImportBundleRequest) GetDryRunOk() (*bool, bool)`

GetDryRunOk returns a tuple with the DryRun field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDryRun

`func (o *MetadataImportBundleRequest) SetDryRun(v bool)`

SetDryRun sets DryRun field to given value.

### HasDryRun

`func (o *MetadataImportBundleRequest) HasDryRun() bool`

HasDryRun returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


