# PromptTestRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**llm_provider** | **str** |  | 
**model** | **str** |  | [optional] 
**temperature** | **float** |  | [optional] 
**max_tokens** | **int** |  | [optional] 
**template** | **str** |  | [optional] 
**name** | **str** |  | [optional] 
**version** | **int** |  | [optional] 
**variables** | **Dict[str, object]** |  | [optional] 
**instructions** | **str** |  | [optional] 

## Example

```python
from node_flow_client.models.prompt_test_request import PromptTestRequest

# TODO update the JSON string below
json = "{}"
# create an instance of PromptTestRequest from a JSON string
prompt_test_request_instance = PromptTestRequest.from_json(json)
# print the JSON string representation of the object
print(PromptTestRequest.to_json())

# convert the object into a dict
prompt_test_request_dict = prompt_test_request_instance.to_dict()
# create an instance of PromptTestRequest from a dict
prompt_test_request_from_dict = PromptTestRequest.from_dict(prompt_test_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


