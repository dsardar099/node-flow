# MetadataExportBundleRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Workflows** | Pointer to **[]string** |  | [optional] 
**Versions** | Pointer to **string** |  | [optional] 
**IncludeDependencies** | Pointer to **bool** |  | [optional] 

## Methods

### NewMetadataExportBundleRequest

`func NewMetadataExportBundleRequest() *MetadataExportBundleRequest`

NewMetadataExportBundleRequest instantiates a new MetadataExportBundleRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewMetadataExportBundleRequestWithDefaults

`func NewMetadataExportBundleRequestWithDefaults() *MetadataExportBundleRequest`

NewMetadataExportBundleRequestWithDefaults instantiates a new MetadataExportBundleRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWorkflows

`func (o *MetadataExportBundleRequest) GetWorkflows() []string`

GetWorkflows returns the Workflows field if non-nil, zero value otherwise.

### GetWorkflowsOk

`func (o *MetadataExportBundleRequest) GetWorkflowsOk() (*[]string, bool)`

GetWorkflowsOk returns a tuple with the Workflows field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWorkflows

`func (o *MetadataExportBundleRequest) SetWorkflows(v []string)`

SetWorkflows sets Workflows field to given value.

### HasWorkflows

`func (o *MetadataExportBundleRequest) HasWorkflows() bool`

HasWorkflows returns a boolean if a field has been set.

### GetVersions

`func (o *MetadataExportBundleRequest) GetVersions() string`

GetVersions returns the Versions field if non-nil, zero value otherwise.

### GetVersionsOk

`func (o *MetadataExportBundleRequest) GetVersionsOk() (*string, bool)`

GetVersionsOk returns a tuple with the Versions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersions

`func (o *MetadataExportBundleRequest) SetVersions(v string)`

SetVersions sets Versions field to given value.

### HasVersions

`func (o *MetadataExportBundleRequest) HasVersions() bool`

HasVersions returns a boolean if a field has been set.

### GetIncludeDependencies

`func (o *MetadataExportBundleRequest) GetIncludeDependencies() bool`

GetIncludeDependencies returns the IncludeDependencies field if non-nil, zero value otherwise.

### GetIncludeDependenciesOk

`func (o *MetadataExportBundleRequest) GetIncludeDependenciesOk() (*bool, bool)`

GetIncludeDependenciesOk returns a tuple with the IncludeDependencies field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIncludeDependencies

`func (o *MetadataExportBundleRequest) SetIncludeDependencies(v bool)`

SetIncludeDependencies sets IncludeDependencies field to given value.

### HasIncludeDependencies

`func (o *MetadataExportBundleRequest) HasIncludeDependencies() bool`

HasIncludeDependencies returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


