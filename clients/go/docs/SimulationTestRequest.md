# SimulationTestRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Definition** | Pointer to **map[string]interface{}** |  | [optional] 
**Name** | Pointer to **string** |  | [optional] 
**Version** | Pointer to **int32** |  | [optional] 
**Input** | Pointer to **map[string]interface{}** |  | [optional] [default to {}]
**Variables** | Pointer to **map[string]interface{}** |  | [optional] 
**Mocks** | Pointer to [**map[string]SimulationTestRequestMocksValue**](SimulationTestRequestMocksValue.md) |  | [optional] [default to {}]
**RunPureTasks** | Pointer to **bool** |  | [optional] [default to true]

## Methods

### NewSimulationTestRequest

`func NewSimulationTestRequest() *SimulationTestRequest`

NewSimulationTestRequest instantiates a new SimulationTestRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewSimulationTestRequestWithDefaults

`func NewSimulationTestRequestWithDefaults() *SimulationTestRequest`

NewSimulationTestRequestWithDefaults instantiates a new SimulationTestRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetDefinition

`func (o *SimulationTestRequest) GetDefinition() map[string]interface{}`

GetDefinition returns the Definition field if non-nil, zero value otherwise.

### GetDefinitionOk

`func (o *SimulationTestRequest) GetDefinitionOk() (*map[string]interface{}, bool)`

GetDefinitionOk returns a tuple with the Definition field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefinition

`func (o *SimulationTestRequest) SetDefinition(v map[string]interface{})`

SetDefinition sets Definition field to given value.

### HasDefinition

`func (o *SimulationTestRequest) HasDefinition() bool`

HasDefinition returns a boolean if a field has been set.

### GetName

`func (o *SimulationTestRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *SimulationTestRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *SimulationTestRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *SimulationTestRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetVersion

`func (o *SimulationTestRequest) GetVersion() int32`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *SimulationTestRequest) GetVersionOk() (*int32, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *SimulationTestRequest) SetVersion(v int32)`

SetVersion sets Version field to given value.

### HasVersion

`func (o *SimulationTestRequest) HasVersion() bool`

HasVersion returns a boolean if a field has been set.

### GetInput

`func (o *SimulationTestRequest) GetInput() map[string]interface{}`

GetInput returns the Input field if non-nil, zero value otherwise.

### GetInputOk

`func (o *SimulationTestRequest) GetInputOk() (*map[string]interface{}, bool)`

GetInputOk returns a tuple with the Input field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInput

`func (o *SimulationTestRequest) SetInput(v map[string]interface{})`

SetInput sets Input field to given value.

### HasInput

`func (o *SimulationTestRequest) HasInput() bool`

HasInput returns a boolean if a field has been set.

### GetVariables

`func (o *SimulationTestRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *SimulationTestRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *SimulationTestRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *SimulationTestRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.

### GetMocks

`func (o *SimulationTestRequest) GetMocks() map[string]SimulationTestRequestMocksValue`

GetMocks returns the Mocks field if non-nil, zero value otherwise.

### GetMocksOk

`func (o *SimulationTestRequest) GetMocksOk() (*map[string]SimulationTestRequestMocksValue, bool)`

GetMocksOk returns a tuple with the Mocks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMocks

`func (o *SimulationTestRequest) SetMocks(v map[string]SimulationTestRequestMocksValue)`

SetMocks sets Mocks field to given value.

### HasMocks

`func (o *SimulationTestRequest) HasMocks() bool`

HasMocks returns a boolean if a field has been set.

### GetRunPureTasks

`func (o *SimulationTestRequest) GetRunPureTasks() bool`

GetRunPureTasks returns the RunPureTasks field if non-nil, zero value otherwise.

### GetRunPureTasksOk

`func (o *SimulationTestRequest) GetRunPureTasksOk() (*bool, bool)`

GetRunPureTasksOk returns a tuple with the RunPureTasks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRunPureTasks

`func (o *SimulationTestRequest) SetRunPureTasks(v bool)`

SetRunPureTasks sets RunPureTasks field to given value.

### HasRunPureTasks

`func (o *SimulationTestRequest) HasRunPureTasks() bool`

HasRunPureTasks returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


