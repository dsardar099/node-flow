# PermissionsPutRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**SubjectType** | **string** |  | 
**SubjectId** | **string** |  | 
**ResourceType** | **string** |  | 
**Resource** | **string** |  | 
**Access** | **[]string** |  | 

## Methods

### NewPermissionsPutRequest

`func NewPermissionsPutRequest(subjectType string, subjectId string, resourceType string, resource string, access []string, ) *PermissionsPutRequest`

NewPermissionsPutRequest instantiates a new PermissionsPutRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPermissionsPutRequestWithDefaults

`func NewPermissionsPutRequestWithDefaults() *PermissionsPutRequest`

NewPermissionsPutRequestWithDefaults instantiates a new PermissionsPutRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSubjectType

`func (o *PermissionsPutRequest) GetSubjectType() string`

GetSubjectType returns the SubjectType field if non-nil, zero value otherwise.

### GetSubjectTypeOk

`func (o *PermissionsPutRequest) GetSubjectTypeOk() (*string, bool)`

GetSubjectTypeOk returns a tuple with the SubjectType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubjectType

`func (o *PermissionsPutRequest) SetSubjectType(v string)`

SetSubjectType sets SubjectType field to given value.


### GetSubjectId

`func (o *PermissionsPutRequest) GetSubjectId() string`

GetSubjectId returns the SubjectId field if non-nil, zero value otherwise.

### GetSubjectIdOk

`func (o *PermissionsPutRequest) GetSubjectIdOk() (*string, bool)`

GetSubjectIdOk returns a tuple with the SubjectId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubjectId

`func (o *PermissionsPutRequest) SetSubjectId(v string)`

SetSubjectId sets SubjectId field to given value.


### GetResourceType

`func (o *PermissionsPutRequest) GetResourceType() string`

GetResourceType returns the ResourceType field if non-nil, zero value otherwise.

### GetResourceTypeOk

`func (o *PermissionsPutRequest) GetResourceTypeOk() (*string, bool)`

GetResourceTypeOk returns a tuple with the ResourceType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResourceType

`func (o *PermissionsPutRequest) SetResourceType(v string)`

SetResourceType sets ResourceType field to given value.


### GetResource

`func (o *PermissionsPutRequest) GetResource() string`

GetResource returns the Resource field if non-nil, zero value otherwise.

### GetResourceOk

`func (o *PermissionsPutRequest) GetResourceOk() (*string, bool)`

GetResourceOk returns a tuple with the Resource field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResource

`func (o *PermissionsPutRequest) SetResource(v string)`

SetResource sets Resource field to given value.


### GetAccess

`func (o *PermissionsPutRequest) GetAccess() []string`

GetAccess returns the Access field if non-nil, zero value otherwise.

### GetAccessOk

`func (o *PermissionsPutRequest) GetAccessOk() (*[]string, bool)`

GetAccessOk returns a tuple with the Access field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAccess

`func (o *PermissionsPutRequest) SetAccess(v []string)`

SetAccess sets Access field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


