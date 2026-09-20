# PromptSaveRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**template** | **str** |  | 
**description** | **str** |  | [optional] 
**models** | **List[str]** |  | [optional] 

## Example

```python
from node_flow_client.models.prompt_save_request import PromptSaveRequest

# TODO update the JSON string below
json = "{}"
# create an instance of PromptSaveRequest from a JSON string
prompt_save_request_instance = PromptSaveRequest.from_json(json)
# print the JSON string representation of the object
print(PromptSaveRequest.to_json())

# convert the object into a dict
prompt_save_request_dict = prompt_save_request_instance.to_dict()
# create an instance of PromptSaveRequest from a dict
prompt_save_request_from_dict = PromptSaveRequest.from_dict(prompt_save_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


