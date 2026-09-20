# SavedViewCreateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Page** | **string** |  | 
**Name** | **string** |  | 
**State** | **map[string]interface{}** |  | 
**Shared** | Pointer to **bool** |  | [optional] 

## Methods

### NewSavedViewCreateRequest

`func NewSavedViewCreateRequest(page string, name string, state map[string]interface{}, ) *SavedViewCreateRequest`

NewSavedViewCreateRequest instantiates a new SavedViewCreateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSavedViewCreateRequestWithDefaults

`func NewSavedViewCreateRequestWithDefaults() *SavedViewCreateRequest`

NewSavedViewCreateRequestWithDefaults instantiates a new SavedViewCreateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetPage

`func (o *SavedViewCreateRequest) GetPage() string`

GetPage returns the Page field if non-nil, zero value otherwise.

### GetPageOk

`func (o *SavedViewCreateRequest) GetPageOk() (*string, bool)`

GetPageOk returns a tuple with the Page field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPage

`func (o *SavedViewCreateRequest) SetPage(v string)`

SetPage sets Page field to given value.


### GetName

`func (o *SavedViewCreateRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SavedViewCreateRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SavedViewCreateRequest) SetName(v string)`

SetName sets Name field to given value.


### GetState

`func (o *SavedViewCreateRequest) GetState() map[string]interface{}`

GetState returns the State field if non-nil, zero value otherwise.

### GetStateOk

`func (o *SavedViewCreateRequest) GetStateOk() (*map[string]interface{}, bool)`

GetStateOk returns a tuple with the State field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetState

`func (o *SavedViewCreateRequest) SetState(v map[string]interface{})`

SetState sets State field to given value.


### GetShared

`func (o *SavedViewCreateRequest) GetShared() bool`

GetShared returns the Shared field if non-nil, zero value otherwise.

### GetSharedOk

`func (o *SavedViewCreateRequest) GetSharedOk() (*bool, bool)`

GetSharedOk returns a tuple with the Shared field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetShared

`func (o *SavedViewCreateRequest) SetShared(v bool)`

SetShared sets Shared field to given value.

### HasShared

`func (o *SavedViewCreateRequest) HasShared() bool`

HasShared returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


