# VectorIndexAddRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**LlmProvider** | **string** |  | 
**EmbeddingModel** | Pointer to **string** |  | [optional] 
**DocId** | **string** |  | 
**Text** | **string** |  | 
**Metadata** | Pointer to **map[string]interface{}** |  | [optional] 
**ChunkSize** | Pointer to **int32** |  | [optional] 
**ChunkOverlap** | Pointer to **int32** |  | [optional] 

## Methods

### NewVectorIndexAddRequest

`func NewVectorIndexAddRequest(llmProvider string, docId string, text string, ) *VectorIndexAddRequest`

NewVectorIndexAddRequest instantiates a new VectorIndexAddRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewVectorIndexAddRequestWithDefaults

`func NewVectorIndexAddRequestWithDefaults() *VectorIndexAddRequest`

NewVectorIndexAddRequestWithDefaults instantiates a new VectorIndexAddRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetLlmProvider

`func (o *VectorIndexAddRequest) GetLlmProvider() string`

GetLlmProvider returns the LlmProvider field if non-nil, zero value otherwise.

### GetLlmProviderOk

`func (o *VectorIndexAddRequest) GetLlmProviderOk() (*string, bool)`

GetLlmProviderOk returns a tuple with the LlmProvider field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLlmProvider

`func (o *VectorIndexAddRequest) SetLlmProvider(v string)`

SetLlmProvider sets LlmProvider field to given value.


### GetEmbeddingModel

`func (o *VectorIndexAddRequest) GetEmbeddingModel() string`

GetEmbeddingModel returns the EmbeddingModel field if non-nil, zero value otherwise.

### GetEmbeddingModelOk

`func (o *VectorIndexAddRequest) GetEmbeddingModelOk() (*string, bool)`

GetEmbeddingModelOk returns a tuple with the EmbeddingModel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmbeddingModel

`func (o *VectorIndexAddRequest) SetEmbeddingModel(v string)`

SetEmbeddingModel sets EmbeddingModel field to given value.

### HasEmbeddingModel

`func (o *VectorIndexAddRequest) HasEmbeddingModel() bool`

HasEmbeddingModel returns a boolean if a field has been set.

### GetDocId

`func (o *VectorIndexAddRequest) GetDocId() string`

GetDocId returns the DocId field if non-nil, zero value otherwise.

### GetDocIdOk

`func (o *VectorIndexAddRequest) GetDocIdOk() (*string, bool)`

GetDocIdOk returns a tuple with the DocId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDocId

`func (o *VectorIndexAddRequest) SetDocId(v string)`

SetDocId sets DocId field to given value.


### GetText

`func (o *VectorIndexAddRequest) GetText() string`

GetText returns the Text field if non-nil, zero value otherwise.

### GetTextOk

`func (o *VectorIndexAddRequest) GetTextOk() (*string, bool)`

GetTextOk returns a tuple with the Text field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetText

`func (o *VectorIndexAddRequest) SetText(v string)`

SetText sets Text field to given value.


### GetMetadata

`func (o *VectorIndexAddRequest) GetMetadata() map[string]interface{}`

GetMetadata returns the Metadata field if non-nil, zero value otherwise.

### GetMetadataOk

`func (o *VectorIndexAddRequest) GetMetadataOk() (*map[string]interface{}, bool)`

GetMetadataOk returns a tuple with the Metadata field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMetadata

`func (o *VectorIndexAddRequest) SetMetadata(v map[string]interface{})`

SetMetadata sets Metadata field to given value.

### HasMetadata

`func (o *VectorIndexAddRequest) HasMetadata() bool`

HasMetadata returns a boolean if a field has been set.

### GetChunkSize

`func (o *VectorIndexAddRequest) GetChunkSize() int32`

GetChunkSize returns the ChunkSize field if non-nil, zero value otherwise.

### GetChunkSizeOk

`func (o *VectorIndexAddRequest) GetChunkSizeOk() (*int32, bool)`

GetChunkSizeOk returns a tuple with the ChunkSize field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChunkSize

`func (o *VectorIndexAddRequest) SetChunkSize(v int32)`

SetChunkSize sets ChunkSize field to given value.

### HasChunkSize

`func (o *VectorIndexAddRequest) HasChunkSize() bool`

HasChunkSize returns a boolean if a field has been set.

### GetChunkOverlap

`func (o *VectorIndexAddRequest) GetChunkOverlap() int32`

GetChunkOverlap returns the ChunkOverlap field if non-nil, zero value otherwise.

### GetChunkOverlapOk

`func (o *VectorIndexAddRequest) GetChunkOverlapOk() (*int32, bool)`

GetChunkOverlapOk returns a tuple with the ChunkOverlap field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChunkOverlap

`func (o *VectorIndexAddRequest) SetChunkOverlap(v int32)`

SetChunkOverlap sets ChunkOverlap field to given value.

### HasChunkOverlap

`func (o *VectorIndexAddRequest) HasChunkOverlap() bool`

HasChunkOverlap returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


