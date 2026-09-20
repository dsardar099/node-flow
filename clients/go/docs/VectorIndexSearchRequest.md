# VectorIndexSearchRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**LlmProvider** | **string** |  | 
**EmbeddingModel** | Pointer to **string** |  | [optional] 
**Query** | **string** |  | 
**TopK** | Pointer to **int32** |  | [optional] 
**MinScore** | Pointer to **float32** |  | [optional] 

## Methods

### NewVectorIndexSearchRequest

`func NewVectorIndexSearchRequest(llmProvider string, query string, ) *VectorIndexSearchRequest`

NewVectorIndexSearchRequest instantiates a new VectorIndexSearchRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewVectorIndexSearchRequestWithDefaults

`func NewVectorIndexSearchRequestWithDefaults() *VectorIndexSearchRequest`

NewVectorIndexSearchRequestWithDefaults instantiates a new VectorIndexSearchRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetLlmProvider

`func (o *VectorIndexSearchRequest) GetLlmProvider() string`

GetLlmProvider returns the LlmProvider field if non-nil, zero value otherwise.

### GetLlmProviderOk

`func (o *VectorIndexSearchRequest) GetLlmProviderOk() (*string, bool)`

GetLlmProviderOk returns a tuple with the LlmProvider field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLlmProvider

`func (o *VectorIndexSearchRequest) SetLlmProvider(v string)`

SetLlmProvider sets LlmProvider field to given value.


### GetEmbeddingModel

`func (o *VectorIndexSearchRequest) GetEmbeddingModel() string`

GetEmbeddingModel returns the EmbeddingModel field if non-nil, zero value otherwise.

### GetEmbeddingModelOk

`func (o *VectorIndexSearchRequest) GetEmbeddingModelOk() (*string, bool)`

GetEmbeddingModelOk returns a tuple with the EmbeddingModel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEmbeddingModel

`func (o *VectorIndexSearchRequest) SetEmbeddingModel(v string)`

SetEmbeddingModel sets EmbeddingModel field to given value.

### HasEmbeddingModel

`func (o *VectorIndexSearchRequest) HasEmbeddingModel() bool`

HasEmbeddingModel returns a boolean if a field has been set.

### GetQuery

`func (o *VectorIndexSearchRequest) GetQuery() string`

GetQuery returns the Query field if non-nil, zero value otherwise.

### GetQueryOk

`func (o *VectorIndexSearchRequest) GetQueryOk() (*string, bool)`

GetQueryOk returns a tuple with the Query field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQuery

`func (o *VectorIndexSearchRequest) SetQuery(v string)`

SetQuery sets Query field to given value.


### GetTopK

`func (o *VectorIndexSearchRequest) GetTopK() int32`

GetTopK returns the TopK field if non-nil, zero value otherwise.

### GetTopKOk

`func (o *VectorIndexSearchRequest) GetTopKOk() (*int32, bool)`

GetTopKOk returns a tuple with the TopK field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTopK

`func (o *VectorIndexSearchRequest) SetTopK(v int32)`

SetTopK sets TopK field to given value.

### HasTopK

`func (o *VectorIndexSearchRequest) HasTopK() bool`

HasTopK returns a boolean if a field has been set.

### GetMinScore

`func (o *VectorIndexSearchRequest) GetMinScore() float32`

GetMinScore returns the MinScore field if non-nil, zero value otherwise.

### GetMinScoreOk

`func (o *VectorIndexSearchRequest) GetMinScoreOk() (*float32, bool)`

GetMinScoreOk returns a tuple with the MinScore field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMinScore

`func (o *VectorIndexSearchRequest) SetMinScore(v float32)`

SetMinScore sets MinScore field to given value.

### HasMinScore

`func (o *VectorIndexSearchRequest) HasMinScore() bool`

HasMinScore returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


