# SavedViewUpdateRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** |  | [optional] 
**State** | Pointer to **map[string]interface{}** |  | [optional] 
**Shared** | Pointer to **bool** |  | [optional] 

## Methods

### NewSavedViewUpdateRequest

`func NewSavedViewUpdateRequest() *SavedViewUpdateRequest`

NewSavedViewUpdateRequest instantiates a new SavedViewUpdateRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSavedViewUpdateRequestWithDefaults

`func NewSavedViewUpdateRequestWithDefaults() *SavedViewUpdateRequest`

NewSavedViewUpdateRequestWithDefaults instantiates a new SavedViewUpdateRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *SavedViewUpdateRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SavedViewUpdateRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SavedViewUpdateRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *SavedViewUpdateRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetState

`func (o *SavedViewUpdateRequest) GetState() map[string]interface{}`

GetState returns the State field if non-nil, zero value otherwise.

### GetStateOk

`func (o *SavedViewUpdateRequest) GetStateOk() (*map[string]interface{}, bool)`

GetStateOk returns a tuple with the State field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetState

`func (o *SavedViewUpdateRequest) SetState(v map[string]interface{})`

SetState sets State field to given value.

### HasState

`func (o *SavedViewUpdateRequest) HasState() bool`

HasState returns a boolean if a field has been set.

### GetShared

`func (o *SavedViewUpdateRequest) GetShared() bool`

GetShared returns the Shared field if non-nil, zero value otherwise.

### GetSharedOk

`func (o *SavedViewUpdateRequest) GetSharedOk() (*bool, bool)`

GetSharedOk returns a tuple with the Shared field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetShared

`func (o *SavedViewUpdateRequest) SetShared(v bool)`

SetShared sets Shared field to given value.

### HasShared

`func (o *SavedViewUpdateRequest) HasShared() bool`

HasShared returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


